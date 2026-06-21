"""JWT token and cookie helpers."""
from __future__ import annotations

import logging
import os
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import Request
from jose import JWTError, jwt

log = logging.getLogger("backend.auth.jwt")

JWT_COOKIE_NAME = "ppt_web_auth"
JWT_ALG = "HS256"
JWT_TTL_SECONDS = 7 * 24 * 3600
JWT_ISSUER = "ppt-web"

_JWT_SECRET: str | None = None


def _get_or_init_secret() -> str:
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


def get_jwt_secret() -> str:
    global _JWT_SECRET
    if _JWT_SECRET is None:
        _JWT_SECRET = _get_or_init_secret()
    return _JWT_SECRET


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
    return jwt.decode(
        token,
        get_jwt_secret(),
        algorithms=[JWT_ALG],
        issuer=JWT_ISSUER,
        options={"require": ["exp", "sub", "iat", "iss"]},
    )


def set_auth_cookie(response, request: Request, token: str) -> None:
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
