import re
import uuid

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import JSONResponse

from backend.api.schemas.auth import LoginRequest, RegisterRequest
from backend.auth import (
    OptionalUser,
    create_access_token,
    hash_password,
    set_auth_cookie,
    clear_auth_cookie,
    verify_password,
)
from backend.db.session import SessionLocal
from backend.models import User

router = APIRouter(prefix="/auth", tags=["auth"])

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _user_to_dict(u: User) -> dict:
    return {
        "id": u.id,
        "email": u.email,
        "role": u.role,
        "quota_credits": u.quota_credits,
    }


@router.post("/register", status_code=201)
async def register(req: RegisterRequest, request: Request) -> dict:
    email = req.email.strip().lower()
    if not EMAIL_RE.match(email):
        raise HTTPException(400, "invalid email")
    if len(req.password) < 6:
        raise HTTPException(400, "password must be at least 6 characters")
    with SessionLocal() as s:
        existing = s.query(User).filter(User.email == email).first()
        if existing:
            raise HTTPException(409, "email already registered")
        u = User(
            id=str(uuid.uuid4()),
            email=email,
            password_hash=hash_password(req.password),
        )
        s.add(u)
        s.commit()
        s.refresh(u)
        out = _user_to_dict(u)
    token = create_access_token(u.id, u.email, u.role)
    resp = JSONResponse(out)
    set_auth_cookie(resp, request, token)
    return resp


@router.post("/login")
async def login(req: LoginRequest, request: Request) -> dict:
    email = req.email.strip().lower()
    with SessionLocal() as s:
        u = s.query(User).filter(User.email == email).first()
        if not u or not verify_password(req.password, u.password_hash):
            raise HTTPException(401, "invalid email or password")
        out = _user_to_dict(u)
    token = create_access_token(u.id, u.email, u.role)
    resp = JSONResponse(out)
    set_auth_cookie(resp, request, token)
    return resp


@router.post("/logout")
async def logout() -> dict:
    resp = JSONResponse({"ok": True})
    clear_auth_cookie(resp)
    return resp


@router.get("/me")
async def me(user: OptionalUser) -> dict:
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "not authenticated")
    return _user_to_dict(user)
