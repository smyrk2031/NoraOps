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


async def provision_gitea_for_canonical(
    db: Session,
    settings: Settings,
    row: NoraOpsUser,
    *,
    identity: NoraOpsIdentity,
    email: str | None = None,
) -> bool:
    if row.gitea_login and row.gitea_token_encrypted:
        return True

    cfg = _runtime_cfg(db, settings)
    if not cfg.gitea_base_url or not cfg.gitea_token:
        return False

    client = GiteaClient(cfg)
    login = await _unique_login_async(client, identity.gitea_login_candidate, identity.external_id)
    norm_email = normalize_email(email or "")
    if norm_email:
        gitea_email = norm_email
    else:
        domain = (settings.noraops_gitea_email_domain or "noreply.local").strip()
        gitea_email = f"{login}@{domain}"
    password = secrets.token_urlsafe(24)
    try:
        created = await client.admin_create_user(
            username=login,
            email=gitea_email,
            password=password,
            full_name=identity.username,
        )
    except GiteaClientError:
        existing = await client.get_user(login)
        if not existing:
            raise
        created = existing

    gitea_id = int(created.get("id") or 0)
    token_name = f"noraops-{login}"
    pat = await client.admin_create_user_token(login, token_name)
    enc = encrypt_token(pat, settings)

    row.gitea_login = login
    row.gitea_id = gitea_id
    if norm_email:
        row.verified_email = norm_email
    row.gitea_token_encrypted = enc
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
