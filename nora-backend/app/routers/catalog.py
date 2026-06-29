"""Catalog and lightweight recommendation endpoints."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db.session import get_session
from app.core.config import Settings, get_settings
from app.services.admin_config_service import AdminConfigService
from app.services.catalog_service import CatalogService
from app.services.gitea_client import GiteaClient
from app.services.recommendation_service import RecommendationService

router = APIRouter(prefix="/api/catalog", tags=["catalog"])


@router.get("/apps")
async def list_catalog_apps(settings: Settings = Depends(get_settings), db: Session = Depends(get_session)) -> dict:
    cfg = AdminConfigService(db).resolve_runtime_config(settings)
    repos = await GiteaClient(cfg).list_org_repos()
    items = CatalogService().build_items(repos)
    return {"count": len(items), "items": items}


@router.get("/recommend")
async def recommend_apps(
    q: str = Query("", max_length=200),
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
) -> dict:
    cfg = AdminConfigService(db).resolve_runtime_config(settings)
    repos = await GiteaClient(cfg).list_org_repos()
    items = CatalogService().build_items(repos)
    ranked = RecommendationService().rank(items, q, limit=25)
    return {"query": q, "items": ranked}
