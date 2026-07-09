"""Provision Gitea users for NoraOps identities (admin PAT)."""

from __future__ import annotations

import secrets
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db.models import NoraOpsUser
from app.noraops.auth.email_util import normalize_email
from app.noraops.auth.identity import NoraOpsIdentity
from app.noraops.auth.identity_errors import IdentityCollisionError
from app.services.admin_config_service import AdminConfigService, RuntimeIntegrationConfig
from app.services.gitea_client import GiteaClient, GiteaClientError
from app.services.user_token_crypto import decrypt_token, encrypt_token


class GiteaProvisionError(GiteaClientError):
    """Gitea provisioning failed at a specific stage (config / user / token)."""

    def __init__(self, stage: str, message: str, *, hint: str | None = None) -> None:
        super().__init__(message, hint=hint)
        self.stage = stage


def _runtime_cfg(db: Session, settings: Settings) -> RuntimeIntegrationConfig:
    return AdminConfigService(db).resolve_runtime_config(settings)


async def _unique_login_async(client: GiteaClient, base: str, seed: str) -> str:
    candidate = base
    for suffix in range(0, 51):
        if suffix:
            candidate = f"{base}_{suffix}"[:40]
        user = await client.get_user(candidate)
        if not user:
            return candidate
    return f"{base}_{abs(hash(seed)) % 10000}"[:40]


def _persist_partial_gitea_row(
    db: Session,
    row: NoraOpsUser,
    *,
    login: str,
    gitea_id: int,
    norm_email: str,
) -> None:
    row.gitea_login = login
    if gitea_id:
        row.gitea_id = gitea_id
    if norm_email:
        row.verified_email = norm_email
    row.last_seen_at = datetime.now(timezone.utc)
    db.commit()


async def provision_gitea_for_canonical(
    db: Session,
    settings: Settings,
    row: NoraOpsUser,
    *,
    identity: NoraOpsIdentity,
    email: str | None = None,
) -> bool:
    """Idempotent Gitea user + PAT provisioning. Saves partial state on token failure."""
    if row.gitea_login and row.gitea_token_encrypted:
        return True

    cfg = _runtime_cfg(db, settings)
    if not cfg.gitea_base_url or not cfg.gitea_token:
        raise GiteaProvisionError(
            "config",
            "GITEA_BASE_URL または GITEA_TOKEN が未設定です。",
        )

    client = GiteaClient(cfg)
    login = (row.gitea_login or "").strip()
    if not login:
        login = await _unique_login_async(client, identity.gitea_login_candidate, identity.external_id)

    norm_email = normalize_email(email or "")
    if norm_email:
        gitea_email = norm_email
    else:
        domain = (settings.noraops_gitea_email_domain or "noreply.local").strip()
        gitea_email = f"{login}@{domain}"
    password = secrets.token_urlsafe(24)

    gitea_id = int(row.gitea_id or 0)
    existing = await client.get_user(login)
    if existing:
        gitea_id = int(existing.get("id") or gitea_id or 0)
    else:
        try:
            created = await client.admin_create_user(
                username=login,
                email=gitea_email,
                password=password,
                full_name=identity.username,
            )
        except GiteaClientError as e:
            fallback = await client.get_user(login)
            if not fallback:
                raise GiteaProvisionError("user", str(e), hint=e.hint) from e
            created = fallback
        gitea_id = int(created.get("id") or gitea_id or 0)

    _persist_partial_gitea_row(db, row, login=login, gitea_id=gitea_id, norm_email=norm_email)

    token_name = f"noraops-{login}"
    try:
        pat = await client.admin_create_user_token(login, token_name)
    except GiteaClientError as e:
        raise GiteaProvisionError("token", str(e), hint=e.hint) from e

    row.gitea_token_encrypted = encrypt_token(pat, settings)
    row.last_seen_at = datetime.now(timezone.utc)
    return True


async def resolve_noraops_user(
    db: Session,
    settings: Settings,
    identity: NoraOpsIdentity,
    *,
    verified_email: str | None = None,
    auto_provision: bool | None = None,
    create_stub_if_missing: bool = False,
) -> NoraOpsUser | None:
    if not identity or not identity.external_id:
        return None
    from app.noraops.auth.identity_resolver import resolve_identity

    try:
        result = await resolve_identity(
            db,
            settings,
            identity,
            verified_email=verified_email,
            auto_provision=auto_provision,
            create_stub_if_missing=create_stub_if_missing,
        )
    except IdentityCollisionError:
        return None
    if not result:
        return None
    result.user._primary_external_id = result.external_id  # type: ignore[attr-defined]
    return result.user


def user_gitea_token(row: NoraOpsUser | None, settings: Settings) -> str:
    if not row or not row.gitea_token_encrypted:
        return ""
    return decrypt_token(row.gitea_token_encrypted, settings)


def runtime_for_user(
    base_cfg: RuntimeIntegrationConfig,
    row: NoraOpsUser | None,
    settings: Settings,
) -> RuntimeIntegrationConfig:
    token = user_gitea_token(row, settings)
    if not token:
        return base_cfg
    from dataclasses import replace

    return replace(base_cfg, gitea_token=token)


def user_external_id(row: NoraOpsUser | None) -> str | None:
    if not row:
        return None
    ext = getattr(row, "_primary_external_id", None)
    if ext:
        return ext
    return row.canonical_user_id
