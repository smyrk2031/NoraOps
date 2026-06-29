"""Minimal MCP-compatible tool facade over HTTP."""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db.models import McpAuditLog
from app.services.admin_config_service import AdminConfigService
from fastapi.encoders import jsonable_encoder

from app.services.catalog_service import CatalogService
from app.services.gitea_client import GiteaClient
from app.services.recommendation_service import RecommendationService


async def audit(
    db: Session,
    tool_name: str,
    *,
    caller: str,
    ok: bool,
    payload: dict[str, Any],
) -> None:
    db.add(
        McpAuditLog(
            tool_name=tool_name,
            caller=caller or "",
            success=bool(ok),
            payload_json=json.dumps(jsonable_encoder(payload), ensure_ascii=False),
        )
    )
    db.commit()


async def invoke_tool(
    *,
    db: Session,
    settings: Settings,
    svc: AdminConfigService,
    tool_name: str,
    arguments: dict[str, Any],
    caller_tag: str,
) -> tuple[dict[str, Any], bool]:
    cfg = svc.resolve_runtime_config(settings)

    if tool_name == "catalog_apps":
        client = GiteaClient(cfg)
        repos = await client.list_org_repos()
        payload = CatalogService().build_items(repos)
        out = {"items": payload}
        await audit(db, tool_name, caller=caller_tag, ok=True, payload={**arguments, "count": len(payload)})
        return out, True

    if tool_name == "catalog_search":
        q = str(arguments.get("q") or "")
        limit = min(int(arguments.get("limit") or 10), 100)
        client = GiteaClient(cfg)
        repos = await client.list_org_repos()
        items = CatalogService().build_items(repos)
        ranked = RecommendationService().rank(items, q, limit=limit)
        out = {"query": q, "items": ranked}
        await audit(db, tool_name, caller=caller_tag, ok=True, payload=out)
        return out, True

    if tool_name == "db_ping":
        try:
            db.execute(text("SELECT 1"))
            out = {"ok": True}
        except Exception as exc:
            await audit(db, tool_name, caller=caller_tag, ok=False, payload={"error": str(exc)})
            return {"ok": False, "error": str(exc)}, False
        await audit(db, tool_name, caller=caller_tag, ok=True, payload=out)
        return out, True

    await audit(db, tool_name, caller=caller_tag, ok=False, payload={"error": "unknown tool"})
    return {"error": "unknown tool"}, False
