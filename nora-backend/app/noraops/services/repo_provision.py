"""Create Gitea repos for NoraOps4code (FastAPI-15)."""

from __future__ import annotations

import re
from typing import Any

from sqlalchemy.orm import Session

from app.noraops.services.app_registry_service import AppRegistryError, AppRegistryService
from app.services.admin_config_service import RuntimeIntegrationConfig
from app.services.gitea_client import GiteaClient, GiteaClientError

_SLUG_RE = re.compile(r"[^a-z0-9._-]+")


def slugify_repo_name(raw: str) -> str:
    s = (raw or "").strip().lower().replace(" ", "-")
    s = _SLUG_RE.sub("-", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s or "app"


class RepoProvisionService:
    def __init__(
        self,
        client: GiteaClient,
        cfg: RuntimeIntegrationConfig,
        db: Session | None = None,
    ) -> None:
        self._client = client
        self._cfg = cfg
        self._db = db

    async def resolve_owner(self, requested: str | None, *, actor_login: str | None = None) -> str:
        if requested and requested.strip():
            return requested.strip()
        if actor_login and actor_login.strip():
            return actor_login.strip()
        if self._cfg.gitea_orgs:
            return self._cfg.gitea_orgs[0]
        user = await self._client.get_current_user()
        if user and user.get("login"):
            return str(user["login"])
        raise GiteaClientError("Cannot resolve Gitea owner. Set GITEA_ORGS, GITEA_TOKEN, or sign in.")

    async def check_name(
        self,
        name: str,
        owner: str | None,
        *,
        actor_login: str | None = None,
    ) -> dict[str, Any]:
        slug = slugify_repo_name(name)
        own = await self.resolve_owner(owner, actor_login=actor_login)
        existing = await self._client.get_repo(own, slug)
        if existing:
            return {
                "available": False,
                "name": slug,
                "owner": own,
                "existing": {
                    "full_name": existing.get("full_name") or f"{own}/{slug}",
                    "html_url": existing.get("html_url"),
                    "updated_at": existing.get("updated_at"),
                },
            }
        return {"available": True, "name": slug, "owner": own}

    async def provision(
        self,
        name: str,
        *,
        owner: str | None = None,
        display_name: str = "",
        app_id: str | None = None,
        private: bool = True,
        actor_login: str | None = None,
    ) -> dict[str, Any]:
        slug = slugify_repo_name(name)
        own = await self.resolve_owner(owner, actor_login=actor_login)
        check = await self.check_name(slug, own, actor_login=actor_login)
        if not check["available"]:
            return {"ok": False, "code": "name_conflict", **check}

        aid = (app_id or "").strip()
        if not aid:
            return {"ok": False, "code": "missing_app_id", "message": "app_id is required."}

        repo = await self._client.create_repo(
            own,
            slug,
            private=private,
            description=display_name or slug,
        )
        clone_url = repo.get("clone_url") or repo.get("ssh_url") or ""
        gitea_repo_id = int(repo.get("id") or 0) or None
        if self._db:
            try:
                AppRegistryService(self._db).register(
                    aid,
                    own,
                    slug,
                    display_name=display_name or slug,
                    gitea_repo_id=gitea_repo_id,
                    created_by_gitea_login=(actor_login or own).strip(),
                )
            except AppRegistryError as e:
                return {"ok": False, "code": "app_id_conflict", "message": str(e)}

        return {
            "ok": True,
            "app_id": aid,
            "name": slug,
            "owner": own,
            "full_name": repo.get("full_name") or f"{own}/{slug}",
            "clone_url": clone_url,
            "html_url": repo.get("html_url"),
            "gitea_repo_id": gitea_repo_id,
        }
