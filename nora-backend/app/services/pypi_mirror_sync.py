"""Mirror PyPI wheels/sdists for allowlisted packages into local pypiserver directory."""

from __future__ import annotations

import json
import logging
import re
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from app.core.config import Settings, get_settings
from app.services.data_bootstrap import resolve_data_root
from app.services.package_allowlist import load_allowlist, normalize_pkg_name

logger = logging.getLogger(__name__)

_STATUS_REL = "noraops/packages/mirror-status.json"
_WHEEL_RE = re.compile(
    r"^(.+?)-(\d+(?:\.\d+)*)-",
    re.IGNORECASE,
)


def mirror_status_path() -> Path:
    return resolve_data_root() / _STATUS_REL


def _list_mirror_artifacts(mirror_dir: Path) -> dict[str, set[str]]:
    """package name → set of version strings found in filenames."""
    found: dict[str, set[str]] = {}
    if not mirror_dir.is_dir():
        return found
    for p in mirror_dir.iterdir():
        if not p.is_file():
            continue
        m = _WHEEL_RE.match(p.name)
        if not m:
            continue
        pkg = normalize_pkg_name(m.group(1).replace("_", "-"))
        ver = m.group(2)
        found.setdefault(pkg, set()).add(ver)
    return found


def _download_package(pkg_name: str, version_spec: str, dest: Path) -> list[str]:
    dest.mkdir(parents=True, exist_ok=True)
    cmd = ["python", "-m", "pip", "download", "--dest", str(dest), "--no-deps"]
    if version_spec:
        cmd.append(f"{pkg_name}{version_spec}")
    else:
        cmd.append(pkg_name)
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or proc.stdout or "pip download failed").strip()[:500])
    return [p.name for p in dest.iterdir() if p.is_file()]


def _archive_removed(mirror_dir: Path, archive_dir: Path, keep_names: set[str]) -> list[str]:
    archived: list[str] = []
    archive_dir.mkdir(parents=True, exist_ok=True)
    if not mirror_dir.is_dir():
        return archived
    for p in mirror_dir.iterdir():
        if not p.is_file():
            continue
        m = _WHEEL_RE.match(p.name)
        if not m:
            continue
        pkg = normalize_pkg_name(m.group(1).replace("_", "-"))
        if pkg in keep_names:
            continue
        target = archive_dir / p.name
        if target.exists():
            target.unlink()
        shutil.move(str(p), str(target))
        archived.append(p.name)
        logger.info("archived mirror artifact: %s", p.name)
    return archived


def run_mirror_sync(settings: Settings | None = None) -> dict:
    settings = settings or get_settings()
    mirror_dir = settings.pypi_mirror_abs_dir
    archive_dir = settings.pypi_mirror_archive_abs_dir
    mirror_dir.mkdir(parents=True, exist_ok=True)

    allow = load_allowlist()
    packages = allow.get("packages") or []
    keep_names = {normalize_pkg_name(str(p.get("name") or "")) for p in packages}
    keep_names.discard("")

    existing = _list_mirror_artifacts(mirror_dir)
    fetched: list[dict] = []
    failures: list[dict] = []

    for row in packages:
        name = normalize_pkg_name(str(row.get("name") or ""))
        if not name:
            continue
        spec = str(row.get("versionSpec") or row.get("version_spec") or "").strip()
        have = existing.get(name, set())
        if have and not spec:
            continue
        try:
            files = _download_package(name, spec, mirror_dir)
            fetched.append({"name": name, "files": files})
        except Exception as e:
            failures.append({"name": name, "error": str(e)})

    archived = _archive_removed(mirror_dir, archive_dir, keep_names)

    status = {
        "schema": "nora.pypi-mirror-status/1",
        "completedAt": datetime.now(timezone.utc).isoformat(),
        "mirrorDir": str(mirror_dir),
        "allowlistCount": len(packages),
        "fetched": len(fetched),
        "failures": failures,
        "archived": archived,
    }
    path = mirror_status_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(status, ensure_ascii=False, indent=2), encoding="utf-8")
    return status
