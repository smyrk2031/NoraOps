"""NoraOps client distribution API (extension .vsix update notice)."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, Header, Request
from sqlalchemy.orm import Session

from pydantic import BaseModel, Field

from app.core.config import Settings, get_settings
from app.core.root_path import resolve_public_url
from app.db.session import get_session
from app.noraops.auth.deps import get_push_session_store
from app.noraops.routers.packages import pypi_runtime_fields
from app.services.admin_config_service import AdminConfigService
from app.services.gitea_client import GiteaClient
from app.services.gitea_token_check import classify_gitea_token

router = APIRouter(prefix="/api/v1/noraops", tags=["noraops-client"])

_CLIENT_LATEST_PATH = Path("./data/noraops/client-latest.json")


def _load_client_latest_file() -> dict | None:
    path = _CLIENT_LATEST_PATH.resolve()
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


@router.get("/client/latest")
async def client_latest(
    request: Request,
    settings: Settings = Depends(get_settings),
) -> dict:
    """
    Extension update metadata for NoraOps4code (.vsix).

    Priority: data/noraops/client-latest.json > env SOFTRAIL_CLIENT_* > defaults.
    """
    data = _load_client_latest_file() or {}
    version = str(data.get("version") or "0.0.0")
    vsix_raw = str(
        data.get("vsixUrl")
        or data.get("vsix_url")
        or settings.client_download_url
        or ""
    )
    vsix_url = resolve_public_url(vsix_raw, request=request, settings=settings)
    now = datetime.now(timezone.utc).isoformat()
    return {
        "component": str(data.get("component") or "noraops4code"),
        "version": version,
        "vsixUrl": vsix_url,
        "releaseNotes": str(data.get("releaseNotes") or data.get("release_notes") or ""),
        "publishedAt": str(data.get("publishedAt") or data.get("published_at") or now),
        "minHostVersion": str(data.get("minHostVersion") or data.get("min_host_version") or "1.88.0"),
    }


@router.get("/client/runtime-config")
async def client_runtime_config(
    request: Request,
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> dict:
    """
    NoraOps4code 拡張向けの Gitea 接続情報（表示用 URL 等）。

    保存は ``POST /api/v1/repos/save``（zip）、Runner は artifact GET。PAT は既定で拡張へ渡さない。
    """
    cfg = AdminConfigService(db).resolve_runtime_config(settings)
    base = (cfg.gitea_base_url or "").rstrip("/")
    default_owner = cfg.gitea_orgs[0] if cfg.gitea_orgs else ""
    expose_token = settings.expose_gitea_token_to_client
    token_info = classify_gitea_token(cfg.gitea_token)
    return {
        "giteaBaseUrl": base,
        "giteaDefaultOwner": default_owner,
        "giteaPushToken": cfg.gitea_token if expose_token else "",
        "giteaTokenConfigured": bool(cfg.gitea_token),
        "giteaTokenFormat": token_info.get("format"),
        "giteaTokenIssue": token_info.get("issue"),
        "giteaTokenHint": token_info.get("hint"),
        "giteaOrgs": cfg.gitea_orgs,
        "exposeGiteaToken": expose_token,
        "saveViaZip": True,
        "artifactDownload": True,
        **pypi_runtime_fields(settings, request),
    }


class PushSessionBody(BaseModel):
    device_label: str = Field(default="", max_length=200)
    scope: str = Field(default="write", description="write=save/push, read=artifact download")


@router.post("/push/sessions")
async def create_push_session(
    request: Request,
    body: PushSessionBody | None = None,
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
    x_noraops_device_token: str | None = Header(default=None, alias="X-NoraOps-Device-Token"),
    x_noraops_session_token: str | None = Header(default=None, alias="X-NoraOps-Session-Token"),
    x_noraops_access_token: str | None = Header(default=None, alias="X-NoraOps-Access-Token"),
) -> dict:
    """
    Issue a short-lived token for ``POST /api/v1/repos/save`` (write) or artifact GET (read).

    ``email_token`` 時は ``X-NoraOps-Access-Token`` が必要。
    ``email_otp`` 時は ``X-NoraOps-Session-Token`` が必要。
    """
    from app.noraops.routers.auth import resolve_subject_for_push_session

    store = get_push_session_store(settings)
    label = (body.device_label if body else "") or ""
    scope_raw = (body.scope if body else "write") or "write"
    scope = "read" if scope_raw.strip().lower() == "read" else "write"
    subject = await resolve_subject_for_push_session(
        request,
        db,
        settings,
        device_token=x_noraops_device_token,
        device_label=label,
        session_token=x_noraops_session_token,
        access_token=x_noraops_access_token,
    )
    info = store.create_push_session(subject=subject, scope=scope)
    return {
        "pushToken": info.token,
        "expiresAt": info.expires_at.isoformat(),
        "subject": info.subject,
        "scope": info.scope,
        "ttlMinutes": settings.noraops_push_session_ttl_minutes,
    }


@router.get("/client/gitea-status")
async def client_gitea_status(
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> dict:
    """Gitea 接続とトークン形式の診断（リポ作成前の確認用）。"""
    cfg = AdminConfigService(db).resolve_runtime_config(settings)
    token_info = classify_gitea_token(cfg.gitea_token)
    out: dict = {
        "giteaBaseUrl": (cfg.gitea_base_url or "").rstrip("/"),
        "token": token_info,
        "userReachable": False,
        "canCreateRepo": None,
        "login": None,
    }
    if not cfg.gitea_base_url or not cfg.gitea_token:
        return out
    client = GiteaClient(cfg)
    user = await client.get_current_user()
    if user:
        out["userReachable"] = True
        out["login"] = user.get("login")
    probe = await client.probe_create_permission()
    out["canCreateRepo"] = probe.get("ok")
    if not probe.get("ok"):
        out["createRepoError"] = probe.get("reason")
        if probe.get("hint"):
            out["createRepoHint"] = probe.get("hint")
    return out
