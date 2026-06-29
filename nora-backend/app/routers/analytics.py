from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.db.session import get_session
from app.services.admin_config_service import AdminConfigService
from app.services.analyzer import RepoAnalyzer
from app.services.gitea_client import GiteaClient

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


@router.get("/knowledge")
async def knowledge(
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
) -> dict:
    cfg = AdminConfigService(db).resolve_runtime_config(settings)
    repos = await GiteaClient(cfg).list_org_repos()
    insights = RepoAnalyzer().knowledge_insights(repos)
    return {"items": [x.model_dump() for x in insights]}


@router.get("/workflows")
async def workflows(
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
) -> dict:
    cfg = AdminConfigService(db).resolve_runtime_config(settings)
    repos = await GiteaClient(cfg).list_org_repos()
    insights = RepoAnalyzer().workflow_insights(repos)
    return {"items": [x.model_dump() for x in insights]}


@router.get("/policy-violations")
async def policy_violations(
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
) -> dict:
    cfg = AdminConfigService(db).resolve_runtime_config(settings)
    repos = await GiteaClient(cfg).list_org_repos()
    violations = RepoAnalyzer().policy_violations(repos)
    summary = {}
    for v in violations:
        summary[v.severity] = summary.get(v.severity, 0) + 1
    return {
        "count": len(violations),
        "severitySummary": summary,
        "items": [x.model_dump() for x in violations],
    }
