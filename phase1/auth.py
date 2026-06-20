"""Phase 2 鉴权：bcrypt 哈希 + JWT (HS256) + FastAPI 依赖。

设计要点：
- JWT secret 从 env `PPT_WEB_JWT_SECRET` 读；缺失时 dev 模式随机生成并 console warning，
  生产模式直接 raise（fail-fast）。
- JWT 存 HttpOnly cookie，cookie 名 PPT_WEB_AUTH。
- `get_current_user` 是 FastAPI 依赖：未登录 / token 无效 → 401；登录过期 → 401。
- cookie 的 `Secure` 标志按 request scheme 切换：https 才设 Secure（dev http 不卡）。
"""
from __future__ import annotations

import logging
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import Cookie, Depends, HTTPException, Request, status
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from phase1.db import SessionLocal
from phase1.models import User

log = logging.getLogger("phase1.auth")

JWT_COOKIE_NAME = "ppt_web_auth"
JWT_ALG = "HS256"
JWT_TTL_SECONDS = 7 * 24 * 3600  # 7 days
JWT_ISSUER = "ppt-web"

_pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")


def _get_or_init_secret() -> str:
    """从 env 读 JWT secret，缺失则 dev 模式随机生成。"""
    s = os.environ.get("PPT_WEB_JWT_SECRET")
    if s:
        return s
    if os.environ.get("PPT_WEB_ENV") == "production":
        raise RuntimeError(
            "PPT_WEB_JWT_SECRET is required in production. "
            "Set it to a 32+ char random string."
        )
    s = secrets.token_urlsafe(48)
    log.warning(
        "PPT_WEB_JWT_SECRET not set; generated ephemeral secret for this process. "
        "Tokens will not survive restart. Set the env var to persist sessions."
    )
    return s


_JWT_SECRET: str | None = None


def get_jwt_secret() -> str:
    global _JWT_SECRET
    if _JWT_SECRET is None:
        _JWT_SECRET = _get_or_init_secret()
    return _JWT_SECRET


def hash_password(plain: str) -> str:
    return _pwd.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return _pwd.verify(plain, hashed)
    except Exception:
        return False


def create_access_token(user_id: str, email: str, role: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "email": email,
        "role": role,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=JWT_TTL_SECONDS)).timestamp()),
        "iss": JWT_ISSUER,
    }
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALG)


def decode_token(token: str) -> dict:
    """校验 + 解码 JWT；失败抛 JWTError。"""
    return jwt.decode(
        token,
        get_jwt_secret(),
        algorithms=[JWT_ALG],
        issuer=JWT_ISSUER,
        options={"require": ["exp", "sub", "iat", "iss"]},
    )


def _db() -> Session:
    return SessionLocal()


def get_current_user(
    request: Request,
    ppt_web_auth: Annotated[str | None, Cookie(alias=JWT_COOKIE_NAME)] = None,
) -> User:
    """FastAPI 依赖：从 cookie 读 JWT，校验，查 DB，返回 User。失败 401。

    admin 校验：user.role == "admin" 时 server.py 跳过 ownership 检查。
    """
    if not ppt_web_auth:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "not authenticated")
    try:
        payload = decode_token(ppt_web_auth)
    except JWTError as e:
        log.info(f"jwt decode failed: {e}")
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid or expired token")
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "token missing sub")
    with _db() as s:
        u = s.get(User, user_id)
        if not u:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "user not found")
        return u


# 可选依赖：未登录返回 None（不 401）。给 /api/auth/me 那种想区分两种情况的端点用。
def get_optional_user(
    ppt_web_auth: Annotated[str | None, Cookie(alias=JWT_COOKIE_NAME)] = None,
) -> User | None:
    if not ppt_web_auth:
        return None
    try:
        payload = decode_token(ppt_web_auth)
    except JWTError:
        return None
    user_id = payload.get("sub")
    if not user_id:
        return None
    with _db() as s:
        return s.get(User, user_id)


CurrentUser = Annotated[User, Depends(get_current_user)]
OptionalUser = Annotated[User | None, Depends(get_optional_user)]


def set_auth_cookie(response, request: Request, token: str) -> None:
    """写 JWT cookie。Secure 标志按 scheme 切换。"""
    is_https = request.url.scheme == "https"
    response.set_cookie(
        key=JWT_COOKIE_NAME,
        value=token,
        max_age=JWT_TTL_SECONDS,
        httponly=True,
        secure=is_https,
        samesite="lax",
        path="/",
    )


def clear_auth_cookie(response) -> None:
    response.delete_cookie(key=JWT_COOKIE_NAME, path="/")
