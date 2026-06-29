"""Save workspace zip to Gitea via server-side git (extension never runs git)."""

from __future__ import annotations

import asyncio
import json
import shutil
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import quote, urlparse

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.noraops.services.app_registry_service import (
    AppRegistryError,
    AppRegistryService,
    read_manifest_app_id,
)
from app.noraops.services.zip_utils import safe_extract_zip, scan_forbidden_secrets
from app.services.admin_config_service import RuntimeIntegrationConfig
from app.services.gitea_client import GiteaClient, GiteaClientError


class RepoSaveService:
    def __init__(
        self,
        cfg: RuntimeIntegrationConfig,
        settings: Settings,
        client: GiteaClient | None = None,
        db: Session | None = None,
    ) -> None:
        self._cfg = cfg
        self._settings = settings
        self._client = client
        self._db = db

    async def ensure_repo_exists(self, owner: str, name: str) -> dict:
        """Create Gitea repo if missing (zip save always targets an existing remote name)."""
        if not self._client:
            return {"existed": False, "created": False}
        existing = await self._client.get_repo(owner, name)
        if existing:
            gitea_repo_id = int(existing.get("id") or 0) or None
            if self._db and gitea_repo_id:
                try:
                    AppRegistryService(self._db).backfill_gitea_repo_id(owner, name, gitea_repo_id)
                except AppRegistryError:
                    pass
            return {
                "existed": True,
                "created": False,
                "full_name": existing.get("full_name"),
                "gitea_repo_id": gitea_repo_id,
            }
        created = await self._client.create_repo(
            owner,
            name,
            private=True,
            description=f"NoraOps {name}",
        )
        gitea_repo_id = int(created.get("id") or 0) or None
        if self._db and gitea_repo_id:
            try:
                AppRegistryService(self._db).backfill_gitea_repo_id(owner, name, gitea_repo_id)
            except AppRegistryError:
                pass
        return {
            "existed": False,
            "created": True,
            "full_name": created.get("full_name") or f"{owner}/{name}",
            "gitea_repo_id": gitea_repo_id,
        }

    def _git_exe(self) -> str:
        return shutil.which("git") or "git"

    def _authenticated_remote_url(self, owner: str, name: str) -> str:
        if not self._cfg.gitea_base_url or not self._cfg.gitea_token:
            raise GiteaClientError("GITEA_BASE_URL and GITEA_TOKEN are required for server save.")
        base = self._cfg.gitea_base_url.rstrip("/")
        parsed = urlparse(f"{base}/{owner}/{name}.git")
        host = parsed.netloc or parsed.path.split("/")[0]
        path_part = parsed.path or f"/{owner}/{name}.git"
        if not path_part.endswith(".git"):
            path_part = f"{path_part.rstrip('/')}.git"
        token = quote(self._cfg.gitea_token, safe="")
        return f"{parsed.scheme or 'http'}://{token}@{host}{path_part}"

    def _save_sync(
        self,
        owner: str,
        name: str,
        zip_data: bytes,
        *,
        branch: str = "main",
        message: str = "NoraOps save",
        form_app_id: str | None = None,
        gitea_repo_id: int | None = None,
        publish_tag: str | None = None,
    ) -> dict:
        if not zip_data:
            raise GiteaClientError("Empty workspace zip.")
        git = self._git_exe()
        remote_url = self._authenticated_remote_url(owner, name)
        branch = (branch or "main").strip() or "main"
        max_bytes = self._settings.save_max_zip_bytes
        commit_sha = ""
        tag_name = ""

        with tempfile.TemporaryDirectory(prefix="noraops-save-") as tmp:
            tmp_path = Path(tmp)
            work_dir = tmp_path / "workspace"
            safe_extract_zip(zip_data, work_dir, max_bytes=max_bytes)

            forbidden = scan_forbidden_secrets(work_dir)
            if forbidden:
                raise GiteaClientError(
                    f"Forbidden files in zip: {', '.join(forbidden[:5])}"
                    + (" …" if len(forbidden) > 5 else "")
                )

            manifest_app_id = read_manifest_app_id(work_dir)
            if form_app_id and manifest_app_id and form_app_id.strip() != manifest_app_id:
                raise AppRegistryError(
                    f"Request app_id {form_app_id} does not match manifest {manifest_app_id}."
                )

            if self._db:
                registry = AppRegistryService(self._db)
                entry = registry.get_by_repo(owner, name)
                if entry:
                    registry.validate_save(owner, name, manifest_app_id)
                    if gitea_repo_id:
                        registry.backfill_gitea_repo_id(owner, name, gitea_repo_id)
                elif manifest_app_id:
                    display_name = ""
                    manifest_path = work_dir / "nora" / "manifest.json"
                    if manifest_path.is_file():
                        try:
                            display_name = json.loads(manifest_path.read_text(encoding="utf-8")).get(
                                "displayName", ""
                            )
                        except (json.JSONDecodeError, OSError):
                            pass
                    registry.adopt_legacy_repo(
                        owner,
                        name,
                        manifest_app_id,
                        display_name=str(display_name or ""),
                        gitea_repo_id=gitea_repo_id,
                    )
                else:
                    raise AppRegistryError(
                        f"Repository {owner}/{name} requires nora/manifest.json with appId."
                    )

            env = {**subprocess.os.environ, "GIT_TERMINAL_PROMPT": "0"}

            init = subprocess.run(
                [git, "init"],
                cwd=work_dir,
                capture_output=True,
                text=True,
                timeout=60,
            )
            if init.returncode != 0:
                err = (init.stderr or init.stdout or "").strip()
                raise GiteaClientError(f"git init failed: {err}")

            subprocess.run(
                [git, "config", "user.email", "noraops@local"],
                cwd=work_dir,
                capture_output=True,
                text=True,
                check=False,
            )
            subprocess.run(
                [git, "config", "user.name", "NoraOps"],
                cwd=work_dir,
                capture_output=True,
                text=True,
                check=False,
            )

            add = subprocess.run(
                [git, "add", "-A"],
                cwd=work_dir,
                capture_output=True,
                text=True,
                timeout=120,
            )
            if add.returncode != 0:
                err = (add.stderr or add.stdout or "").strip()
                raise GiteaClientError(f"git add failed: {err}")

            commit = subprocess.run(
                [git, "commit", "-m", message or "NoraOps save"],
                cwd=work_dir,
                capture_output=True,
                text=True,
                timeout=120,
            )
            if commit.returncode != 0:
                err = (commit.stderr or commit.stdout or "").strip()
                if "nothing to commit" not in err.lower():
                    raise GiteaClientError(f"git commit failed: {err}")

            subprocess.run(
                [git, "branch", "-M", branch],
                cwd=work_dir,
                capture_output=True,
                text=True,
                check=False,
            )
            subprocess.run(
                [git, "remote", "add", "origin", remote_url],
                cwd=work_dir,
                capture_output=True,
                text=True,
                check=False,
            )

            push = subprocess.run(
                [git, "push", "-u", "origin", branch, "--force"],
                cwd=work_dir,
                capture_output=True,
                text=True,
                timeout=180,
                env=env,
            )
            if push.returncode != 0:
                err = (push.stderr or push.stdout or "").strip()
                if "not found" in err.lower():
                    raise GiteaClientError(
                        f"Gitea にリポジトリ {owner}/{name} がありません（サーバー側 git push）。"
                        f" Gitea でリポを作成するか、保存時に「新規 Gitea リポジトリを作成」を選んでください。詳細: {err}"
                    )
                raise GiteaClientError(f"git push failed: {err}")

            sha_proc = subprocess.run(
                [git, "rev-parse", "HEAD"],
                cwd=work_dir,
                capture_output=True,
                text=True,
                timeout=30,
            )
            commit_sha = (sha_proc.stdout or "").strip() if sha_proc.returncode == 0 else ""

            tag_name = (publish_tag or "").strip()
            if tag_name and commit_sha:
                tag_msg = message or f"NoraOps publish {tag_name}"
                tag_res = subprocess.run(
                    [git, "tag", "-f", tag_name, "-m", tag_msg],
                    cwd=work_dir,
                    capture_output=True,
                    text=True,
                    timeout=60,
                )
                if tag_res.returncode != 0:
                    err = (tag_res.stderr or tag_res.stdout or "").strip()
                    raise GiteaClientError(f"git tag failed: {err}")
                tag_push = subprocess.run(
                    [git, "push", "-f", "origin", tag_name],
                    cwd=work_dir,
                    capture_output=True,
                    text=True,
                    timeout=180,
                    env=env,
                )
                if tag_push.returncode != 0:
                    err = (tag_push.stderr or tag_push.stdout or "").strip()
                    raise GiteaClientError(f"git push tag failed: {err}")

        return {
            "ok": True,
            "owner": owner,
            "name": name,
            "branch": branch,
            "full_name": f"{owner}/{name}",
            "via": "zip",
            "commitSha": commit_sha,
            "publishedTag": tag_name or None,
        }

    async def save_zip(
        self,
        owner: str,
        name: str,
        zip_data: bytes,
        *,
        branch: str = "main",
        message: str = "NoraOps save",
        app_id: str | None = None,
        publish_tag: str | None = None,
    ) -> dict:
        provision = await self.ensure_repo_exists(owner, name)
        gid = provision.get("gitea_repo_id")
        result = await asyncio.to_thread(
            self._save_sync,
            owner,
            name,
            zip_data,
            branch=branch,
            message=message,
            form_app_id=app_id,
            gitea_repo_id=gid,
            publish_tag=publish_tag,
        )
        if provision.get("created"):
            result["repoCreated"] = True
        if provision.get("gitea_repo_id"):
            result["gitea_repo_id"] = provision["gitea_repo_id"]
        if (
            self._settings.noraops_repo_audit_enabled
            and self._settings.noraops_repo_audit_on_save
        ):
            from app.noraops.services.repo_audit_service import audit_zip_and_persist

            gitea_updated_at = None
            if self._client:
                try:
                    repo_meta = await self._client.get_repo(owner, name)
                    if repo_meta:
                        from app.noraops.services.repo_audit_service import parse_gitea_iso

                        gitea_updated_at = parse_gitea_iso(repo_meta.get("updated_at"))
                except GiteaClientError:
                    pass
            try:
                audit = await asyncio.to_thread(
                    audit_zip_and_persist,
                    self._settings,
                    owner,
                    name,
                    zip_data,
                    trigger="save",
                    gitea_updated_at=gitea_updated_at,
                )
                result["audit"] = audit
            except Exception:
                import logging

                logging.getLogger(__name__).exception(
                    "Repo audit on save failed for %s/%s", owner, name
                )
        return result
