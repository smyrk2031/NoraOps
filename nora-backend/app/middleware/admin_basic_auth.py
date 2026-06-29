"""管理画面 /admin 向け HTTP Basic 認証（任意・既定 OFF）。"""

from __future__ import annotations

import base64
import secrets

from starlette.requests import Request
from starlette.responses import Response
from starlette.types import ASGIApp, Receive, Scope, Send

from app.core.config import get_settings

_ADMIN_PREFIXES = ("/admin", "/api/admin")


def _needs_admin_auth(path: str) -> bool:
    p = path or "/"
    return any(p == prefix or p.startswith(prefix + "/") for prefix in _ADMIN_PREFIXES)


def _parse_basic(header: str) -> tuple[str, str] | None:
    raw = (header or "").strip()
    if not raw.lower().startswith("basic "):
        return None
    try:
        decoded = base64.b64decode(raw[6:].strip(), validate=False).decode("utf-8")
    except (ValueError, UnicodeDecodeError):
        return None
    if ":" not in decoded:
        return None
    user, password = decoded.split(":", 1)
    return user, password


class AdminBasicAuthMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    def _credentials(self) -> tuple[str, str] | None:
        settings = get_settings()
        user = (getattr(settings, "noraops_admin_basic_user", None) or "").strip()
        password = (getattr(settings, "noraops_admin_basic_password", None) or "").strip()
        if not user or not password:
            return None
        return user, password

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        creds = self._credentials()
        if not creds:
            await self.app(scope, receive, send)
            return

        path = scope.get("path") or "/"
        if not _needs_admin_auth(path):
            await self.app(scope, receive, send)
            return

        request = Request(scope, receive)
        parsed = _parse_basic(request.headers.get("authorization", ""))
        expected_user, expected_pass = creds
        ok = False
        if parsed:
            user, password = parsed
            ok = secrets.compare_digest(user, expected_user) and secrets.compare_digest(
                password, expected_pass
            )

        if ok:
            await self.app(scope, receive, send)
            return

        response = Response(
            content="Admin authentication required.",
            status_code=401,
            headers={"WWW-Authenticate": 'Basic realm="NoraOps Admin", charset="UTF-8"'},
        )
        await response(scope, receive, send)
