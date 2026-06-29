import time
from pathlib import Path

from fastapi import FastAPI
from fastapi import Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.db.models import ApiAccessLog
from app.db.session import get_session, init_engine
from app.routers.admin import router as admin_api_router
from app.routers.admin import web_router as admin_web_router
from app.routers.analytics import router as analytics_router
from app.routers.catalog import router as catalog_router
from app.routers.gitea import router as gitea_router
from app.routers.health import router as health_router
from app.routers.mcp import router as mcp_router
from app.routers.telemetry import router as telemetry_router
from app.routers.tools import router as tools_router
from app.routers.help_web import api_router as help_api_router
from app.routers.help_web import router as help_web_router
from app.routers.ops_web import api_router as ops_api_router
from app.routers.ops_web import router as ops_web_router
from app.routers.web import router as web_router
from app.noraops.routers.ai import legacy_router as noraops_ai_legacy_router
from app.noraops.routers.ai import proxy_router as noraops_ai_proxy_router
from app.noraops.routers.ai import router as noraops_ai_router
from app.noraops.routers.ai import web_router as noraops_ai_web_router
from app.noraops.routers.checks import router as noraops_checks_router
from app.noraops.routers.concierge import router as noraops_concierge_router
from app.noraops.routers.prompts import router as noraops_prompts_router
from app.noraops.routers.apps import router as noraops_apps_router
from app.noraops.routers.auth import router as noraops_auth_router
from app.noraops.routers.me import router as noraops_me_router
from app.noraops.routers.client import router as noraops_client_router
from app.noraops.routers.packages import router as noraops_packages_router
from app.noraops.routers.portal_api import router as noraops_portal_router
from app.noraops.routers.pydev import router as noraops_pydev_router
from app.noraops.routers.repos import router as noraops_repos_router
from app.noraops.routers.diagnostics import api_router as noraops_diagnostics_api_router
from app.noraops.routers.diagnostics import web_router as noraops_diagnostics_web_router
from app.core.config import get_settings
from app.core.version import get_portal_display_version
from app.core.root_path import configured_root_path
from app.core.template_ctx import render_template
from app.middleware.admin_basic_auth import AdminBasicAuthMiddleware
from app.middleware.auth_identity import AuthIdentityMiddleware
from app.middleware.root_path import RootPathMiddleware
from app.services.data_bootstrap import bootstrap_data_on_startup
from app.services.gitea_client import GiteaClientError

_settings = get_settings()
_root = configured_root_path(_settings)

app = FastAPI(
    title="NoraOps Server",
    description="NoraOps backend — extension distribution, Gitea integration, and guardrails",
    version=get_portal_display_version(),
)

# ミドルウェアは Mount より先に登録（サブパス strip を StaticFiles へ確実に伝える）
app.add_middleware(RootPathMiddleware)
app.add_middleware(AdminBasicAuthMiddleware)
app.add_middleware(AuthIdentityMiddleware)

_STATIC_DIR = Path(__file__).resolve().parent / "static"


@app.exception_handler(GiteaClientError)
async def gitea_unavailable_handler(request: Request, exc: GiteaClientError):
    accept = request.headers.get("accept", "")
    if request.url.path == "/dashboard" and "text/html" in accept:
        return render_template(
            request=request,
            name="dashboard.html",
            context={
                "gitea_error": str(exc),
                "gitea_hint": exc.hint,
                "total_repos": 0,
                "zero_repo_hint": None,
                "apps": [],
                "knowledge": [],
                "workflows": [],
                "violations": [],
            },
            status_code=503,
        )
    return JSONResponse(
        status_code=503,
        content={"detail": str(exc), "hint": exc.hint},
    )


@app.on_event("startup")
async def startup() -> None:
    import asyncio
    import logging

    from app.services.backup_scheduler import backup_scheduler_loop

    logger = logging.getLogger("uvicorn.error")
    if _root:
        logger.info("NoraOps subpath active: NORAOPS_ROOT_PATH=%s (HTML/CSS/API links use this prefix)", _root)
    else:
        logger.info("NoraOps local mode: NORAOPS_ROOT_PATH empty (http://127.0.0.1:%s/)", _settings.port)
    logger.info("Static files directory: %s (exists=%s)", _STATIC_DIR, _STATIC_DIR.is_dir())
    bootstrap_data_on_startup(_settings)
    init_engine()
    if _settings.noraops_backup_enabled:
        asyncio.create_task(backup_scheduler_loop())
        logger.info(
            "NoraOps backup scheduler started (every %dh, keep %d)",
            _settings.noraops_backup_interval_hours,
            _settings.noraops_backup_retention,
        )
    if _settings.noraops_repo_audit_enabled and _settings.noraops_repo_audit_nightly:
        from app.noraops.services.repo_audit_scheduler import repo_audit_scheduler_loop

        asyncio.create_task(repo_audit_scheduler_loop())
        logger.info(
            "NoraOps repo audit scheduler started (%02d:%02d nightly delta)",
            _settings.noraops_repo_audit_hour,
            _settings.noraops_repo_audit_minute,
        )


@app.middleware("http")
async def access_log_middleware(request: Request, call_next):
    started = time.perf_counter()
    response = await call_next(request)
    elapsed_ms = int((time.perf_counter() - started) * 1000)
    if not request.url.path.startswith("/static"):
        try:
            db = next(get_session())
            db.add(
                ApiAccessLog(
                    path=request.url.path,
                    method=request.method,
                    status_code=response.status_code,
                    latency_ms=elapsed_ms,
                    ip=(request.client.host if request.client else ""),
                    user_agent=request.headers.get("user-agent", ""),
                )
            )
            db.commit()
            db.close()
        except Exception:
            # Middleware logging failure must not break request handling.
            pass
    return response


app.include_router(web_router)
app.include_router(help_web_router)
app.include_router(help_api_router)
app.include_router(ops_web_router)
app.include_router(ops_api_router)
app.include_router(admin_web_router)
app.include_router(health_router)
app.include_router(tools_router)
app.include_router(gitea_router)
app.include_router(analytics_router)
app.include_router(admin_api_router)
app.include_router(catalog_router)
app.include_router(telemetry_router)
app.include_router(mcp_router)
app.include_router(noraops_checks_router)
app.include_router(noraops_concierge_router)
app.include_router(noraops_prompts_router)
app.include_router(noraops_apps_router)
app.include_router(noraops_repos_router)
app.include_router(noraops_portal_router)
app.include_router(noraops_auth_router)
app.include_router(noraops_me_router)
app.include_router(noraops_client_router)
app.include_router(noraops_packages_router)
app.include_router(noraops_ai_router)
app.include_router(noraops_ai_proxy_router)
app.include_router(noraops_ai_legacy_router)
app.include_router(noraops_ai_web_router)
app.include_router(noraops_pydev_router)
app.include_router(noraops_diagnostics_api_router)
app.include_router(noraops_diagnostics_web_router)

# ルータ登録後に mount（/api 等より後でも /static/* はここで解決）
app.mount("/static", StaticFiles(directory=str(_STATIC_DIR)), name="static")
