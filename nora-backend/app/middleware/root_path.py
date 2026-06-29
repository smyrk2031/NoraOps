"""リクエストパスの正規化（外部 /NoraOps/... → 内部ルータ /...）。"""

from __future__ import annotations

from starlette.requests import Request
from starlette.types import ASGIApp, Receive, Scope, Send

from app.core.root_path import resolve_request_root_path, strip_prefix_from_path


class RootPathMiddleware:
    """
    IIS/ARR サブパス対応。

    - 着信 `/NoraOps/api/...` → 内部 `/api/...` に path のみ書き換え
    - **scope["root_path"] は書き換えない**（Starlette StaticFiles が二重 `static/` を探して 404 になるため）
    - HTML/API の公開 prefix は `resolve_request_root_path()`（env / X-Forwarded-Prefix）で別管理
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":
            request = Request(scope, receive)
            root = resolve_request_root_path(request)
            if root:
                scope["path"] = strip_prefix_from_path(scope.get("path") or "/", root)
        await self.app(scope, receive, send)
