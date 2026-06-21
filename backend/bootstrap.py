"""启动时幂等 seed：默认 admin 账号。"""
from __future__ import annotations

import logging
import os
import uuid

from backend.auth.passwords import hash_password
from backend.db.session import SessionLocal
from backend.models import User

log = logging.getLogger("backend.bootstrap")

DEFAULT_ADMIN_EMAIL = "admin"
DEFAULT_ADMIN_PASSWORD = "admin"


def seed_default_admin() -> None:
    """幂等创建 admin/admin。已存在则不覆盖密码，除非 PPT_WEB_RESET_ADMIN_PASSWORD=true。"""
    reset = os.getenv("PPT_WEB_RESET_ADMIN_PASSWORD", "").strip().lower() in (
        "1", "true", "yes", "on",
    )
    with SessionLocal() as s:
        existing = s.query(User).filter(User.email == DEFAULT_ADMIN_EMAIL).first()
        if existing:
            if reset:
                existing.password_hash = hash_password(DEFAULT_ADMIN_PASSWORD)
                existing.role = "admin"
                s.commit()
                log.warning("reset default admin password (PPT_WEB_RESET_ADMIN_PASSWORD=true)")
            return
        u = User(
            id=str(uuid.uuid4()),
            email=DEFAULT_ADMIN_EMAIL,
            password_hash=hash_password(DEFAULT_ADMIN_PASSWORD),
            role="admin",
            quota_credits=100,
        )
        s.add(u)
        s.commit()
        log.info("seeded default admin account (email=%s)", DEFAULT_ADMIN_EMAIL)
