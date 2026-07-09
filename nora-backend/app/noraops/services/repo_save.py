"""Save workspace zip to Gitea via server-side git (extension never runs git)."""

from __future__ import annotations

import asyncio
import json
import logging
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
from app.noraops.services.repo_access_service import RepoAccessError, assert_repo_write_access
from app.noraops.services.zip_utils import safe_extract_zip, scan_forbidden_secrets
from app.services.admin_config_service import RuntimeIntegrationConfig
from app.services.gitea_client import GiteaClient, GiteaClientError

logger = logging.getLogger(__name__)


def _sync_worktree_from_extract(repo_dir: Path, extract_dir: Path) -> None:
    """Replace repo working tree (keep .git) with extracted zip contents."""
    for child in repo_dir.iterdir():
        if child.name == ".git":
            continue
        if child.is_dir():
            shutil.rmtree(child)
        else:
            child.unlink()
    for child in extract_dir.iterdir():
        dest = repo_dir / child.name
        if child.is_dir():
            shutil.copytree(child, dest)
        else:
            shutil.copy2(child, dest)


def _git_configure_identity(git: str, cwd: Path) -> None:
    subprocess.run(
        [git, "config", "user.email", "noraops@local"],
        cwd=cwd,
        capture_output=True,
        text=True,
        check=False,
    )
    subprocess.run(
        [git, "config", "user.name", "NoraOps"],
        cwd=cwd,
        capture_output=True,
        text=True,
        check=False,
    )


def _git_commit_all(git: str, cwd: Path, message: str) -> None:
    add = subprocess.run(
        [git, "add", "-A"],
        cwd=cwd,
        capture_output=True,
        text=True,
        timeout=120,
    )
    if add.returncode != 0:
        err = (add.stderr or add.stdout or "").strip()
        raise GiteaClientError(f"git add failed: {err}")

    commit = subprocess.run(
        [git, "commit", "-m", message or "NoraOps save"],
        cwd=cwd,
        capture_output=True,
        text=True,
        timeout=120,
    )
    if commit.returncode != 0:
        err = (commit.stderr or commit.stdout or "").strip()
        if "nothing to commit" in err.lower():
            empty = subprocess.run(
                [git, "commit", "--allow-empty", "-m", message or "NoraOps save"],
                cwd=cwd,
                capture_output=True,
                text=True,
                timeout=120,
            )
            if empty.returncode != 0:
                empty_err = (empty.stderr or empty.stdout or "").strip()
                raise GiteaClientError(f"git commit failed: {empty_err or err}")
        else:
            raise GiteaClientError(f"git commit failed: {err}")


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

    async def ensure_repo_exists(
        self,
        owner: str,
        name: str,
        *,
        actor_login: str | None = None,
        allow_create: bool = True,
    ) -> dict:
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
        if not allow_create:
            raise GiteaClientError(
                f"Gitea repository {owner}/{name} does not exist and auto-create is disabled."
            )
        if actor_login and owner.strip() != actor_login.strip():
            raise GiteaClientError(
                f"Cannot create repository under {owner}/{name}: owner must be {actor_login}."
            )
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

    def _validate_zip_workspace(
        self,
        work_dir: Path,
        *,
        owner: str,
        name: str,
        form_app_id: str | None = None,
        gitea_repo_id: int | None = None,
        created_by_gitea_login: str = "",
    ) -> None:
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

        if not self._db:
            return

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
                created_by_gitea_login=created_by_gitea_login,
            )
        else:
            raise AppRegistryError(
                f"Repository {owner}/{name} requires nora/manifest.json with appId."
            )

    def _push_draft_force(
        self,
        git: str,
        staging_dir: Path,
        *,
        remote_url: str,
        branch: str,
        message: str,
        env: dict[str, str],
        owner: str,
        name: str,
    ) -> str:
        """通常保存: 下書きブランチのみ force push（履歴は残さない）。"""
        init = subprocess.run(
            [git, "init"],
            cwd=staging_dir,
            capture_output=True,
            text=True,
            timeout=60,
        )
        if init.returncode != 0:
            err = (init.stderr or init.stdout or "").strip()
            raise GiteaClientError(f"git init failed: {err}")

        _git_configure_identity(git, staging_dir)
        _git_commit_all(git, staging_dir, message)

        subprocess.run(
            [git, "branch", "-M", branch],
            cwd=staging_dir,
            capture_output=True,
            text=True,
            check=False,
        )
        subprocess.run(
            [git, "remote", "add", "origin", remote_url],
            cwd=staging_dir,
            capture_output=True,
            text=True,
            check=False,
        )

        push = subprocess.run(
            [git, "push", "-u", "origin", branch, "--force"],
            cwd=staging_dir,
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
            cwd=staging_dir,
            capture_output=True,
            text=True,
            timeout=30,
        )
        return (sha_proc.stdout or "").strip() if sha_proc.returncode == 0 else ""

    def _prepare_publish_repo(
        self,
        git: str,
        repo_dir: Path,
        *,
        remote_url: str,
        branch: str,
        env: dict[str, str],
    ) -> bool:
        """Clone existing repo or init fresh. Returns True when main branch is new on remote."""
        if repo_dir.exists():
            shutil.rmtree(repo_dir)
        repo_dir.mkdir(parents=True)

        clone = subprocess.run(
            [git, "clone", "--no-checkout", remote_url, str(repo_dir)],
            capture_output=True,
            text=True,
            timeout=180,
            env=env,
        )
        if clone.returncode != 0:
            err = (clone.stderr or clone.stdout or "").strip()
            logger.info("publish clone failed (new repo?): %s", err[:200])
            subprocess.run([git, "init"], cwd=repo_dir, capture_output=True, text=True, timeout=60)
            subprocess.run(
                [git, "checkout", "-b", branch],
                cwd=repo_dir,
                capture_output=True,
                text=True,
                check=False,
            )
            subprocess.run(
                [git, "remote", "add", "origin", remote_url],
                cwd=repo_dir,
                capture_output=True,
                text=True,
                check=False,
            )
            return True

        checkout = subprocess.run(
            [git, "checkout", branch],
            cwd=repo_dir,
            capture_output=True,
            text=True,
            timeout=60,
            env=env,
        )
        if checkout.returncode != 0:
            subprocess.run(
                [git, "checkout", "-b", branch],
                cwd=repo_dir,
                capture_output=True,
                text=True,
                check=False,
            )
            return True
        return False

    def _push_publish_with_history(
        self,
        git: str,
        staging_dir: Path,
        *,
        remote_url: str,
        branch: str,
        message: str,
        publish_tag: str | None,
        env: dict[str, str],
        owner: str,
        name: str,
    ) -> tuple[str, str | None]:
        """公開: 正式ブランチに履歴付き commit + push（force しない）。"""
        with tempfile.TemporaryDirectory(prefix="noraops-publish-") as pub_tmp:
            repo_dir = Path(pub_tmp) / "repo"
            is_new_branch = self._prepare_publish_repo(
                git, repo_dir, remote_url=remote_url, branch=branch, env=env
            )
            _sync_worktree_from_extract(repo_dir, staging_dir)
            _git_configure_identity(git, repo_dir)
            _git_commit_all(git, repo_dir, message)

            push_args = [git, "push", "-u", "origin", branch] if is_new_branch else [
                git,
                "push",
                "origin",
                branch,
            ]
            push = subprocess.run(
                push_args,
                cwd=repo_dir,
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
                        f" 詳細: {err}"
                    )
                raise GiteaClientError(f"git push failed: {err}")

            sha_proc = subprocess.run(
                [git, "rev-parse", "HEAD"],
                cwd=repo_dir,
                capture_output=True,
                text=True,
                timeout=30,
            )
            commit_sha = (sha_proc.stdout or "").strip() if sha_proc.returncode == 0 else ""

            tag_name = (publish_tag or "").strip()
            if tag_name and commit_sha:
                tag_msg = message or f"NoraOps publish {tag_name}"
                tag_res = subprocess.run(
                    [git, "tag", tag_name, "-m", tag_msg],
                    cwd=repo_dir,
                    capture_output=True,
                    text=True,
                    timeout=60,
                )
                if tag_res.returncode != 0:
                    err = (tag_res.stderr or tag_res.stdout or "").strip()
                    raise GiteaClientError(f"git tag failed: {err}")
                tag_push = subprocess.run(
                    [git, "push", "origin", tag_name],
                    cwd=repo_dir,
                    capture_output=True,
                    text=True,
                    timeout=180,
                    env=env,
                )
                if tag_push.returncode != 0:
                    err = (tag_push.stderr or tag_push.stdout or "").strip()
                    raise GiteaClientError(f"git push tag failed: {err}")

            return commit_sha, tag_name or None

    def _save_sync(
        self,
        owner: str,
        name: str,
        zip_data: bytes,
        *,
        message: str = "NoraOps save",
        form_app_id: str | None = None,
        gitea_repo_id: int | None = None,
        created_by_gitea_login: str = "",
        publish: bool = False,
        publish_tag: str | None = None,
    ) -> dict:
        if not zip_data:
            raise GiteaClientError("Empty workspace zip.")
        git = self._git_exe()
        remote_url = self._authenticated_remote_url(owner, name)
        draft_branch = (self._settings.noraops_save_draft_branch or "noraops-draft").strip()
        publish_branch = (self._settings.noraops_save_publish_branch or "main").strip()
        branch = publish_branch if publish else draft_branch
        max_bytes = self._settings.save_max_zip_bytes
        commit_sha = ""
        tag_name: str | None = None

        with tempfile.TemporaryDirectory(prefix="noraops-save-") as tmp:
            tmp_path = Path(tmp)
            staging_dir = tmp_path / "staging"
            safe_extract_zip(zip_data, staging_dir, max_bytes=max_bytes)
            self._validate_zip_workspace(
                staging_dir,
                owner=owner,
                name=name,
                form_app_id=form_app_id,
                gitea_repo_id=gitea_repo_id,
                created_by_gitea_login=created_by_gitea_login,
            )

            env = {**subprocess.os.environ, "GIT_TERMINAL_PROMPT": "0"}

            if publish:
                commit_sha, tag_name = self._push_publish_with_history(
                    git,
                    staging_dir,
                    remote_url=remote_url,
                    branch=publish_branch,
                    message=message,
                    publish_tag=publish_tag,
                    env=env,
                    owner=owner,
                    name=name,
                )
            else:
                commit_sha = self._push_draft_force(
                    git,
                    staging_dir,
                    remote_url=remote_url,
                    branch=draft_branch,
                    message=message,
                    env=env,
                    owner=owner,
                    name=name,
                )

        return {
            "ok": True,
            "owner": owner,
            "name": name,
            "branch": branch,
            "saveMode": "publish" if publish else "draft",
            "full_name": f"{owner}/{name}",
            "via": "zip",
            "commitSha": commit_sha,
            "publishedTag": tag_name,
        }

    async def save_zip(
        self,
        owner: str,
        name: str,
        zip_data: bytes,
        *,
        message: str = "NoraOps save",
        app_id: str | None = None,
        publish: bool = False,
        publish_tag: str | None = None,
        actor_login: str | None = None,
        strict_access: bool = False,
    ) -> dict:
        if self._client:
            await assert_repo_write_access(
                self._client,
                owner,
                name,
                actor_login=actor_login,
                allow_create_as_actor=not strict_access or bool(actor_login),
            )
        provision = await self.ensure_repo_exists(
            owner,
            name,
            actor_login=actor_login,
            allow_create=not strict_access or bool(actor_login),
        )
        gid = provision.get("gitea_repo_id")
        creator = (actor_login or "").strip()
        result = await asyncio.to_thread(
            self._save_sync,
            owner,
            name,
            zip_data,
            message=message,
            form_app_id=app_id,
            gitea_repo_id=gid,
            created_by_gitea_login=creator,
            publish=publish,
            publish_tag=publish_tag,
        )
        if (
            not publish
            and self._client
            and result.get("saveMode") == "draft"
            and result.get("branch")
        ):
            try:
                await self._client.update_repo_default_branch(owner, name, str(result["branch"]))
                result["defaultBranchUpdated"] = True
            except GiteaClientError:
                logger.warning(
                    "Failed to set default branch to %s for %s/%s",
                    result.get("branch"),
                    owner,
                    name,
                    exc_info=True,
                )
                result["defaultBranchUpdated"] = False
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
                logger.exception("Repo audit on save failed for %s/%s", owner, name)
        return result
