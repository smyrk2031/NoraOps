"""Portal-facing JSON APIs for Runner (VS Code) and future Tauri."""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.db.models import RunnerActivityLog
from app.core.root_path import configured_root_path, join_root_path, public_base_url, resolve_request_root_path
from app.db.session import get_session
from app.noraops.auth.deps import require_read_session
from app.noraops.services.artifact_builder import ArtifactBuilder
from app.noraops.services.catalog_meta import enrich_catalog_item, resolve_thumbnail_file
from app.noraops.services.published_catalog import PublishedCatalogService
from app.noraops.services.published_version_service import catalog_version_summary
from app.services.admin_config_service import AdminConfigService
from app.services.catalog_service import CatalogService
from app.services.gitea_actor import gitea_client_for_request, gitea_login_for_request
from app.services.gitea_client import GiteaClientError
from app.noraops.auth.user_deps import external_id_for_user, get_optional_noraops_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/portal", tags=["noraops-portal"])


class RunnerActivityPayload(BaseModel):
    app_full_name: str = Field(min_length=1, max_length=512)
    action: str = Field(default="launch", max_length=64)
    user_label: str = Field(default="", max_length=256)
    payload: dict = Field(default_factory=dict)


@router.post("/runner-activity")
async def log_runner_activity(
    body: RunnerActivityPayload,
    request: Request,
    db: Session = Depends(get_session),
) -> dict:
    ip = request.client.host if request.client else ""
    ua = request.headers.get("user-agent", "")
    db.add(
        RunnerActivityLog(
            app_full_name=body.app_full_name,
            action=body.action,
            user_label=body.user_label,
            payload_json=json.dumps(body.payload or {}, ensure_ascii=False),
            ip=ip,
            user_agent=ua,
        )
    )
    db.commit()
    return {"ok": True}


@router.get("/health")
async def portal_health(
    request: Request,
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
) -> dict:
    root = resolve_request_root_path(request, settings)
    user = await get_optional_noraops_user(request, db, settings)
    identity = getattr(request.state, "noraops_identity", None)
    out: dict = {
        "status": "ok",
        "component": "noraops-portal-api",
        "phase": "1b",
        "rootPath": root or "/",
        "publicBaseUrl": public_base_url(request, settings),
        "authMode": settings.noraops_auth_mode,
    }
    if user:
        out["user"] = {
            "externalId": external_id_for_user(db, user),
            "giteaLogin": user.gitea_login,
            "canonicalUserId": user.canonical_user_id,
        }
    elif identity and getattr(identity, "external_id", None):
        out["identity"] = {"externalId": identity.external_id}
    return out


@router.get("/catalog/published")
async def list_published_catalog(
    request: Request,
    q: str = Query("", max_length=200),
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
) -> dict:
    """
    Approved apps only (Phase1b thin: Gitea topic filter).

    Set topic `nora-published` on a repo to list it. Dev: NORAOPS_CATALOG_DEV_SHOW_ALL=1 shows all repos.
    """
    try:
        client = await gitea_client_for_request(db, settings, request)
        repos = await client.list_org_repos()
    except GiteaClientError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e

    items = CatalogService().build_items(repos)
    topic = settings.noraops_published_topic
    dev_all = settings.noraops_catalog_dev_show_all
    filtered, dev_fallback = PublishedCatalogService().filter_items(
        items,
        topic=topic,
        query=q,
        dev_show_all=dev_all,
    )
    hint = None
    if not filtered:
        if not items:
            hint = (
                "Gitea からリポジトリが 0 件です。"
                "GITEA_TOKEN・GITEA_BASE_URL・GITEA_LIST_MODE を確認し、FastAPI を再起動してください。"
            )
        elif not dev_all:
            hint = (
                f"Gitea には {len(items)} 件ありますが、公開 topic「{topic}」付きが 0 件です。"
                "空リポでも表示できます。Gitea の test01 に topic を付けるか、"
                "開発用に .env の NORAOPS_CATALOG_DEV_SHOW_ALL=1 を入れて FastAPI を再起動してください。"
            )
        elif q:
            hint = f"検索「{q}」に一致するリポがありません（全 {len(items)} 件から絞り込み）。"
        else:
            hint = "表示対象のリポがありません。"

    enriched = []
    for it in filtered:
        row = enrich_catalog_item(it, settings, request=request)
        o = str(it.get("owner") or "").strip()
        n = str(it.get("name") or "").strip()
        if o and n:
            row.update(catalog_version_summary(db, o, n))
        enriched.append(row)

    return {
        "count": len(enriched),
        "items": enriched,
        "query": q,
        "hint": hint,
        "stats": {
            "fromGitea": len(items),
            "publishedTopic": topic,
        },
        "filter": {
            "topic": topic,
            "devShowAll": dev_fallback,
            "devShowAllEnabled": dev_all,
        },
    }


@router.get("/catalog/published/{owner}/{name}")
async def published_app_detail(
    request: Request,
    owner: str,
    name: str,
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
) -> dict:
    """Run metadata for Runner (clone path hints; client builds authenticated clone URL)."""
    try:
        client = await gitea_client_for_request(db, settings, request)
        repos = await client.list_org_repos()
    except GiteaClientError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e

    full = f"{owner}/{name}".lower()
    match = None
    for repo in repos:
        fn = str(repo.get("full_name") or "").lower()
        if fn == full:
            match = repo
            break
        o = repo.get("owner")
        login = o.get("login", "") if isinstance(o, dict) else ""
        if login.lower() == owner.lower() and str(repo.get("name") or "").lower() == name.lower():
            match = repo
            break

    if not match:
        raise HTTPException(status_code=404, detail="repository not found")

    items = CatalogService().build_items([match])
    item = items[0] if items else {}
    topics = item.get("topics") or []
    published = settings.noraops_published_topic in topics
    if not published and not settings.noraops_catalog_dev_show_all:
        raise HTTPException(status_code=404, detail="repository not published")

    cfg = AdminConfigService(db).resolve_runtime_config(settings)
    base = (cfg.gitea_base_url or settings.gitea_base_url or "").rstrip("/")
    root = resolve_request_root_path(request, settings)
    artifact_path = join_root_path(root, f"/api/v1/portal/apps/{owner}/{name}/artifact")
    detail = {
        "full_name": item.get("full_name") or f"{owner}/{name}",
        "name": name,
        "owner": owner,
        "description": item.get("description"),
        "updated_at": item.get("updated_at"),
        "published": published,
        "giteaBaseUrl": base,
        "artifactUrl": artifact_path,
        "defaultBranch": "main",
        "runHint": "Download source zip + uv sync + uv run (pyproject はルート/直下1階層/nora/packages を自動探索)",
    }
    builder = ArtifactBuilder(cfg, settings)
    detail = enrich_catalog_item(detail, settings, request=request)
    detail.update(catalog_version_summary(db, owner, name))
    return detail


@router.get("/apps/{owner}/{name}/thumbnail")
async def app_thumbnail(
    owner: str,
    name: str,
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
) -> Response:
    """Runner 一覧用サムネイル（公開アプリのみ・認証不要）。"""
    cfg = AdminConfigService(db).resolve_runtime_config(settings)
    builder = ArtifactBuilder(cfg, settings)
    thumb = resolve_thumbnail_file(settings, owner, name, builder)
    if not thumb or not thumb.is_file():
        raise HTTPException(status_code=404, detail="thumbnail not found")
    return FileResponse(path=thumb, media_type="image/png", filename="thumbnail.png")


@router.get("/apps/{owner}/{name}/artifact")
async def download_app_artifact(
    owner: str,
    name: str,
    tag: str = Query("", max_length=72),
    version: str = Query("", max_length=64),
    _read_token: str = Depends(require_read_session),
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
) -> FileResponse:
    """
    Published source zip for Runner (requires read session).
    ``tag`` or ``version`` で版を指定（未指定=最新公開版）。
    """
    from app.noraops.services.published_version_service import get_latest_published, version_to_tag

    cfg = AdminConfigService(db).resolve_runtime_config(settings)
    builder = ArtifactBuilder(cfg, settings)
    ref_tag = (tag or "").strip()
    if not ref_tag and (version or "").strip():
        ref_tag = version_to_tag(version.strip())
    if not ref_tag:
        latest = get_latest_published(db, owner, name)
        ref_tag = latest.tag if latest else ""

    zip_path = builder.resolve_zip(owner, name, tag=ref_tag or None)
    if not zip_path or not zip_path.is_file():
        logger.info("artifact cache miss %s/%s tag=%s — building", owner, name, ref_tag or "latest")
        try:
            if ref_tag:
                result = await builder.build(owner, name, tag=ref_tag)
            else:
                result = await builder.build(owner, name)
            logger.info(
                "artifact built on demand %s/%s sha=%s cached=%s",
                owner,
                name,
                result.get("sha"),
                result.get("cached"),
            )
            zip_path = builder.resolve_zip(owner, name, tag=ref_tag or result.get("tag"))
        except GiteaClientError as e:
            logger.warning("artifact build failed %s/%s: %s", owner, name, e)
            raise HTTPException(status_code=503, detail=str(e)) from e
    if not zip_path or not zip_path.is_file():
        raise HTTPException(status_code=404, detail="artifact not found; publish the app first")

    logger.info("artifact download %s/%s path=%s tag=%s", owner, name, zip_path, ref_tag)
    suffix = ref_tag.replace("/", "_") if ref_tag else "latest"
    return FileResponse(
        path=zip_path,
        media_type="application/zip",
        filename=f"{owner}-{name}-{suffix}.zip",
    )
