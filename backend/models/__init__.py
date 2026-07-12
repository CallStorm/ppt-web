"""SQLAlchemy ORM 模型。

Phase 2 起加了 User 表 + Job.user_id 外键。
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class User(Base):
    """一个用户。Phase 2 新增。

    email 唯一；password_hash 是 bcrypt 哈希串（passlib）。
    quota_credits 预扣式配额：创建 job 扣 1，失败 refund。
    role: 'user' | 'admin'（admin 跳过 ownership 校验）。
    """
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)  # uuid4
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    quota_credits: Mapped[int] = mapped_column(Integer, default=100, nullable=False)
    role: Mapped[str] = mapped_column(String(16), default="user", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )


class Job(Base):
    """一次 PPT 生成任务。

    status 流转：queued → running → (paused → running → ...) → done | failed | cancelled
    """
    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)  # uuid4
    # Phase 2: 多用户隔离。nullable=True 是过渡（migrate_v1_to_v2 不强求老数据；
    # 新创建的 job 必须填）。生产可以收紧为 nullable=False + server 端强制。
    user_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    project_name: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="queued")
    session_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    project_dir: Mapped[str | None] = mapped_column(Text, nullable=True)
    pptx_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    cost_usd: Mapped[float | None] = mapped_column(Float, nullable=True)
    last_agent_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_event_seq: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # 用户在创建 job 时勾选「需要 8 点确认」才会 true。默认 false——
    # agent 在 stage 3 end_turn 时直接自动 resume 出 pptx，不弹确认面板。
    # 老 job（迁移前创建的）会被 db.migrate_v2_to_v3() ALTER 加上，默认 0。
    require_confirm: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # dispatcher 用来区分「新 run」还是「resume」：非 NULL = 是 resume 的确认文本。
    # 之前用 in-memory dict，server crash 就丢——现在持久化到 DB，重启后 dispatcher 仍能识别。
    pending_confirm: Mapped[str | None] = mapped_column(Text, nullable=True)
    options_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    # revisions: this job was created as a modification of another (older) job.
    # Nullable for non-revision jobs. ON DELETE SET NULL so deleting the
    # parent doesn't cascade-delete the revision (the revision still has
    # its own pptx and the user can still download it).
    revision_of_job_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("jobs.id", ondelete="SET NULL"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )

    __table_args__ = (
        Index("ix_jobs_user_updated", "user_id", "updated_at"),
    )


class Event(Base):
    """一次 job 的原始事件流（供 SSE 续传 + 调试回放）。

    seq 是单 job 内单调递增的序号；SSE 客户端用 Last-Event-ID 续传。
    """
    __tablename__ = "events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    job_id: Mapped[str] = mapped_column(String(36), nullable=False)
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    type: Mapped[str] = mapped_column(String(32), nullable=False)
    payload: Mapped[str] = mapped_column(Text, nullable=False)  # JSON
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("ix_events_job_seq", "job_id", "seq"),
    )


class AppConfig(Base):
    """全局运行时配置（单行 id=1）。

    settings_json: 非 secret（并发、docker、watchdog、claude_env）
    secrets_json: API key/token 等 secret env
    """
    __tablename__ = "app_config"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    settings_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    secrets_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    updated_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )


class AdminActionLog(Base):
    """Admin 操作审计日志。"""
    __tablename__ = "admin_action_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    admin_user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    target_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    target_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    payload_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)


class Conversation(Base):
    """对话式 PPT 创作会话。

    phase 门控：intake → requirements → outline → style → generating → done
    draft_json 存当前规划快照；job_id 在确认生成后关联。
    """
    __tablename__ = "conversations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False, default="新对话")
    mode: Mapped[str] = mapped_column(String(16), nullable=False, default="create")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="planning")
    phase: Mapped[str] = mapped_column(String(16), nullable=False, default="intake")
    draft_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    job_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("jobs.id", ondelete="SET NULL"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )

    __table_args__ = (
        Index("ix_conversations_user_updated", "user_id", "updated_at"),
    )


class TemplateCategory(Base):
    """模板 UI 分类（系统内置 / 管理员创建 / 我的模板 标签）。"""
    __tablename__ = "template_categories"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    scope: Mapped[str] = mapped_column(String(16), nullable=False, default="admin")
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)


class Template(Base):
    """模板元数据索引；文件包在磁盘（system / global / user scope）。"""
    __tablename__ = "templates"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    slug: Mapped[str] = mapped_column(String(128), nullable=False)
    display_name: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    scope: Mapped[str] = mapped_column(String(16), nullable=False)
    owner_user_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    category_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("template_categories.id", ondelete="RESTRICT"), nullable=False
    )
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="ready")
    summary: Mapped[str] = mapped_column(Text, nullable=False, default="")
    primary_color: Mapped[str | None] = mapped_column(String(16), nullable=True)
    canvas_format: Mapped[str] = mapped_column(String(32), nullable=False, default="ppt169")
    page_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    page_types_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    storage_path: Mapped[str] = mapped_column(Text, nullable=False, default="")
    brief_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_job_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("jobs.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )

    __table_args__ = (
        Index("ix_templates_scope_kind_slug", "scope", "kind", "slug"),
        Index("ix_templates_owner_status", "owner_user_id", "status"),
    )


class Message(Base):
    """会话内一条消息（user / assistant / system）。"""
    __tablename__ = "messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    conversation_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    payload_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("ix_messages_conv_created", "conversation_id", "created_at"),
    )
