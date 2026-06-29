"""ポータルヘルプ（Markdown タブ UI）。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import HTMLResponse

from app.core.config import Settings, get_settings
from app.core.root_path import join_root_path, resolve_request_root_path
from app.core.template_ctx import render_template
from app.services.help_catalog import get_help_content, list_help_tabs

router = APIRouter(tags=["help"])
api_router = APIRouter(prefix="/api/help", tags=["help-api"])


@api_router.get("/tabs")
def help_tabs_api(settings: Settings = Depends(get_settings)) -> dict:
    return {"tabs": list_help_tabs(settings)}


@api_router.get("/content/{tab_id}")
def help_content_api(tab_id: str, settings: Settings = Depends(get_settings)) -> dict:
    try:
        return get_help_content(tab_id, settings)
    except KeyError:
        raise HTTPException(status_code=404, detail="tab not found") from None
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@router.get("/help", response_class=HTMLResponse)
def help_page(
    request: Request,
    t: str = Query("overview", max_length=64),
    settings: Settings = Depends(get_settings),
) -> HTMLResponse:
    tabs = list_help_tabs(settings)
    active = t if any(x["id"] == t for x in tabs) else (tabs[0]["id"] if tabs else "overview")
    root = resolve_request_root_path(request, settings) or ""
    content_base = join_root_path(root, "/api/help/content")
    return render_template(
        request=request,
        name="help.html",
        context={"tabs": tabs, "active_tab": active, "help_content_base": content_base},
    )
