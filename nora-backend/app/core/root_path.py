"""IIS/ARR サブパス（/NoraOps）とローカル直起動（/）の両立。"""

from __future__ import annotations

from starlette.requests import Request

from app.core.config import Settings, get_settings
from app.core.version import get_portal_display_version


def normalize_prefix(value: str | None) -> str:
    """'/NoraOps' or 'NoraOps' → '/NoraOps'、空は ''。"""
    raw = (value or "").strip()
    if not raw or raw == "/":
        return ""
    if not raw.startswith("/"):
        raw = f"/{raw}"
    return raw.rstrip("/")


def configured_root_path(settings: Settings | None = None) -> str:
    settings = settings or get_settings()
    return normalize_prefix(settings.noraops_root_path)


def resolve_request_root_path(request: Request, settings: Settings | None = None) -> str:
    """
    優先: X-Forwarded-Prefix / X-Script-Name → NORAOPS_ROOT_PATH → 空（ローカル直起動）
    """
    settings = settings or get_settings()
    header = normalize_prefix(
        request.headers.get("x-forwarded-prefix") or request.headers.get("x-script-name")
    )
    if header:
        return header
    return configured_root_path(settings)


def strip_prefix_from_path(path: str, root: str) -> str:
    if not root:
        return path or "/"
    if path == root:
        return "/"
    prefix = root + "/"
    if path.startswith(prefix):
        return "/" + path[len(prefix) :].lstrip("/")
    return path


def join_root_path(root: str, path: str) -> str:
    """テンプレート・公開 URL 用。root='/NoraOps', path='/static/x.css' → '/NoraOps/static/x.css'"""
    root = normalize_prefix(root)
    if not path.startswith("/"):
        path = f"/{path}"
    if not root:
        return path
    return f"{root}{path}"


def resolve_public_path(
    path: str,
    *,
    request: Request | None = None,
    settings: Settings | None = None,
) -> str:
    """
    相対パス（/static/... 等）にサブパス prefix を付与。
    既に http(s):// ならそのまま返す。
    """
    raw = (path or "").strip()
    if not raw:
        return raw
    if raw.startswith("http://") or raw.startswith("https://"):
        return raw
    root = ""
    if request is not None:
        root = resolve_request_root_path(request, settings)
    if not root:
        root = configured_root_path(settings)
    if raw.startswith("/"):
        return join_root_path(root, raw)
    return raw


def resolve_public_url(
    path: str,
    *,
    request: Request | None = None,
    settings: Settings | None = None,
) -> str:
    """相対パスを外向き絶対 URL に（NORAOPS_PUBLIC_BASE_URL 優先）。"""
    raw = (path or "").strip()
    if raw.startswith("http://") or raw.startswith("https://"):
        return raw
    base = public_base_url(request, settings).rstrip("/")
    if not raw.startswith("/"):
        raw = f"/{raw}"
    return f"{base}{raw}"


def public_base_url(request: Request | None, settings: Settings | None = None) -> str:
    """
    外向きのベース URL（サムネイル・拡張向け）。
    NORAOPS_PUBLIC_BASE_URL があれば最優先。
    """
    settings = settings or get_settings()
    explicit = (settings.noraops_public_base_url or "").strip().rstrip("/")
    if explicit:
        return explicit
    if request is None:
        host = settings.host
        if host in ("0.0.0.0", "::"):
            host = "127.0.0.1"
        root = configured_root_path(settings)
        base = f"http://{host}:{settings.port}".rstrip("/")
        if root:
            return f"{base}{root}"
        return base

    proto = (request.headers.get("x-forwarded-proto") or "http").split(",")[0].strip()
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or "localhost"
    root = resolve_request_root_path(request, settings)
    return f"{proto}://{host}{root}".rstrip("/")


def template_context(request: Request, context: dict | None = None) -> dict:
    # ASGI scope["root_path"] は使わない（StaticFiles ルーティングと衝突する）
    root = resolve_request_root_path(request)
    ctx = dict(context or {})
    ctx["root_path"] = root

    def url(path: str) -> str:
        return join_root_path(root, path)

    ctx["url"] = url
    ctx["public_base"] = public_base_url(request)
    ctx["root_path_prefix"] = root
    ctx["app_version"] = get_portal_display_version()
    ctx["brand_favicon_url"] = url("/static/brand/favicon.png")
    return ctx
