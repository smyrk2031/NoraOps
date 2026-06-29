"""NoraOps diagnostics API + admin HTML (smoke tests for operators)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.template_ctx import render_template
from app.db.session import get_session
from app.noraops.services.diagnostics import run_server_diagnostics

api_router = APIRouter(prefix="/api/v1/noraops/diagnostics", tags=["noraops-diagnostics"])
web_router = APIRouter(prefix="/noraops", tags=["noraops-diagnostics-web"])

@api_router.get("/run")
async def run_diagnostics_json(
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> dict:
    """
    主要機能のスモークチェック（開発者向け pytest とは別）。
    拡張の「動作確認」からも利用。
    """
    return await run_server_diagnostics(db, settings)


@web_router.get("/diagnostics", response_class=HTMLResponse)
async def diagnostics_page(request: Request) -> HTMLResponse:
    return render_template(
        request=request,
        name="noraops_diagnostics.html",
        context={},
    )


@web_router.get("/diagnostics/run")
async def diagnostics_page_run(
    request: Request,
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> HTMLResponse:
    result = await run_server_diagnostics(db, settings)
    return render_template(
        request=request,
        name="noraops_diagnostics.html",
        context={"result": result, "auto_run": True},
    )
