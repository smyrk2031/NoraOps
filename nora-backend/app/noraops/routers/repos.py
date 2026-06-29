"""Gitea repo provision for NoraOps4code (FastAPI-15)."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.db.session import get_session
from app.noraops.auth.deps import require_push_session
from app.noraops.services.app_registry_service import AppRegistryError
from app.noraops.services.repo_provision import RepoProvisionService
from app.noraops.services.repo_publish import RepoPublishService
from app.noraops.services.repo_push import RepoPushService
from app.noraops.services.repo_save import RepoSaveService
from app.noraops.services.published_version_service import (
    get_latest_published,
    publish_state_payload,
    publisher_fields,
    validate_version_bump,
    version_to_tag,
)
from app.services.admin_config_service import AdminConfigService
from app.services.gitea_actor import gitea_client_for_request, gitea_login_for_request
from app.services.gitea_client import GiteaClient, GiteaClientError
from app.services.gitea_user_provision import runtime_for_user
from app.noraops.auth.user_deps import get_optional_noraops_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/repos", tags=["noraops-repos"])


async def _provision_service(
    db: Session,
    settings: Settings,
    request: Request | None = None,
) -> RepoProvisionService:
    client = await gitea_client_for_request(db, settings, request)
    cfg = AdminConfigService(db).resolve_runtime_config(settings)
    user = await get_optional_noraops_user(request, db, settings) if request else None
    cfg = runtime_for_user(cfg, user, settings)
    return RepoProvisionService(client, cfg, db)


async def _publish_service(
    db: Session,
    settings: Settings,
    request: Request | None = None,
) -> RepoPublishService:
    client = await gitea_client_for_request(db, settings, request)
    cfg = AdminConfigService(db).resolve_runtime_config(settings)
    user = await get_optional_noraops_user(request, db, settings) if request else None
    cfg = runtime_for_user(cfg, user, settings)
    return RepoPublishService(client, cfg, settings)


def _push_service(db: Session, settings: Settings) -> RepoPushService:
    cfg = AdminConfigService(db).resolve_runtime_config(settings)
    return RepoPushService(cfg)


async def _save_service(
    db: Session,
    settings: Settings,
    request: Request | None = None,
) -> RepoSaveService:
    client = await gitea_client_for_request(db, settings, request)
    cfg = AdminConfigService(db).resolve_runtime_config(settings)
    user = await get_optional_noraops_user(request, db, settings) if request else None
    cfg = runtime_for_user(cfg, user, settings)
    return RepoSaveService(cfg, settings, client, db)


class ProvisionBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    owner: str | None = None
    display_name: str = ""
    app_id: str = Field(..., min_length=8, max_length=128)
    private: bool = True


@router.get("/check-name")
async def check_repo_name(
    request: Request,
    name: str,
    owner: str | None = None,
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> dict:
    actor = await gitea_login_for_request(db, settings, request)
    try:
        return await (await _provision_service(db, settings, request)).check_name(
            name, owner, actor_login=actor
        )
    except GiteaClientError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e


@router.post("/provision")
async def provision_repo(
    body: ProvisionBody,
    request: Request,
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> dict:
    actor = await gitea_login_for_request(db, settings, request)
    try:
        result = await (await _provision_service(db, settings, request)).provision(
            body.name,
            owner=body.owner or actor,
            display_name=body.display_name,
            app_id=body.app_id,
            private=body.private,
            actor_login=actor,
        )
    except GiteaClientError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e

    if not result.get("ok"):
        raise HTTPException(status_code=409, detail=result)
    return result


class PublishBody(BaseModel):
    owner: str = Field(..., min_length=1, max_length=100)
    name: str = Field(..., min_length=1, max_length=100)
    version: str = Field(default="", max_length=64)


@router.get("/publish-state")
async def repo_publish_state(
    owner: str,
    name: str,
    local_version: str = "",
    db: Session = Depends(get_session),
) -> dict:
    """公開版一覧と次に使える版番号（拡張 UI 用）。"""
    return publish_state_payload(
        db,
        owner.strip(),
        name.strip(),
        local_version=local_version.strip() or None,
    )


@router.post("/publish")
async def publish_repo(
    body: PublishBody,
    request: Request,
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> dict:
    """Runner 公開（topic + 版 tag + artifact）。版未指定時は従来の topic のみ。"""
    o, n = body.owner.strip(), body.name.strip()
    version = (body.version or "").strip()
    try:
        svc = await _publish_service(db, settings, request)
        if not version:
            return await svc.publish(o, n)
        user = await get_optional_noraops_user(request, db, settings)
        email, login = publisher_fields(user, settings)
        latest = get_latest_published(db, o, n)
        latest_ver = latest.version if latest else None
        normalized = validate_version_bump(version, latest_ver)
        return await svc.publish_version(
            db,
            o,
            n,
            version=normalized,
            commit_sha="",
            publisher_email=email,
            publisher_login=login,
            latest_version=latest_ver,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except GiteaClientError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e


@router.post("/push")
async def push_repo_bundle(
    owner: str = Form(...),
    name: str = Form(...),
    branch: str = Form("main"),
    push_all: bool = Form(False),
    bundle: UploadFile = File(...),
    _push_token: str = Depends(require_push_session),
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> dict:
    """
    **Deprecated:** use ``POST /api/v1/repos/save`` (workspace zip). Legacy git bundle push.

    Requires a short-lived push session from ``POST /api/v1/noraops/push/sessions``.
    """
    data = await bundle.read()
    if len(data) > settings.push_max_bundle_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"Bundle too large (max {settings.noraops_push_max_bundle_mb} MB).",
        )
    try:
        return await _push_service(db, settings).push_bundle(
            owner.strip(),
            name.strip(),
            data,
            branch=branch,
            push_all=push_all,
        )
    except GiteaClientError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e


@router.post("/save")
async def save_repo_zip(
    request: Request,
    owner: str = Form(...),
    name: str = Form(...),
    branch: str = Form("main"),
    message: str = Form("NoraOps save"),
    app_id: str = Form(""),
    publish: bool = Form(False),
    version: str = Form(""),
    workspace: UploadFile = File(...),
    _push_token: str = Depends(require_push_session),
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> dict:
    """
    Receive workspace zip from NoraOps4code; safe extract + git push on server.
    Uses the authenticated user's PAT when available; falls back to GITEA_TOKEN in open mode.
    """
    data = await workspace.read()
    if len(data) > settings.save_max_zip_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"Zip too large (max {settings.noraops_save_max_zip_mb} MB).",
        )
    o, n = owner.strip(), name.strip()
    logger.info("repos/save %s/%s zip_bytes=%s publish=%s", o, n, len(data), publish)
    user = await get_optional_noraops_user(request, db, settings)
    email, login = publisher_fields(user, settings)
    publish_tag: str | None = None
    normalized_version: str | None = None
    latest = get_latest_published(db, o, n)
    latest_ver = latest.version if latest else None
    try:
        if publish:
            if not (version or "").strip():
                raise ValueError("Runner 公開には版番号が必要です。")
            normalized_version = validate_version_bump(version.strip(), latest_ver)
            publish_tag = version_to_tag(normalized_version)
        result = await (await _save_service(db, settings, request)).save_zip(
            o,
            n,
            data,
            branch=branch,
            message=message or (f"Release {publish_tag}" if publish_tag else "NoraOps save"),
            app_id=app_id.strip() or None,
            publish_tag=publish_tag,
        )
        if publish and normalized_version:
            try:
                pub = await (await _publish_service(db, settings, request)).publish_version(
                    db,
                    o,
                    n,
                    version=normalized_version,
                    commit_sha=str(result.get("commitSha") or ""),
                    publisher_email=email,
                    publisher_login=login,
                    latest_version=latest_ver,
                )
                result["publish"] = pub
            except (GiteaClientError, ValueError) as e:
                logger.warning("repos/save publish failed %s/%s: %s", o, n, e)
                result["publish"] = {"ok": False, "error": str(e)}
        logger.info("repos/save ok %s/%s", o, n)
        return result
    except AppRegistryError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except GiteaClientError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
