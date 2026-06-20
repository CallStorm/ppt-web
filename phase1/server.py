"""Phase 2 Web MVP — FastAPI server。

挂载路由（除 /api/auth/* 与 /api/health 外都需登录，且 /api/jobs/{id}* 还要 ownership）：

  鉴权：
    POST /api/auth/register         邮箱密码注册
    POST /api/auth/login            登录
    POST /api/auth/logout           登出
    GET  /api/auth/me               当前用户

  Jobs：
    POST /api/jobs                  新建 job（multipart：prompt + files + 可选 project_name）
    GET  /api/jobs                  当前用户的所有 job
    GET  /api/jobs/{id}             单 job 详情（需 ownership）
    POST /api/jobs/{id}/resume      注入确认（paused → running；需 ownership）
    POST /api/jobs/{id}/cancel      取消（需 ownership + 必须是当前 active）
    GET  /api/jobs/{id}/events      SSE（需 ownership）
    GET  /api/jobs/{id}/pptx        下载产物（需 ownership）

  静态：
    GET  /                          简单前端（单页 index.html）
    GET  /static/*                  CSS/JS

设计要点：
  - JWT 在 HttpOnly cookie；Secure 标志按 scheme 切换（dev http 不卡）
  - 全局并发上限（MAX_CONCURRENT_JOBS，默认 3）——每 job 一个 Docker 容器
  - 上传 staging 到 data/users/<uid>/uploads/<job_id>/，agent 跑 import-sources --copy
  - 所有 per-user 数据走 paths.project_root_for() / paths.uploads_dir_for()
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import sys
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated

from fastapi import (
    Cookie,
    Depends,
    FastAPI,
    File,
    Form,
    HTTPException,
    Request,
    UploadFile,
    status,
)
from fastapi.responses import (
    FileResponse,
    JSONResponse,
    PlainTextResponse,
    StreamingResponse,
)
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, EmailStr, Field

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from phase1.auth import (  # noqa: E402
    CurrentUser,
    JWT_COOKIE_NAME,
    OptionalUser,
    clear_auth_cookie,
    create_access_token,
    get_optional_user,
    hash_password,
    set_auth_cookie,
    verify_password,
)  # noqa: E402
from phase1.core import (  # noqa: E402
    active_count,
    active_job_ids,
    cancel_active,
    cleanup_stuck_jobs,
    has_capacity,
    init_runtime,
    is_active,
    MAX_CONCURRENT_JOBS,
    notify_dispatcher,
    queue_count,
    queue_position,
    queue_resume,
    start_dispatcher,
    start_watchdog,
    stop_dispatcher,
    stop_watchdog,
    subscribe,
    unsubscribe,
)
from phase1.db import SessionLocal, init_db, migrate_v1_to_v2, migrate_v2_to_v3, migrate_v3_to_v4  # noqa: E402
from phase1.models import Event, Job, User  # noqa: E402
from phase1.paths import (  # noqa: E402
    DATA_DIR,
    ensure_data_dirs,
    is_under,
    safe_stage_name,
    uploads_dir_for,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("phase1.server")

# 50MB 总上传上限（multipart 整体）
MAX_UPLOAD_BYTES = 50 * 1024 * 1024
# 单文件 25MB
MAX_SINGLE_FILE_BYTES = 25 * 1024 * 1024

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


# ── 启动 / 关闭 ─────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """FastAPI 0.115+ 风格的 lifespan：迁移 + 建表 + 拉起 dispatcher + 清理上次残留。"""
    # Phase 2: 先迁移（如果旧 schema 在）；再 init_db（建 users + 重建 jobs + events）
    if migrate_v1_to_v2():
        log.warning("phase1 migrate_v1_to_v2 done; old jobs.db dropped")
    if migrate_v2_to_v3():
        log.warning("phase1 migrate_v2_to_v3 done; added jobs.require_confirm")
    if migrate_v3_to_v4():
        log.warning("phase1 migrate_v3_to_v4 done; added jobs.pending_confirm")
    init_db()  # 双保险
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    init_runtime()
    n = cleanup_stuck_jobs()
    if n:
        log.warning(f"cleaned up {n} stuck job(s) from previous run")
    # 启动 dispatcher：会扫一次 queued jobs 把上次遗留的拉起来
    start_dispatcher()
    # 启动 watchdog：每 60s 扫一次 running job，10 分钟没新 event → kill + mark failed
    start_watchdog()
    log.info("phase1 server ready")
    yield
    # 关闭：先停 watchdog（防止它在 shutdown 中再次 mark failed），
    # 再停 dispatcher（让 active job 自己跑完或被 docker stop）
    await stop_watchdog()
    await stop_dispatcher()
    log.info("phase1 server shutting down")


app = FastAPI(title="ppt-web MVP", lifespan=lifespan)
STATIC_DIR = HERE / "static"


# ── 鉴权端点 ────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    email: str = Field(..., max_length=255)
    password: str = Field(..., min_length=6, max_length=200)


class LoginRequest(BaseModel):
    email: str
    password: str


class UserOut(BaseModel):
    id: str
    email: str
    role: str
    quota_credits: int


def _user_to_dict(u: User) -> dict:
    return {
        "id": u.id,
        "email": u.email,
        "role": u.role,
        "quota_credits": u.quota_credits,
    }


@app.post("/api/auth/register", status_code=201)
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


@app.post("/api/auth/login")
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


@app.post("/api/auth/logout")
async def logout() -> dict:
    resp = JSONResponse({"ok": True})
    clear_auth_cookie(resp)
    return resp


@app.get("/api/auth/me")
async def me(user: OptionalUser) -> dict:
    if not user:
        raise HTTPException(401, "not authenticated")
    return _user_to_dict(user)


# ── 业务端点（需登录） ─────────────────────────────────────────────

@app.get("/api/health")
async def health() -> dict:
    return {
        "ok": True,
        "active_job": is_active(),
        "active_count": active_count(),
        "active_job_ids": active_job_ids(),
        "queue_length": queue_count(),
        "max_concurrent_jobs": MAX_CONCURRENT_JOBS,
    }


# ── 工具：把 Job 转 dict ────────────────────────────────────────────

def _job_to_dict(j: Job) -> dict:
    return {
        "id": j.id,
        "user_id": j.user_id,
        "prompt": j.prompt,
        "project_name": j.project_name,
        "status": j.status,
        "session_id": j.session_id,
        "project_dir": j.project_dir,
        "pptx_path": j.pptx_path,
        "cost_usd": j.cost_usd,
        "last_agent_text": j.last_agent_text,
        "last_event_seq": j.last_event_seq,
        "require_confirm": j.require_confirm,
        "error_message": j.error_message,
        "created_at": j.created_at.isoformat() if j.created_at else None,
        "updated_at": j.updated_at.isoformat() if j.updated_at else None,
        # 队列位置：只在 queued 时有意义；其他状态为 None
        "queue_position": queue_position(j.id),
    }


def _get_job_or_404(s, job_id: str) -> Job:
    j = s.get(Job, job_id)
    if not j:
        raise HTTPException(404, f"job {job_id} not found")
    return j


def _require_owner_or_admin(job: Job, user: User) -> None:
    """ownership 校验。admin 跳过。"""
    if user.role == "admin":
        return
    if job.user_id != user.id:
        raise HTTPException(403, "forbidden: not your job")


# ── POST /api/jobs（multipart/form-data） ──────────────────────────

@app.post("/api/jobs", status_code=201)
async def create_job(
    user: CurrentUser,
    prompt: Annotated[str, Form(min_length=1, max_length=20000)],
    project_name: Annotated[str | None, Form()] = None,
    files: Annotated[list[UploadFile], File()] = [],
) -> dict:
    """新建 job + staging 上传文件 + 入队等 dispatcher 调度。

    流程：
      1. 校验 prompt / 配额
      2. 建 Job 行（user_id，status=queued）
      3. mkdir uploads + project_root
      4. 流式写上传文件，校验大小 + 路径
      5. 预扣 1 credit（事务里）
      6. notify_dispatcher() — 后台 loop 看见有空位就把这个 job 拉起来跑
    """
    # 配额预扣 + job 创建（同一事务里原子；失败回滚）
    job_id = str(uuid.uuid4())
    pname = (project_name or f"web_{job_id[:8]}").strip()[:64]
    with SessionLocal() as s:
        u = s.get(User, user.id)
        if not u:
            raise HTTPException(401, "user not found")
        if u.quota_credits <= 0:
            raise HTTPException(402, "quota exhausted")
        u.quota_credits -= 1  # 预扣
        s.add(Job(
            id=job_id,
            user_id=u.id,
            prompt=prompt,
            project_name=pname,
            status="queued",
            # require_confirm 字段保留（DB schema 兼容），但永远 = False
            require_confirm=False,
        ))
        s.commit()

    # 建 staging 目录
    uploads_dir = uploads_dir_for(user.id, job_id)
    ensure_data_dirs(user.id, job_id)

    upload_paths: list[str] = []
    total = 0
    for f in files or []:
        if not f.filename:
            continue
        safe = safe_stage_name(f.filename)
        dest = uploads_dir / safe
        # 防越界：dest 必须在 uploads_dir 下
        if not is_under(dest, uploads_dir):
            log.warning(f"upload rejected (path traversal?): {f.filename}")
            continue
        size = 0
        try:
            with dest.open("wb") as out:
                while True:
                    chunk = await f.read(1024 * 1024)  # 1MB chunks
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > MAX_SINGLE_FILE_BYTES:
                        out.close()
                        dest.unlink(missing_ok=True)
                        # 配额 refund
                        with SessionLocal() as s2:
                            u2 = s2.get(User, user.id)
                            if u2:
                                u2.quota_credits += 1
                                s2.commit()
                        raise HTTPException(413, f"file {f.filename!r} exceeds {MAX_SINGLE_FILE_BYTES//1024//1024}MB")
                    total += len(chunk)
                    if total > MAX_UPLOAD_BYTES:
                        out.close()
                        dest.unlink(missing_ok=True)
                        with SessionLocal() as s2:
                            u2 = s2.get(User, user.id)
                            if u2:
                                u2.quota_credits += 1
                                s2.commit()
                        raise HTTPException(413, f"total upload exceeds {MAX_UPLOAD_BYTES//1024//1024}MB")
                    out.write(chunk)
        finally:
            await f.close()
        upload_paths.append(str(dest.resolve()))

    # 入队 → notify dispatcher。dispatcher 看见有空位才把这个 job 拉起来跑。
    notify_dispatcher()
    return {"id": job_id, "project_name": pname, "status": "queued", "uploads": len(upload_paths)}


# ── 列表 / 详情 ─────────────────────────────────────────────────────

@app.get("/api/jobs")
async def list_jobs(user: CurrentUser, limit: int = 50) -> dict:
    with SessionLocal() as s:
        rows = (
            s.query(Job)
            .filter(Job.user_id == user.id)
            .order_by(Job.updated_at.desc())
            .limit(limit)
            .all()
        )
    return {"jobs": [_job_to_dict(j) for j in rows]}


@app.get("/api/jobs/{job_id}")
async def get_job(job_id: str, user: CurrentUser) -> dict:
    with SessionLocal() as s:
        j = _get_job_or_404(s, job_id)
        _require_owner_or_admin(j, user)
        return _job_to_dict(j)


# ── resume / cancel ─────────────────────────────────────────────────

@app.post("/api/jobs/{job_id}/resume")
async def resume_job_endpoint(
    job_id: str,
    user: CurrentUser,
    request: Request,
    confirm: Annotated[str | None, Form()] = None,
) -> dict:
    """注入确认。accept 表单（与 phase0 CLI 兼容）和 JSON（前端 fetch）两种。

    注意：不要把 body 声明成 FastAPI 参数（即便标 Body(None) 也可能被 Pydantic 当 dict 校验，
    多 part 请求会触发 'Input should be a valid dictionary' 422）。改为手动按 Content-Type 取 JSON。
    """
    body_confirm = ""
    ctype = (request.headers.get("content-type") or "").lower()
    if "application/json" in ctype:
        try:
            raw = await request.json()
        except Exception:
            raw = None
        if isinstance(raw, dict):
            v = raw.get("confirm")
            if isinstance(v, str):
                body_confirm = v
    confirm_text = confirm or body_confirm or ""
    if not confirm_text.strip():
        log.warning("resume confirm empty: confirm=%r body_confirm=%r", confirm, body_confirm)
        raise HTTPException(400, "confirm text is required")
    with SessionLocal() as s:
        j = _get_job_or_404(s, job_id)
        _require_owner_or_admin(j, user)
        if j.status != "paused":
            raise HTTPException(400, f"job status is {j.status}, can only resume paused jobs")
        if not j.session_id:
            raise HTTPException(400, "no session_id to resume")
        # 把 status 改成 queued，让 dispatcher 看到后排进 FIFO；confirm 写到
        # Job.pending_confirm，dispatcher 拉起时优先 resume（pending_confirm 非空）。
        j.status = "queued"
        s.commit()
    queue_resume(job_id, confirm_text)
    return {"id": job_id, "status": "queued"}


@app.post("/api/jobs/{job_id}/cancel")
async def cancel_job_endpoint(job_id: str, user: CurrentUser) -> dict:
    with SessionLocal() as s:
        j = _get_job_or_404(s, job_id)
        _require_owner_or_admin(j, user)
    if j.status == "queued":
        with SessionLocal() as s:
            j2 = _get_job_or_404(s, job_id)
            _require_owner_or_admin(j2, user)
            if j2.status == "queued":
                j2.status = "cancelled"
                j2.error_message = "user cancelled"
                s.commit()
        return {"id": job_id, "status": "cancelled"}
    if not is_active(job_id):
        raise HTTPException(400, "this job is not currently active")
    ok = cancel_active(job_id)
    if not ok:
        raise HTTPException(500, "cancel failed")
    return {"id": job_id, "status": "cancelled"}


# ── SSE 事件流（ownership 校验） ────────────────────────────────────

@app.get("/api/jobs/{job_id}/events")
async def events_stream(
    job_id: str,
    request: Request,
    user: CurrentUser,
    from_seq: int | None = None,
):
    with SessionLocal() as s:
        j = _get_job_or_404(s, job_id)
        _require_owner_or_admin(j, user)

    if from_seq is None:
        hdr = request.headers.get("last-event-id")
        try:
            from_seq = int(hdr) if hdr else 0
        except ValueError:
            from_seq = 0

    async def gen():
        with SessionLocal() as s:
            rows = (
                s.query(Event)
                .filter(Event.job_id == job_id, Event.seq > from_seq)
                .order_by(Event.seq)
                .all()
            )
            replay_done_at = max((r.seq for r in rows), default=from_seq)
            history = [
                {"seq": r.seq, "type": r.type, "payload": json.loads(r.payload)}
                for r in rows
            ]
            current_status = s.get(Job, job_id).status if s.get(Job, job_id) else None

        for ev in history:
            if await request.is_disconnected():
                return
            yield _sse_format(ev)
            if ev["type"] in ("pptx",) and ev["payload"].get("url"):
                return

        if current_status in ("done", "failed", "cancelled"):
            return

        q = subscribe(job_id)
        try:
            while True:
                if await request.is_disconnected():
                    return
                try:
                    ev = await asyncio.wait_for(q.get(), timeout=15.0)
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
                    continue
                if ev["seq"] <= replay_done_at:
                    continue
                yield _sse_format(ev)
                if ev["type"] == "pptx" and ev["payload"].get("url"):
                    return
        finally:
            unsubscribe(job_id, q)

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


def _sse_format(ev: dict) -> str:
    return f"id: {ev['seq']}\nevent: {ev['type']}\ndata: {json.dumps(ev['payload'], ensure_ascii=False)}\n\n"


# ── 产物下载 ───────────────────────────────────────────────────────

@app.get("/api/jobs/{job_id}/pptx")
async def download_pptx(job_id: str, user: CurrentUser):
    with SessionLocal() as s:
        j = _get_job_or_404(s, job_id)
        _require_owner_or_admin(j, user)
        if not j.pptx_path or not Path(j.pptx_path).exists():
            raise HTTPException(404, "pptx not ready")
    return FileResponse(
        j.pptx_path,
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        filename=f"{j.project_name}.pptx",
    )


# ── 静态前端 ───────────────────────────────────────────────────────

if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR), html=False), name="static")

    @app.get("/")
    async def index() -> FileResponse:
        return FileResponse(STATIC_DIR / "index.html", media_type="text/html")
else:
    @app.get("/")
    async def root_fallback() -> PlainTextResponse:
        return PlainTextResponse(
            f"phase1/static/ not found (looked at {STATIC_DIR}); API is up — see /docs",
            status_code=200,
        )
