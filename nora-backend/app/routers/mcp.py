"""HTTP MCP bridge subset (tool invoke)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.db.session import get_session
from app.services import mcp_bridge_service
from app.services.admin_config_service import AdminConfigService

router = APIRouter(prefix="/api/mcp", tags=["mcp"])


class MCPInvoke(BaseModel):
    tool_name: str = Field(..., max_length=128)
    arguments: dict[str, Any] = Field(default_factory=dict)
    caller: str | None = Field(default="http-client", max_length=128)


@router.get("/tools")
async def list_tools() -> dict:
    return {
        "tools": [
            {"name": "catalog_apps", "description": "Summarize repos from configured Gitea orgs."},
            {"name": "catalog_search", "description": "Search catalog by naive keyword overlap."},
            {"name": "db_ping", "description": "Run SELECT 1 against current DB connection."},
        ]
    }


@router.post("/invoke")
async def invoke_tool_handler(
    payload: MCPInvoke,
    x_softrail_api_key: str | None = Header(default=None, alias="X-SoftRail-Api-Key"),
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
):
    svc = AdminConfigService(db)
    configured = svc.get("mcp_bridge_api_key") or ""
    if configured.strip():
        if (x_softrail_api_key or "").strip() != configured.strip():
            raise HTTPException(status_code=401, detail="missing or invalid X-SoftRail-Api-Key")

    body, ok = await mcp_bridge_service.invoke_tool(
        db=db,
        settings=settings,
        svc=svc,
        tool_name=payload.tool_name,
        arguments=payload.arguments,
        caller_tag=payload.caller or "http-client",
    )
    envelope = {"ok": ok, "result": body}
    if ok:
        return envelope
    return JSONResponse(status_code=400, content=envelope)
