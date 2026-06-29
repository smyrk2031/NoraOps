"""Catalog enrichment: artifact sha, thumbnail paths for Runner."""

from __future__ import annotations

import json
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from starlette.requests import Request

from app.core.config import Settings
from app.core.root_path import public_base_url
from app.noraops.services.artifact_builder import ArtifactBuilder, _artifacts_root


def server_public_base(settings: Settings, request: Request | None = None) -> str:
    return public_base_url(request, settings)


def read_artifact_meta(settings: Settings, owner: str, name: str) -> dict[str, Any]:
    base = _artifacts_root(settings) / owner / name
    versions_path = base / "versions.json"
    meta_path = base / "latest.json"
    out: dict[str, Any] = {"sha": "", "branch": "main", "builtAt": None, "tag": ""}
    if versions_path.is_file():
        try:
            data = json.loads(versions_path.read_text(encoding="utf-8"))
            out["sha"] = str(data.get("latestSha") or "")
            out["tag"] = str(data.get("latestTag") or "")
            ver = (data.get("versions") or {}).get(out["tag"]) or {}
            out["branch"] = str(ver.get("branch") or "main")
            out["builtAt"] = ver.get("builtAt")
        except (OSError, json.JSONDecodeError):
            pass
    elif meta_path.is_file():
        try:
            data = json.loads(meta_path.read_text(encoding="utf-8"))
            out["sha"] = str(data.get("sha") or "")
            out["branch"] = str(data.get("branch") or "main")
            out["builtAt"] = data.get("builtAt")
        except (OSError, json.JSONDecodeError):
            pass
    thumb = base / "thumbnail.png"
    if thumb.is_file():
        try:
            out["thumbnailMtime"] = datetime.fromtimestamp(
                thumb.stat().st_mtime, tz=timezone.utc
            ).isoformat()
        except OSError:
            pass
    return out


def _extract_thumbnail_from_zip(zip_path: Path, dest: Path) -> bool:
    try:
        with zipfile.ZipFile(zip_path, "r") as zf:
            for member in ("nora/assets/thumbnail.png", "assets/thumbnail.png"):
                if member in zf.namelist():
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    dest.write_bytes(zf.read(member))
                    return True
    except (OSError, zipfile.BadZipFile):
        return False
    return False


def resolve_thumbnail_file(
    settings: Settings,
    owner: str,
    name: str,
    builder: ArtifactBuilder | None = None,
) -> Path | None:
    """Cached thumbnail.png under artifacts/{owner}/{name}/."""
    base = _artifacts_root(settings) / owner / name
    cached = base / "thumbnail.png"
    if cached.is_file():
        return cached
    b = builder
    if b is None:
        from app.services.admin_config_service import RuntimeIntegrationConfig

        b = ArtifactBuilder(RuntimeIntegrationConfig(), settings)
    zip_path = b.resolve_latest_zip(owner, name)
    if zip_path and zip_path.is_file() and _extract_thumbnail_from_zip(zip_path, cached):
        return cached
    return None


def thumbnail_url(settings: Settings, owner: str, name: str, request: Request | None = None) -> str:
    base = server_public_base(settings, request)
    path = f"/api/v1/portal/apps/{owner}/{name}/thumbnail"
    return f"{base.rstrip('/')}{path}"


def enrich_catalog_item(
    item: dict[str, Any],
    settings: Settings,
    *,
    request: Request | None = None,
    include_thumbnail: bool = True,
) -> dict[str, Any]:
    full = str(item.get("full_name") or "")
    if "/" not in full:
        return item
    owner, name = full.split("/", 1)
    meta = read_artifact_meta(settings, owner, name)
    sha = meta.get("sha") or ""
    out = {**item, "artifactSha": sha, "artifactBuiltAt": meta.get("builtAt")}
    if include_thumbnail:
        out["thumbnailUrl"] = thumbnail_url(settings, owner, name, request)
        out["hasThumbnail"] = (_artifacts_root(settings) / owner / name / "thumbnail.png").is_file()
    return out
