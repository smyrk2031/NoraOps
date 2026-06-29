from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.db.session import get_session
from app.services.admin_config_service import AdminConfigService
from app.services.analyzer import RepoAnalyzer
from app.services.gitea_client import GiteaClient

router = APIRouter(prefix="/api/gitea", tags=["gitea"])


@router.get("/repos")
async def list_repos(
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
) -> dict:
    cfg = AdminConfigService(db).resolve_runtime_config(settings)
    client = GiteaClient(cfg)
    repos = await client.list_org_repos()
    return {"count": len(repos), "items": repos}


@router.get("/apps")
async def list_apps(
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
) -> dict:
    cfg = AdminConfigService(db).resolve_runtime_config(settings)
    client = GiteaClient(cfg)
    analyzer = RepoAnalyzer()
    repos = await client.list_org_repos()
    apps = analyzer.app_catalog(repos)
    return {"count": len(apps), "items": [item.model_dump() for item in apps]}
