"""Push git bundles to Gitea using server-side GITEA_TOKEN (extension never sees PAT)."""

from __future__ import annotations

import asyncio
import shutil
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import quote, urlparse

from app.services.admin_config_service import RuntimeIntegrationConfig
from app.services.gitea_client import GiteaClientError


class RepoPushService:
    def __init__(self, cfg: RuntimeIntegrationConfig) -> None:
        self._cfg = cfg

    def _git_exe(self) -> str:
        return shutil.which("git") or "git"

    def _authenticated_remote_url(self, owner: str, name: str) -> str:
        if not self._cfg.gitea_base_url or not self._cfg.gitea_token:
            raise GiteaClientError("GITEA_BASE_URL and GITEA_TOKEN are required for server push.")
        base = self._cfg.gitea_base_url.rstrip("/")
        parsed = urlparse(f"{base}/{owner}/{name}.git")
        host = parsed.netloc or parsed.path.split("/")[0]
        path_part = parsed.path or f"/{owner}/{name}.git"
        if not path_part.endswith(".git"):
            path_part = f"{path_part.rstrip('/')}.git"
        token = quote(self._cfg.gitea_token, safe="")
        return f"{parsed.scheme or 'http'}://{token}@{host}{path_part}"

    def _push_bundle_sync(
        self,
        owner: str,
        name: str,
        bundle_data: bytes,
        *,
        branch: str = "main",
        push_all: bool = False,
    ) -> dict:
        if not bundle_data:
            raise GiteaClientError("Empty git bundle.")
        git = self._git_exe()
        remote_url = self._authenticated_remote_url(owner, name)
        branch = (branch or "main").strip() or "main"

        with tempfile.TemporaryDirectory(prefix="noraops-push-") as tmp:
            tmp_path = Path(tmp)
            bundle_path = tmp_path / "upload.bundle"
            repo_dir = tmp_path / "repo"
            bundle_path.write_bytes(bundle_data)

            clone = subprocess.run(
                [git, "clone", str(bundle_path), str(repo_dir)],
                capture_output=True,
                text=True,
                timeout=120,
            )
            if clone.returncode != 0:
                err = (clone.stderr or clone.stdout or "").strip()
                raise GiteaClientError(f"git clone from bundle failed: {err}")

            subprocess.run(
                [git, "remote", "add", "origin", remote_url],
                cwd=repo_dir,
                capture_output=True,
                text=True,
                check=False,
            )

            env = {**subprocess.os.environ, "GIT_TERMINAL_PROMPT": "0"}

            if push_all:
                push = subprocess.run(
                    [git, "push", "origin", "--all"],
                    cwd=repo_dir,
                    capture_output=True,
                    text=True,
                    timeout=180,
                    env=env,
                )
                if push.returncode != 0:
                    err = (push.stderr or push.stdout or "").strip()
                    raise GiteaClientError(f"git push --all failed: {err}")
                tags = subprocess.run(
                    [git, "push", "origin", "--tags"],
                    cwd=repo_dir,
                    capture_output=True,
                    text=True,
                    timeout=180,
                    env=env,
                )
                if tags.returncode != 0:
                    err = (tags.stderr or tags.stdout or "").strip()
                    raise GiteaClientError(f"git push --tags failed: {err}")
            else:
                push = subprocess.run(
                    [git, "push", "-u", "origin", f"HEAD:refs/heads/{branch}"],
                    cwd=repo_dir,
                    capture_output=True,
                    text=True,
                    timeout=180,
                    env=env,
                )
                if push.returncode != 0:
                    err = (push.stderr or push.stdout or "").strip()
                    raise GiteaClientError(f"git push failed: {err}")

        return {
            "ok": True,
            "owner": owner,
            "name": name,
            "branch": branch,
            "pushAll": push_all,
            "full_name": f"{owner}/{name}",
        }

    async def push_bundle(
        self,
        owner: str,
        name: str,
        bundle_data: bytes,
        *,
        branch: str = "main",
        push_all: bool = False,
    ) -> dict:
        return await asyncio.to_thread(
            self._push_bundle_sync,
            owner,
            name,
            bundle_data,
            branch=branch,
            push_all=push_all,
        )
