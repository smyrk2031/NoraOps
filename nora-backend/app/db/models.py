from datetime import datetime
import uuid

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class AppConfig(Base):
    __tablename__ = "app_config"

    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class ApiAccessLog(Base):
    __tablename__ = "api_access_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    path: Mapped[str] = mapped_column(String(512), nullable=False)
    method: Mapped[str] = mapped_column(String(16), nullable=False)
    status_code: Mapped[int] = mapped_column(Integer, nullable=False)
    latency_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    ip: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    user_agent: Mapped[str] = mapped_column(String(512), default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class DownloadLog(Base):
    __tablename__ = "download_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tool_name: Mapped[str] = mapped_column(String(64), nullable=False)
    version: Mapped[str] = mapped_column(String(64), nullable=False)
    filename: Mapped[str] = mapped_column(String(256), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    detail: Mapped[str] = mapped_column(Text, default="", nullable=False)
    ip: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    user_agent: Mapped[str] = mapped_column(String(512), default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class TelemetryEvent(Base):
    __tablename__ = "telemetry_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    event_type: Mapped[str] = mapped_column(String(128), nullable=False)
    source: Mapped[str] = mapped_column(String(64), default="extension", nullable=False)
    payload_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)
    ip: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    user_agent: Mapped[str] = mapped_column(String(512), default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class RunnerActivityLog(Base):
    """Runner 起動・利用の記録（拡張 / テレメトリから投入）。"""

    __tablename__ = "runner_activity_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_label: Mapped[str] = mapped_column(String(256), default="", nullable=False)
    app_full_name: Mapped[str] = mapped_column(String(512), nullable=False)
    action: Mapped[str] = mapped_column(String(64), default="launch", nullable=False)
    payload_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)
    ip: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    user_agent: Mapped[str] = mapped_column(String(512), default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class AppRegistryEntry(Base):
    """Immutable appId ↔ Gitea repo binding (save validation)."""

    __tablename__ = "nora_app_registry"

    app_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    owner: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    display_name: Mapped[str] = mapped_column(String(256), default="", nullable=False)
    gitea_repo_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class PublishedVersion(Base):
    """Runner 公開版（git tag + artifact）の記録。"""

    __tablename__ = "nora_published_versions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    owner: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    version: Mapped[str] = mapped_column(String(64), nullable=False)
    tag: Mapped[str] = mapped_column(String(72), nullable=False)
    commit_sha: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    published_by_email: Mapped[str] = mapped_column(String(256), default="", nullable=False)
    published_by_login: Mapped[str] = mapped_column(String(100), default="", nullable=False)
    published_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class NoraOpsUser(Base):
    """Canonical NoraOps user (1 person = 1 Gitea user)."""

    __tablename__ = "noraops_users"

    canonical_user_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    gitea_login: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    gitea_id: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    verified_email: Mapped[str] = mapped_column(String(256), default="", nullable=False, index=True)
    gitea_token_encrypted: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class NoraOpsIdentityRow(Base):
    """External identity alias (Windows login, email OTP, etc.)."""

    __tablename__ = "noraops_identities"

    external_id: Mapped[str] = mapped_column(String(256), primary_key=True)
    canonical_user_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("noraops_users.canonical_user_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    email: Mapped[str] = mapped_column(String(256), default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class NoraOpsSession(Base):
    """DB-backed sliding session for email_otp auth."""

    __tablename__ = "noraops_sessions"

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    canonical_user_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("noraops_users.canonical_user_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    last_seen_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    absolute_expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class NoraOpsOtpChallenge(Base):
    """One-time password challenge for email login."""

    __tablename__ = "noraops_otp_challenges"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email_normalized: Mapped[str] = mapped_column(String(256), nullable=False, index=True)
    otp_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    consumed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class NoraOpsAccessToken(Base):
    """Long-lived access token for VS Code extension (email_token auth)."""

    __tablename__ = "noraops_access_tokens"

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    canonical_user_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("noraops_users.canonical_user_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    label: Mapped[str] = mapped_column(String(64), default="default", nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    last_used_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class NoraOpsEmailActivation(Base):
    """メール有効化・トークン再発行用ワンタイムリンク。"""

    __tablename__ = "noraops_email_activations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    external_id: Mapped[str] = mapped_column(String(256), nullable=False, index=True)
    email_normalized: Mapped[str] = mapped_column(String(256), nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    consumed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class McpAuditLog(Base):
    __tablename__ = "mcp_audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tool_name: Mapped[str] = mapped_column(String(128), nullable=False)
    caller: Mapped[str] = mapped_column(String(128), default="", nullable=False)
    success: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    payload_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class RepoAuditState(Base):
    """Gitea リポジトリのポリシー監査結果（watermark + 最新サマリー）。"""

    __tablename__ = "repo_audit_states"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    owner: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    full_name: Mapped[str] = mapped_column(String(220), nullable=False, unique=True, index=True)
    last_gitea_updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_audit_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_audit_trigger: Mapped[str] = mapped_column(String(32), default="", nullable=False)
    readme_path: Mapped[str] = mapped_column(String(128), default="", nullable=False)
    readme_excerpt: Mapped[str] = mapped_column(Text, default="", nullable=False)
    pyproject_rel: Mapped[str] = mapped_column(String(256), default="", nullable=False)
    policy_ok: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    error_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    warn_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    result_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
