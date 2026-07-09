"""NoraOps app registry lookup (read-only)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db.session import get_session
from app.noraops.services.app_registry_service import AppRegistryService

router = APIRouter(prefix="/api/v1/noraops/apps", tags=["noraops-apps"])


def _entry_to_dict(entry) -> dict:
    return {
        "found": True,
        "appId": entry.app_id,
        "owner": entry.owner,
        "name": entry.name,
        "fullName": f"{entry.owner}/{entry.name}",
        "displayName": entry.display_name or "",
        "giteaRepoId": entry.gitea_repo_id,
        "createdByGiteaLogin": entry.created_by_gitea_login or None,
    }


@router.get("/binding")
def lookup_binding(
    app_id: str | None = Query(None, alias="app_id"),
    owner: str | None = Query(None),
    name: str | None = Query(None),
    gitea_repo_id: int | None = Query(None, alias="gitea_repo_id"),
    db: Session = Depends(get_session),
) -> dict:
    """
    Read-only lookup: appId → repo, repo → appId, or giteaRepoId → binding.
    Used by Creator to show binding status (no mutations).
    """
    registry = AppRegistryService(db)

    if gitea_repo_id is not None and int(gitea_repo_id) > 0:
        entry = registry.get_by_gitea_repo_id(int(gitea_repo_id))
        if entry:
            return _entry_to_dict(entry)
        return {"found": False, "lookup": "gitea_repo_id", "giteaRepoId": int(gitea_repo_id)}

    if app_id and app_id.strip():
        entry = registry.get_by_app_id(app_id.strip())
        if entry:
            return _entry_to_dict(entry)
        return {"found": False, "lookup": "app_id", "appId": app_id.strip()}

    if owner and owner.strip() and name and name.strip():
        entry = registry.get_by_repo(owner.strip(), name.strip())
        if entry:
            return _entry_to_dict(entry)
        return {
            "found": False,
            "lookup": "repo",
            "owner": owner.strip(),
            "name": name.strip(),
        }

    raise HTTPException(
        status_code=400,
        detail="Provide app_id, gitea_repo_id, or both owner and name.",
    )
