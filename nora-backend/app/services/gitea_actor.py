"""Gitea client scoped to the authenticated NoraOps user when available."""

from __future__ import annotations

from fastapi import Request
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.services.admin_config_service import AdminConfigService
from app.services.gitea_client import GiteaClient
from app.services.gitea_user_provision import runtime_for_user
from app.noraops.auth.user_deps import get_optional_noraops_user


async def gitea_client_for_request(
    db: Session,
    settings: Settings,
    request: Request | None = None,
) -> GiteaClient:
    cfg = AdminConfigService(db).resolve_runtime_config(settings)
    if request is not None:
        user = await get_optional_noraops_user(request, db, settings)
        cfg = runtime_for_user(cfg, user, settings)
    return GiteaClient(cfg)


async def gitea_login_for_request(
    db: Session,
    settings: Settings,
    request: Request | None,
) -> str | None:
    if request is None:
        return None
    user = await get_optional_noraops_user(request, db, settings)
    return user.gitea_login if user else None
