"""Attach NoraOps identity from IIS trusted headers; optional auto-provision."""

from __future__ import annotations

from starlette.requests import Request
from starlette.types import ASGIApp, Receive, Scope, Send

from app.core.config import get_settings
from app.db.session import get_session
from app.noraops.auth.identity import parse_identity_from_request, parse_verified_email_from_request
from app.noraops.auth.session_store import get_session_store
from app.services.gitea_user_provision import resolve_noraops_user
from app.noraops.auth.identity_resolver import ensure_stub_user

_PUBLIC_PREFIXES = (
    "/static",
    "/api/v1/portal/health",
    "/api/health",
    "/docs",
    "/openapi.json",
    "/redoc",
    "/api/v1/noraops/auth/otp/",
    "/api/v1/noraops/auth/register-email",
    "/api/v1/noraops/auth/reissue-access-token",
    "/api/v1/noraops/auth/activate-email",
)


class AuthIdentityMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request = Request(scope, receive)
        settings = get_settings()
        scope["state"] = scope.get("state") or {}
        request.state.noraops_identity = None
        request.state.noraops_user = None
        request.state.noraops_session_canonical = None

        session_raw = (request.headers.get("X-NoraOps-Session-Token") or "").strip()
        if session_raw:
            try:
                db = next(get_session())
                canonical = get_session_store().resolve_canonical(db, settings, session_raw, touch=False)
                if canonical:
                    request.state.noraops_session_canonical = canonical
                db.close()
            except Exception:
                pass

        identity = parse_identity_from_request(request, settings)
        request.state.noraops_identity = identity

        should_provision = identity and settings.noraops_gitea_auto_provision
        if identity and settings.is_windows_trust_auth and settings.noraops_require_email_activation:
            try:
                db = next(get_session())
                user = await ensure_stub_user(db, settings, identity)
                request.state.noraops_user = user
                db.close()
            except Exception:
                pass
        elif should_provision and identity:
            try:
                db = next(get_session())
                user = await resolve_noraops_user(db, settings, identity, verified_email=None)
                request.state.noraops_user = user
                db.close()
            except Exception:
                pass

        await self.app(scope, receive, send)
