"""Package allowlist and dependency audit API."""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.db.models import TelemetryEvent
from app.db.session import get_session
from app.noraops.auth.user_deps import get_optional_noraops_user
from app.services.package_allowlist import (
    allowlist_summary,
    classify_packages,
    compute_etag,
    load_allowlist,
)

router = APIRouter(prefix="/api/v1/noraops/packages", tags=["noraops-packages"])


@router.get("/allowlist", response_model=None)
async def get_package_allowlist(
    response: Response,
    if_none_match: str | None = Header(default=None, alias="If-None-Match"),
) -> dict | Response:
    data = load_allowlist()
    etag = compute_etag(data)
    response.headers["ETag"] = f'"{etag}"'
    if if_none_match and if_none_match.strip('"') == etag:
        return Response(status_code=304)
    return data


class PackageRef(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    version: str = Field(default="", max_length=64)


class PackageCheckBody(BaseModel):
    packages: list[PackageRef] = Field(default_factory=list)


@router.post("/check")
async def check_packages(body: PackageCheckBody) -> dict:
    if not body.packages:
        return {"approved": [], "unapproved": [], "etag": compute_etag()}
    items = [{"name": p.name, "version": p.version or None} for p in body.packages]
    result = classify_packages(items)
    result["etag"] = compute_etag()
    return result


class DepsAuditBody(BaseModel):
    app_id: str = Field(default="", alias="appId", max_length=128)
    workspace: str = Field(default="", max_length=512)
    declared: list[str] = Field(default_factory=list)
    installed: list[PackageRef] = Field(default_factory=list)
    unapproved: list[str] = Field(default_factory=list)
    used_fallback: bool = Field(default=False, alias="usedFallback")

    model_config = {"populate_by_name": True}


@router.post("/deps-audit")
async def deps_audit(
    body: DepsAuditBody,
    request: Request,
    db: Session = Depends(get_session),
    user=Depends(get_optional_noraops_user),
) -> dict:
    user_email = ""
    canonical_user_id = ""
    if user is not None:
        user_email = str(getattr(user, "verified_email", "") or "").strip()
        canonical_user_id = str(getattr(user, "canonical_user_id", "") or "").strip()
    payload = {
        "appId": body.app_id,
        "workspace": body.workspace,
        "declared": body.declared,
        "installed": [p.model_dump() for p in body.installed],
        "unapproved": body.unapproved,
        "usedFallback": body.used_fallback,
        "userEmail": user_email,
        "canonicalUserId": canonical_user_id,
    }
    ip = request.client.host if request.client else ""
    ua = request.headers.get("user-agent", "")
    db.add(
        TelemetryEvent(
            event_type="deps_audit",
            source="extension",
            payload_json=json.dumps(payload, ensure_ascii=False),
            ip=ip,
            user_agent=ua,
        )
    )
    db.commit()
    return {"ok": True, "recorded": True}


def pypi_runtime_fields(settings: Settings, request: Request | None = None) -> dict:
    from app.core.root_path import resolve_public_url

    index_raw = (settings.noraops_pypi_index_url or "").strip()
    index_url = ""
    if index_raw:
        index_url = resolve_public_url(index_raw, request=request, settings=settings)
    return {
        "pypiIndexUrl": index_url,
        "pypiFallbackEnabled": settings.noraops_pypi_fallback_enabled,
        "packageAllowlistEtag": compute_etag(),
        "packageAllowlistCount": allowlist_summary().get("packageCount", 0),
    }
