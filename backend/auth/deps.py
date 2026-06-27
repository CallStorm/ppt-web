"""FastAPI auth dependencies."""
from __future__ import annotations

import logging
import time
from typing import Annotated

from fastapi import Cookie, Depends, HTTPException, Request, status
from jose import JWTError
from sqlalchemy.orm import Session

from backend.auth.jwt import JWT_COOKIE_NAME, decode_token
from backend.db.session import SessionLocal
from backend.models import User

log = logging.getLogger("backend.auth.deps")

_USER_CACHE_TTL = 60.0
_user_cache: dict[str, tuple[float, User]] = {}


def _db() -> Session:
    return SessionLocal()


def get_current_user(
    request: Request,
    ppt_web_auth: Annotated[str | None, Cookie(alias=JWT_COOKIE_NAME)] = None,
) -> User:
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
    now = time.monotonic()
    cached = _user_cache.get(user_id)
    if cached and now - cached[0] < _USER_CACHE_TTL:
        return cached[1]
    with _db() as s:
        u = s.get(User, user_id)
        if not u:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "user not found")
        _user_cache[user_id] = (now, u)
        return u


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


def get_current_admin_user(user: CurrentUser) -> User:
    if user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "admin required")
    return user


AdminUser = Annotated[User, Depends(get_current_admin_user)]
