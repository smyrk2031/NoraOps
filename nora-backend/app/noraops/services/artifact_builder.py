"""Build and cache source zip artifacts from Gitea repos (Runner distribution)."""

from __future__ import annotations

import asyncio
import json
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote, urlparse

from app.core.config import Settings
from app.services.admin_config_service import RuntimeIntegrationConfig
from app.services.gitea_client import GiteaClientError
from app.noraops.services.zip_utils import zip_directory


def _artifacts_root(settings: Settings | None = None) -> Path:
    if settings:
        return settings.artifacts_abs_dir
    return Path("./data/noraops/artifacts").resolve()


def _git_exe() -> str:
    return shutil.which("git") or "git"


def _auth_clone_url(cfg: RuntimeIntegrationConfig, owner: str, name: str) -> str:
    if not cfg.gitea_base_url or not cfg.gitea_token:
        raise GiteaClientError("GITEA_BASE_URL and GITEA_TOKEN required for artifact build.")
    base = cfg.gitea_base_url.rstrip("/")
    parsed = urlparse(f"{base}/{owner}/{name}.git")
    host = parsed.netloc
    path_part = parsed.path if parsed.path.endswith(".git") else f"{parsed.path.rstrip('/')}.git"
    token = quote(cfg.gitea_token, safe="")
    return f"{parsed.scheme or 'http'}://{token}@{host}{path_part}"


def _repo_base(owner: str, name: str, settings: Settings | None = None) -> Path:
    return _artifacts_root(settings) / owner / name


def artifact_paths(owner: str, name: str, sha: str, settings: Settings | None = None) -> tuple[Path, Path]:
    base = _repo_base(owner, name, settings)
    zip_path = base / f"{sha}.zip"
    meta_path = base / "versions.json"
    return zip_path, meta_path


def _read_versions_meta(meta_path: Path) -> dict:
    if not meta_path.is_file():
        return {"versions": {}, "latestTag": "", "latestSha": ""}
    try:
        data = json.loads(meta_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"versions": {}, "latestTag": "", "latestSha": ""}
    if not isinstance(data.get("versions"), dict):
        data["versions"] = {}
    return data


def _write_versions_meta(
    meta_path: Path,
    *,
    tag: str,
    sha: str,
    branch: str,
    files: int,
) -> None:
    meta_path.parent.mkdir(parents=True, exist_ok=True)
    data = _read_versions_meta(meta_path)
    built_at = datetime.now(timezone.utc).isoformat()
    data["versions"][tag] = {
        "sha": sha,
        "branch": branch,
        "files": files,
        "builtAt": built_at,
    }
    data["latestTag"] = tag
    data["latestSha"] = sha
    meta_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _build_sync(
    cfg: RuntimeIntegrationConfig,
    owner: str,
    name: str,
    *,
    ref: str = "main",
    tag_label: str | None = None,
    settings: Settings | None = None,
) -> dict:
    git = _git_exe()
    url = _auth_clone_url(cfg, owner, name)
    ref = (ref or "main").strip() or "main"
    label = (tag_label or ref).strip()

    with tempfile.TemporaryDirectory(prefix="noraops-artifact-") as tmp:
        repo_dir = Path(tmp) / "repo"
        clone = subprocess.run(
            [git, "clone", "--depth", "1", "--branch", ref, url, str(repo_dir)],
            capture_output=True,
            text=True,
            timeout=180,
            env={**subprocess.os.environ, "GIT_TERMINAL_PROMPT": "0"},
        )
        if clone.returncode != 0:
            err = (clone.stderr or clone.stdout or "").strip()
            raise GiteaClientError(f"artifact clone failed: {err}")

        sha_proc = subprocess.run(
            [git, "-C", str(repo_dir), "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if sha_proc.returncode != 0:
            raise GiteaClientError("artifact: cannot resolve HEAD sha")
        sha = (sha_proc.stdout or "").strip()

        zip_path, meta_path = artifact_paths(owner, name, sha, settings)
        versions_meta = _read_versions_meta(meta_path)
        existing = (versions_meta.get("versions") or {}).get(label, {})
        if zip_path.is_file() and existing.get("sha") == sha:
            return {
                "ok": True,
                "cached": True,
                "owner": owner,
                "name": name,
                "sha": sha,
                "tag": label,
                "zipPath": str(zip_path),
            }

        count = zip_directory(repo_dir, zip_path)
        _write_versions_meta(meta_path, tag=label, sha=sha, branch=ref, files=count)
        thumb_src = repo_dir / "nora" / "assets" / "thumbnail.png"
        if thumb_src.is_file():
            shutil.copy2(thumb_src, meta_path.parent / "thumbnail.png")
        return {
            "ok": True,
            "cached": False,
            "owner": owner,
            "name": name,
            "sha": sha,
            "tag": label,
            "files": count,
            "zipPath": str(zip_path),
        }


class ArtifactBuilder:
    def __init__(self, cfg: RuntimeIntegrationConfig, settings: Settings) -> None:
        self._cfg = cfg
        self._settings = settings

    async def build(
        self,
        owner: str,
        name: str,
        branch: str = "main",
        *,
        tag: str | None = None,
    ) -> dict:
        ref = tag or branch
        label = tag or branch
        return await asyncio.to_thread(
            _build_sync,
            self._cfg,
            owner,
            name,
            ref=ref,
            tag_label=label,
            settings=self._settings,
        )

    def resolve_zip(self, owner: str, name: str, tag: str | None = None) -> Path | None:
        base = _repo_base(owner, name, self._settings)
        meta_path = base / "versions.json"
        if tag:
            data = _read_versions_meta(meta_path)
            entry = (data.get("versions") or {}).get(tag)
            if entry and entry.get("sha"):
                p = base / f"{entry['sha']}.zip"
                if p.is_file():
                    return p
            return None
        data = _read_versions_meta(meta_path)
        sha = str(data.get("latestSha") or "")
        if sha:
            p = base / f"{sha}.zip"
            if p.is_file():
                return p
        zips = sorted(base.glob("*.zip"), key=lambda p: p.stat().st_mtime, reverse=True)
        return zips[0] if zips else None

    def resolve_latest_zip(self, owner: str, name: str) -> Path | None:
        return self.resolve_zip(owner, name, tag=None)

    def list_cached_tags(self, owner: str, name: str) -> list[str]:
        meta_path = _repo_base(owner, name, self._settings) / "versions.json"
        data = _read_versions_meta(meta_path)
        return list((data.get("versions") or {}).keys())
