"""Authenticated user profile and export APIs."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.db.session import get_session
from app.noraops.auth.user_deps import require_noraops_user
from app.services.admin_config_service import AdminConfigService
from app.services.gitea_actor import gitea_client_for_request

router = APIRouter(prefix="/api/v1/noraops/me", tags=["noraops-me"])


@router.get("/repos/export")
async def export_my_repos(
    request: Request,
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    user=Depends(require_noraops_user),
) -> dict:
    client = await gitea_client_for_request(db, settings, request)
    cfg = AdminConfigService(db).resolve_runtime_config(settings)
    repos = await client.list_org_repos()
    login = user.gitea_login
    base = (cfg.gitea_base_url or "").rstrip("/")
    items = []
    for repo in repos:
        owner_obj = repo.get("owner") or {}
        owner = owner_obj.get("login") if isinstance(owner_obj, dict) else str(owner_obj or "")
        name = repo.get("name") or ""
        if owner != login:
            continue
        clone = repo.get("clone_url") or repo.get("ssh_url") or ""
        if not clone and base:
            clone = f"{base}/{owner}/{name}.git"
        items.append(
            {
                "owner": owner,
                "name": name,
                "fullName": repo.get("full_name") or f"{owner}/{name}",
                "cloneUrl": clone,
                "htmlUrl": repo.get("html_url") or (f"{base}/{owner}/{name}" if base else ""),
                "private": bool(repo.get("private")),
            }
        )
    return {
        "ok": True,
        "giteaLogin": login,
        "repos": items,
        "exportHint": "git clone --mirror <cloneUrl> でミラー取得し、新ホストへ git push --mirror",
    }
