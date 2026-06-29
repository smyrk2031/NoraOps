"""運用センター（診断 + pytest ワンボタン）。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.template_ctx import render_template
from app.db.session import get_session
from app.services.ops_runner import run_full_ops_check

router = APIRouter(prefix="/noraops", tags=["noraops-ops"])
api_router = APIRouter(prefix="/api/v1/noraops/ops", tags=["noraops-ops-api"])


@router.get("/ops", response_class=HTMLResponse)
async def ops_center_page(request: Request) -> HTMLResponse:
    return render_template(request=request, name="ops_center.html", context={})


@api_router.post("/run")
async def ops_run_all(
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> dict:
    return await run_full_ops_check(db, settings)


@router.get("/ops/run", response_class=HTMLResponse)
async def ops_run_page(
    request: Request,
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> HTMLResponse:
    result = await run_full_ops_check(db, settings)
    return render_template(
        request=request,
        name="ops_center.html",
        context={"result": result, "auto_run": True},
    )
