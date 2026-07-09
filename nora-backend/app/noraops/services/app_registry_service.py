"""NoraOps app identity registry — appId ↔ Gitea repo binding."""

from __future__ import annotations

import json
from pathlib import Path

from sqlalchemy.orm import Session

from app.db.models import AppRegistryEntry


class AppRegistryError(ValueError):
    """Binding validation failed (wrong app for this repo)."""


def read_manifest_app_id(work_dir: Path) -> str | None:
    manifest = work_dir / "nora" / "manifest.json"
    if not manifest.is_file():
        return None
    try:
        data = json.loads(manifest.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    app_id = (data.get("appId") or "").strip()
    return app_id or None


class AppRegistryService:
    def __init__(self, db: Session) -> None:
        self._db = db

    def register(
        self,
        app_id: str,
        owner: str,
        name: str,
        *,
        display_name: str = "",
        gitea_repo_id: int | None = None,
        created_by_gitea_login: str = "",
    ) -> AppRegistryEntry:
        aid = app_id.strip()
        own = owner.strip()
        repo = name.strip()
        gid = int(gitea_repo_id) if gitea_repo_id else None
        if not aid or not own or not repo:
            raise ValueError("app_id, owner, and name are required.")

        existing = self.get_by_app_id(aid)
        if existing and (existing.owner != own or existing.name != repo):
            if gid and existing.gitea_repo_id and existing.gitea_repo_id != gid:
                raise AppRegistryError(
                    f"appId {aid} is bound to gitea repo id {existing.gitea_repo_id}, "
                    f"not {gid}."
                )
            raise AppRegistryError(
                f"appId {aid} is already bound to {existing.owner}/{existing.name}."
            )

        if gid:
            by_id = self.get_by_gitea_repo_id(gid)
            if by_id and by_id.app_id != aid:
                raise AppRegistryError(
                    f"Gitea repo id {gid} is already bound to appId {by_id.app_id}."
                )

        by_repo = self.get_by_repo(own, repo)
        if by_repo and by_repo.app_id != aid:
            raise AppRegistryError(
                f"Repository {own}/{repo} is already bound to a different app."
            )

        creator = (created_by_gitea_login or "").strip()

        if by_repo:
            if display_name:
                by_repo.display_name = display_name
            if gid and not by_repo.gitea_repo_id:
                by_repo.gitea_repo_id = gid
            if creator and not by_repo.created_by_gitea_login:
                by_repo.created_by_gitea_login = creator
            self._db.commit()
            self._db.refresh(by_repo)
            return by_repo

        if existing:
            if display_name:
                existing.display_name = display_name
            if gid and not existing.gitea_repo_id:
                existing.gitea_repo_id = gid
            if creator and not existing.created_by_gitea_login:
                existing.created_by_gitea_login = creator
            self._db.commit()
            self._db.refresh(existing)
            return existing

        row = AppRegistryEntry(
            app_id=aid,
            owner=own,
            name=repo,
            display_name=display_name or "",
            gitea_repo_id=gid,
            created_by_gitea_login=creator,
        )
        self._db.add(row)
        self._db.commit()
        self._db.refresh(row)
        return row

    def get_by_app_id(self, app_id: str) -> AppRegistryEntry | None:
        return self._db.get(AppRegistryEntry, app_id.strip())

    def get_by_repo(self, owner: str, name: str) -> AppRegistryEntry | None:
        return (
            self._db.query(AppRegistryEntry)
            .filter(
                AppRegistryEntry.owner == owner.strip(),
                AppRegistryEntry.name == name.strip(),
            )
            .first()
        )

    def get_by_gitea_repo_id(self, gitea_repo_id: int) -> AppRegistryEntry | None:
        gid = int(gitea_repo_id)
        if gid <= 0:
            return None
        return (
            self._db.query(AppRegistryEntry)
            .filter(AppRegistryEntry.gitea_repo_id == gid)
            .first()
        )

    def backfill_gitea_repo_id(self, owner: str, name: str, gitea_repo_id: int) -> AppRegistryEntry | None:
        """Set gitea_repo_id on an existing row if missing."""
        entry = self.get_by_repo(owner, name)
        if not entry:
            return None
        gid = int(gitea_repo_id)
        if gid <= 0:
            return entry
        if entry.gitea_repo_id and entry.gitea_repo_id != gid:
            raise AppRegistryError(
                f"Repository {owner}/{name} is bound to gitea repo id {entry.gitea_repo_id}, not {gid}."
            )
        if not entry.gitea_repo_id:
            entry.gitea_repo_id = gid
            self._db.commit()
            self._db.refresh(entry)
        return entry

    def sync_repo_identity_from_gitea(
        self,
        gitea_repo_id: int,
        owner: str,
        name: str,
    ) -> AppRegistryEntry | None:
        """Update owner/name cache when Gitea repo was renamed but id is stable."""
        entry = self.get_by_gitea_repo_id(gitea_repo_id)
        if not entry:
            return None
        own, repo = owner.strip(), name.strip()
        if entry.owner != own or entry.name != repo:
            conflict = self.get_by_repo(own, repo)
            if conflict and conflict.app_id != entry.app_id:
                raise AppRegistryError(
                    f"Cannot rename registry entry for {entry.app_id}: "
                    f"{own}/{repo} belongs to {conflict.app_id}."
                )
            entry.owner = own
            entry.name = repo
            self._db.commit()
            self._db.refresh(entry)
        return entry

    def validate_save(self, owner: str, name: str, manifest_app_id: str | None) -> None:
        """Raise AppRegistryError if zip must not be saved to this repo."""
        own, repo = owner.strip(), name.strip()
        entry = self.get_by_repo(own, repo)

        if not manifest_app_id:
            if entry:
                raise AppRegistryError(
                    f"This repository expects appId {entry.app_id}, but manifest has none."
                )
            return

        if entry:
            if entry.app_id != manifest_app_id:
                raise AppRegistryError(
                    f"Wrong app for {own}/{repo}. "
                    f"Expected {entry.app_id}, got {manifest_app_id}."
                )
            return

        other = self.get_by_app_id(manifest_app_id)
        if other and (other.owner != own or other.name != repo):
            raise AppRegistryError(
                f"appId {manifest_app_id} belongs to {other.owner}/{other.name}, "
                f"not {own}/{repo}."
            )

    def adopt_legacy_repo(
        self,
        owner: str,
        name: str,
        manifest_app_id: str,
        *,
        display_name: str = "",
        gitea_repo_id: int | None = None,
        created_by_gitea_login: str = "",
    ) -> AppRegistryEntry:
        """First save to an unregistered repo — bind if appId is free."""
        self.validate_save(owner, name, manifest_app_id)
        return self.register(
            manifest_app_id,
            owner,
            name,
            display_name=display_name,
            gitea_repo_id=gitea_repo_id,
            created_by_gitea_login=created_by_gitea_login,
        )
