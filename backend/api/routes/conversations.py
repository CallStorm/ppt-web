"""Conversations API — 对话式 PPT 创作。"""
from __future__ import annotations

import json
import logging
import shutil
import uuid
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field, ValidationError

from backend.api.deps import get_job_or_404, job_to_dict, require_owner_or_admin
from backend.api.schemas.job_options import job_options_from_form
from backend.app import chat_orchestrator as orch
from backend.app.document_extract import DocumentExtractError, extract_document_text
from backend.auth import CurrentUser
from backend.db.session import SessionLocal
from backend.models import Conversation, Job, Message, User
from backend.paths import (
    conversation_uploads_dir,
    ensure_data_dirs,
    is_under,
    safe_stage_name,
    uploads_dir_for,
)
from backend.runtime import notify_dispatcher

router = APIRouter(prefix="/conversations", tags=["conversations"])
log = logging.getLogger("backend.api.conversations")

MAX_UPLOAD_BYTES = 50 * 1024 * 1024
MAX_SINGLE_FILE_BYTES = 25 * 1024 * 1024


class DraftPatchBody(BaseModel):
    patch: dict = Field(default_factory=dict)
    action: str | None = None  # requirements_submit | outline_confirm | style_confirm


class GenerateBody(BaseModel):
    confirmed: bool = True


def _conv_or_404(s, conv_id: str) -> Conversation:
    c = s.get(Conversation, conv_id)
    if not c:
        raise HTTPException(404, f"conversation {conv_id} not found")
    return c


def _require_owner(conv: Conversation, user: User) -> None:
    if user.role == "admin":
        return
    if conv.user_id != user.id:
        raise HTTPException(403, "forbidden: not your conversation")


def _message_to_dict(m: Message) -> dict:
    payload: dict = {}
    try:
        payload = json.loads(m.payload_json or "{}")
    except json.JSONDecodeError:
        pass
    return {
        "id": m.id,
        "conversation_id": m.conversation_id,
        "role": m.role,
        "content": m.content,
        "payload": payload,
        "created_at": m.created_at.isoformat() if m.created_at else None,
    }


def _sync_job_status(s, conv: Conversation) -> bool:
    """若关联 job 已终态，回写会话 status/phase 并追加 done 消息。"""
    if not conv.job_id:
        return False
    job = s.get(Job, conv.job_id)
    if not job:
        return False
    if job.status == "done" and conv.status != "done":
        conv.status = "done"
        conv.phase = "done"
        existing = (
            s.query(Message)
            .filter(Message.conversation_id == conv.id)
            .all()
        )
        has_done = any(
            json.loads(m.payload_json or "{}").get("type") == "job_done"
            for m in existing
            if m.payload_json
        )
        if not has_done:
            pptx_url = f"/api/jobs/{job.id}/download" if job.pptx_path else None
            s.add(
                Message(
                    id=orch.new_message_id(),
                    conversation_id=conv.id,
                    role="assistant",
                    content="PPT 已生成完成，可以下载。",
                    payload_json=json.dumps(
                        {
                            "type": "job_done",
                            "job_id": job.id,
                            "pptx_url": pptx_url,
                            "widgets": [{"type": "download", "job_id": job.id}],
                        },
                        ensure_ascii=False,
                    ),
                )
            )
        return True
    if job.status == "failed" and conv.status == "generating":
        conv.status = "failed"
        s.add(
            Message(
                id=orch.new_message_id(),
                conversation_id=conv.id,
                role="assistant",
                content=f"生成失败：{job.error_message or '未知错误'}",
                payload_json=json.dumps({"type": "job_failed", "job_id": job.id}),
            )
        )
        return True
    return False


def _conversation_to_dict(s, conv: Conversation, *, include_messages: bool = False) -> dict:
    draft = orch.parse_draft(conv.draft_json)
    out: dict[str, Any] = {
        "id": conv.id,
        "user_id": conv.user_id,
        "title": conv.title,
        "mode": conv.mode,
        "status": conv.status,
        "phase": conv.phase,
        "draft": draft,
        "job_id": conv.job_id,
        "created_at": conv.created_at.isoformat() if conv.created_at else None,
        "updated_at": conv.updated_at.isoformat() if conv.updated_at else None,
    }
    if conv.job_id:
        job = s.get(Job, conv.job_id)
        if job:
            out["job"] = {
                "id": job.id,
                "status": job.status,
                "pptx_path": job.pptx_path,
            }
    if include_messages:
        rows = (
            s.query(Message)
            .filter(Message.conversation_id == conv.id)
            .order_by(Message.created_at.asc())
            .all()
        )
        out["messages"] = [_message_to_dict(m) for m in rows]
    return out


@router.get("")
async def list_conversations(
    user: CurrentUser,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict:
    with SessionLocal() as s:
        q = s.query(Conversation).filter(Conversation.user_id == user.id)
        total = q.count()
        rows = (
            q.order_by(Conversation.updated_at.desc())
            .offset(offset)
            .limit(limit)
            .all()
        )
        for c in rows:
            _sync_job_status(s, c)
        s.commit()
        return {
            "conversations": [_conversation_to_dict(s, c) for c in rows],
            "total": total,
            "limit": limit,
            "offset": offset,
        }


@router.post("", status_code=201)
async def create_conversation(
    user: CurrentUser,
    mode: Annotated[str, Form()] = "create",
) -> dict:
    conv_id = str(uuid.uuid4())
    with SessionLocal() as s:
        s.add(
            Conversation(
                id=conv_id,
                user_id=user.id,
                title="新对话",
                mode=mode if mode in ("create", "beautify") else "create",
                status="planning",
                phase="intake",
                draft_json=orch.dump_draft(orch.empty_draft()),
            )
        )
        s.commit()
        conv = _conv_or_404(s, conv_id)
        return _conversation_to_dict(s, conv)


@router.get("/{conv_id}")
async def get_conversation(conv_id: str, user: CurrentUser) -> dict:
    with SessionLocal() as s:
        conv = _conv_or_404(s, conv_id)
        _require_owner(conv, user)
        _sync_job_status(s, conv)
        s.commit()
        return _conversation_to_dict(s, conv, include_messages=True)


@router.delete("/{conv_id}", status_code=204)
async def delete_conversation(conv_id: str, user: CurrentUser) -> None:
    with SessionLocal() as s:
        conv = _conv_or_404(s, conv_id)
        _require_owner(conv, user)
        s.delete(conv)
        s.commit()


@router.patch("/{conv_id}/draft")
async def patch_draft(conv_id: str, body: DraftPatchBody, user: CurrentUser) -> dict:
    with SessionLocal() as s:
        conv = _conv_or_404(s, conv_id)
        _require_owner(conv, user)
        draft = orch.parse_draft(conv.draft_json)
        action = body.action
        patch = body.patch or {}

        snapshot: dict | None = None
        if action == "requirements_submit":
            req_patch = orch.apply_requirements_submit(draft, patch.get("requirements") or patch)
            orch._deep_merge(draft, req_patch)
            conv.phase = "outline"
            reply = "需求已确认，我根据你的要求生成了大纲初稿，请检查并修改。"
            snapshot = {"requirements": draft.get("requirements")}
        elif action == "outline_confirm":
            orch._deep_merge(draft, orch.apply_outline_confirm(draft))
            if patch.get("outline"):
                draft["outline"] = patch["outline"]
            conv.phase = "style"
            reply = "大纲已确认，请选择视觉风格。"
            snapshot = {"outline": draft.get("outline")}
        elif action == "style_confirm":
            orch._deep_merge(draft, orch.apply_style_confirm(draft, patch.get("options")))
            if patch.get("template") is not None:
                draft["template"] = patch["template"]
            conv.phase = "style"
            reply = "风格已选定。确认方案后即可开始生成。"
            snapshot = {
                "options": draft.get("options"),
                "template": draft.get("template"),
            }
        else:
            orch._deep_merge(draft, patch)
            reply = "已更新方案。"

        conv.draft_json = orch.dump_draft(draft)
        payload: dict = {"type": "draft_updated", "action": action}
        if snapshot:
            payload["snapshot"] = snapshot
        msg = Message(
            id=orch.new_message_id(),
            conversation_id=conv.id,
            role="system",
            content=reply,
            payload_json=json.dumps(payload, ensure_ascii=False),
        )
        s.add(msg)
        s.commit()
        return {
            "conversation": _conversation_to_dict(s, conv),
            "message": _message_to_dict(msg),
        }


@router.post("/{conv_id}/messages")
async def post_message(
    conv_id: str,
    user: CurrentUser,
    content: Annotated[str, Form()] = "",
    files: Annotated[list[UploadFile], File()] = [],
) -> dict:
    text = (content or "").strip()
    if not text and not files:
        raise HTTPException(400, "content or files required")

    with SessionLocal() as s:
        conv = _conv_or_404(s, conv_id)
        _require_owner(conv, user)
        if conv.status == "generating":
            raise HTTPException(400, "conversation is generating; wait for completion")

        draft = orch.parse_draft(conv.draft_json)
        upload_dir = conversation_uploads_dir(user.id, conv.id)
        upload_dir.mkdir(parents=True, exist_ok=True)

        document_text: str | None = None
        uploads = list(draft.get("uploads") or [])
        total = 0
        for f in files or []:
            if not f.filename:
                continue
            safe = safe_stage_name(f.filename)
            dest = upload_dir / safe
            if not is_under(dest, upload_dir):
                continue
            size = 0
            try:
                with dest.open("wb") as out:
                    while True:
                        chunk = await f.read(1024 * 1024)
                        if not chunk:
                            break
                        size += len(chunk)
                        total += len(chunk)
                        if size > MAX_SINGLE_FILE_BYTES or total > MAX_UPLOAD_BYTES:
                            dest.unlink(missing_ok=True)
                            raise HTTPException(413, "upload too large")
                        out.write(chunk)
            finally:
                await f.close()
            uploads.append({"name": safe, "path": str(dest.resolve())})
            try:
                document_text = extract_document_text(dest)
            except DocumentExtractError:
                pass
        if uploads:
            draft["uploads"] = uploads

        if not text and document_text:
            text = "请根据我上传的文档帮我做一份 PPT"

        user_msg = Message(
            id=orch.new_message_id(),
            conversation_id=conv.id,
            role="user",
            content=text,
            payload_json=json.dumps(
                {"uploads": [u["name"] for u in uploads]} if uploads else {},
                ensure_ascii=False,
            ),
        )
        s.add(user_msg)

        if conv.phase == "intake" and not draft.get("core_topic"):
            if len(text) > 0:
                conv.title = text[:80]

        history_rows = (
            s.query(Message)
            .filter(Message.conversation_id == conv.id, Message.role.in_(("user", "assistant")))
            .order_by(Message.created_at.asc())
            .all()
        )
        history = [{"role": m.role, "content": m.content} for m in history_rows]
        history.append({"role": "user", "content": text})

        if conv.phase == "intake":
            plan, _, _ = orch.handle_intake(draft, text, document_text=document_text)
        else:
            plan, _ = orch.handle_message(
                phase=conv.phase,
                draft=draft,
                user_text=text,
                history=history,
            )

        draft_patch = plan.get("draft_patch") or {}
        if draft_patch:
            orch._deep_merge(draft, draft_patch)
        conv.draft_json = orch.dump_draft(draft)

        next_phase = plan.get("next_phase") or conv.phase
        if next_phase in orch.PHASES and conv.status == "planning":
            conv.phase = next_phase

        widgets = plan.get("widgets") or []
        assistant_msg = Message(
            id=orch.new_message_id(),
            conversation_id=conv.id,
            role="assistant",
            content=plan.get("reply") or "好的。",
            payload_json=json.dumps(
                {"widgets": widgets, "intent": plan.get("intent")},
                ensure_ascii=False,
            ),
        )
        s.add(assistant_msg)
        s.commit()

        return {
            "conversation": _conversation_to_dict(s, conv),
            "user_message": _message_to_dict(user_msg),
            "assistant_message": _message_to_dict(assistant_msg),
        }


@router.post("/{conv_id}/generate", status_code=201)
async def generate_from_conversation(
    conv_id: str,
    user: CurrentUser,
    body: GenerateBody | None = None,
) -> dict:
    with SessionLocal() as s:
        conv = _conv_or_404(s, conv_id)
        _require_owner(conv, user)
        if conv.job_id:
            job = s.get(Job, conv.job_id)
            if job and job.status in ("queued", "running", "paused"):
                raise HTTPException(400, "job already in progress")

        draft = orch.parse_draft(conv.draft_json)
        if not orch._draft_ready(draft):
            raise HTTPException(422, "draft incomplete; confirm requirements, outline, and style first")

        form = orch.draft_to_job_form(draft)
        try:
            opts = job_options_from_form(**form)
        except (ValidationError, ValueError) as e:
            raise HTTPException(422, detail=str(e)) from e

        core = (draft.get("core_topic") or "").strip()
        outline_titles = orch._structured_to_outline_titles(draft.get("outline") or [])
        prompt = core
        if outline_titles:
            prompt = f"{core}\n\n章节：\n" + "\n".join(f"- {t}" for t in outline_titles)

        job_id = str(uuid.uuid4())
        pname = f"chat_{job_id[:8]}"
        options_json = json.dumps(opts.model_dump())

        u = s.get(User, user.id)
        if not u:
            raise HTTPException(401, "user not found")
        if u.quota_credits <= 0:
            raise HTTPException(402, "quota exhausted")
        u.quota_credits -= 1

        s.add(
            Job(
                id=job_id,
                user_id=u.id,
                prompt=prompt,
                project_name=pname,
                status="queued",
                require_confirm=False,
                options_json=options_json,
            )
        )
        # MySQL enforces FK on commit; flush job row before linking conversation.job_id.
        s.flush()

        ensure_data_dirs(user.id, job_id)
        job_uploads = uploads_dir_for(user.id, job_id)
        for item in draft.get("uploads") or []:
            src = Path(item.get("path") or "")
            if src.is_file():
                dest = job_uploads / item.get("name", src.name)
                if is_under(dest, job_uploads):
                    shutil.copy2(src, dest)

        conv.job_id = job_id
        conv.status = "generating"
        conv.phase = "generating"
        conv.draft_json = orch.dump_draft(draft)

        start_msg = Message(
            id=orch.new_message_id(),
            conversation_id=conv.id,
            role="assistant",
            content="已开始生成，进度如下。生成引擎将自动完成全部流程。",
            payload_json=json.dumps(
                {
                    "type": "job_started",
                    "job_id": job_id,
                    "widgets": [{"type": "job_progress", "job_id": job_id}],
                },
                ensure_ascii=False,
            ),
        )
        s.add(start_msg)
        s.commit()

    notify_dispatcher()
    with SessionLocal() as s2:
        job = get_job_or_404(s2, job_id)
        return {
            "job_id": job_id,
            "job": job_to_dict(job),
            "conversation": _conversation_to_dict(s2, _conv_or_404(s2, conv_id)),
        }
