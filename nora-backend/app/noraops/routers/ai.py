"""NoraOps AI gateway (Azure OpenAI 中継) — 組織で有効化時のみ。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.template_ctx import render_template
from app.db.session import get_session
from app.noraops.services.ai_gateway import (
    build_byok_client_config,
    build_status,
    chat_completion,
    copilot_policy_bundle,
    list_usage_by_repo,
    list_usage_events,
    list_usage_summary,
    openai_proxy_chat,
    probe_azure_openai,
)
from app.noraops.services.ai_runtime_settings import (
    resolve_ai_runtime,
    usage_context_from_request,
)
from app.noraops.services.ai_setup_guide import build_setup_guide

router = APIRouter(prefix="/api/v1/noraops/ai", tags=["noraops-ai"])
web_router = APIRouter(prefix="/noraops", tags=["noraops-ai-web"])
legacy_router = APIRouter(prefix="/api/v1/ai", tags=["noraops-ai-legacy"])
proxy_router = APIRouter(prefix="/api/v1/noraops/ai/proxy", tags=["noraops-ai-proxy"])


class ChatMessage(BaseModel):
    role: str = Field(..., pattern="^(system|user|assistant)$")
    content: str = Field(..., min_length=1, max_length=32000)


class AiUsageContext(BaseModel):
    app_id: str | None = None
    repo_owner: str | None = None
    repo_name: str | None = None


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(..., min_length=1, max_length=50)
    max_tokens: int = Field(default=1024, ge=1, le=4096)
    temperature: float = Field(default=0.2, ge=0.0, le=2.0)
    context: AiUsageContext | None = None


def _require_ai_enabled(runtime) -> None:
    if not runtime.enabled:
        raise HTTPException(status_code=503, detail="AI 中継が無効です（CMS または .env で OFF）")


@router.get("/setup-guide")
async def ai_setup_guide(request: Request, db: Session = Depends(get_session)) -> dict:
    """手動セットアップ用スニペット（AI OFF でも参照可）。"""
    settings = get_settings()
    runtime = resolve_ai_runtime(settings, db)
    return build_setup_guide(settings, request, runtime)


@router.get("/status")
@legacy_router.get("/status")
async def ai_status(db: Session = Depends(get_session)) -> dict:
    settings = get_settings()
    runtime = resolve_ai_runtime(settings, db)
    return build_status(settings, runtime)


@router.get("/byok-client-config")
async def ai_byok_client_config(request: Request, db: Session = Depends(get_session)) -> dict:
    settings = get_settings()
    runtime = resolve_ai_runtime(settings, db)
    _require_ai_enabled(runtime)
    return build_byok_client_config(settings, request, runtime)


@router.get("/usage")
async def ai_usage(days: int = 14, db: Session = Depends(get_session)) -> dict:
    settings = get_settings()
    runtime = resolve_ai_runtime(settings, db)
    _require_ai_enabled(runtime)
    return list_usage_summary(settings, days=min(max(days, 1), 90))


@router.get("/usage/repo")
async def ai_usage_repo(
    app_id: str | None = Query(None, max_length=120),
    repo_owner: str | None = Query(None, max_length=80),
    repo_name: str | None = Query(None, max_length=120),
    days: int = Query(30, ge=1, le=365),
    db: Session = Depends(get_session),
) -> dict:
    settings = get_settings()
    runtime = resolve_ai_runtime(settings, db)
    if not app_id and not (repo_owner and repo_name):
        raise HTTPException(status_code=400, detail="app_id または owner+name が必要です")
    return list_usage_by_repo(
        settings,
        app_id=app_id,
        repo_owner=repo_owner,
        repo_name=repo_name,
        days=days,
    )


@router.get("/usage/events")
async def ai_usage_events(
    limit: int = Query(200, ge=1, le=500),
    source: str | None = Query(None, max_length=32),
    date_from: str | None = Query(None, max_length=10),
    date_to: str | None = Query(None, max_length=10),
    db: Session = Depends(get_session),
) -> dict:
    settings = get_settings()
    runtime = resolve_ai_runtime(settings, db)
    _require_ai_enabled(runtime)
    return list_usage_events(
        settings,
        limit=limit,
        source=source,
        date_from=date_from,
        date_to=date_to,
    )


@router.get("/probe")
async def ai_probe(db: Session = Depends(get_session)) -> dict:
    settings = get_settings()
    runtime = resolve_ai_runtime(settings, db)
    _require_ai_enabled(runtime)
    return await probe_azure_openai(settings, runtime)


@router.get("/copilot-policy")
async def copilot_policy(db: Session = Depends(get_session)) -> dict:
    settings = get_settings()
    runtime = resolve_ai_runtime(settings, db)
    bundle = copilot_policy_bundle()
    bundle["serverEnabled"] = runtime.enabled
    bundle["serverConfigured"] = bool(
        runtime.enabled
        and settings.azure_openai_endpoint
        and settings.azure_openai_api_key
        and settings.azure_openai_deployment
    )
    return bundle


@router.post("/chat")
@legacy_router.post("/chat")
async def ai_chat(body: ChatRequest, db: Session = Depends(get_session)) -> dict:
    settings = get_settings()
    runtime = resolve_ai_runtime(settings, db)
    _require_ai_enabled(runtime)
    msgs = [{"role": m.role, "content": m.content} for m in body.messages]
    ctx = body.context.model_dump() if body.context else None
    result = await chat_completion(
        settings,
        msgs,
        max_tokens=body.max_tokens,
        temperature=body.temperature,
        source="chat",
        runtime=runtime,
        usage_context=ctx,
    )
    if not result.get("ok"):
        code = int(result.get("statusCode") or 500)
        raise HTTPException(status_code=code, detail=result.get("detail") or "AI request failed")
    return {
        "content": result.get("content"),
        "model": result.get("model"),
        "usage": result.get("usage"),
        "usageToday": result.get("usageToday"),
    }


@proxy_router.post("/v1/chat/completions")
@proxy_router.post("/chat/completions")
async def ai_proxy_chat_completions(request: Request, db: Session = Depends(get_session)) -> JSONResponse:
    settings = get_settings()
    runtime = resolve_ai_runtime(settings, db)
    _require_ai_enabled(runtime)
    try:
        body = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="invalid JSON body") from exc
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="body must be JSON object")
    ctx = usage_context_from_request(request)
    result = await openai_proxy_chat(settings, body, runtime=runtime, usage_context=ctx)
    if not result.get("ok"):
        code = int(result.get("statusCode") or 500)
        raise HTTPException(status_code=code, detail=result.get("detail") or "proxy failed")
    return JSONResponse(result["openai"])


@web_router.get("/ai-usage", response_class=HTMLResponse)
async def ai_usage_dashboard(request: Request, db: Session = Depends(get_session)) -> HTMLResponse:
    settings = get_settings()
    runtime = resolve_ai_runtime(settings, db)
    summary = list_usage_summary(settings, days=30)
    events = list_usage_events(settings, limit=100)
    status = build_status(settings, runtime)
    return render_template(
        request=request,
        name="noraops_ai_usage.html",
        context={"summary": summary, "status": status, "events": events},
    )
