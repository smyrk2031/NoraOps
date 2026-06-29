"""IIS/ARR サブパスとローカル直起動の root_path ユーティリティ。"""

from unittest.mock import MagicMock

import pytest

from app.core.root_path import (
    join_root_path,
    normalize_prefix,
    public_base_url,
    resolve_public_path,
    resolve_public_url,
    strip_prefix_from_path,
    template_context,
)


def test_normalize_prefix():
    assert normalize_prefix("") == ""
    assert normalize_prefix("/") == ""
    assert normalize_prefix("NoraOps") == "/NoraOps"
    assert normalize_prefix("/NoraOps/") == "/NoraOps"


def test_strip_prefix_from_path():
    root = "/NoraOps"
    assert strip_prefix_from_path("/NoraOps", root) == "/"
    assert strip_prefix_from_path("/NoraOps/api/health", root) == "/api/health"
    assert strip_prefix_from_path("/api/health", root) == "/api/health"


def test_join_root_path():
    assert join_root_path("", "/static/x.css") == "/static/x.css"
    assert join_root_path("/NoraOps", "/static/x.css") == "/NoraOps/static/x.css"


def test_resolve_public_path():
    from app.core.config import Settings

    s = Settings(
        NORAOPS_ROOT_PATH="/NoraOps",
        NORAOPS_PUBLIC_BASE_URL="",
        _env_file=None,
    )
    assert resolve_public_path("/static/a.vsix", settings=s) == "/NoraOps/static/a.vsix"
    assert resolve_public_path("https://x/y.vsix", settings=s) == "https://x/y.vsix"
    assert resolve_public_url("/api/health", settings=s) == "http://127.0.0.1:8000/NoraOps/api/health"


def test_public_base_url_without_request(monkeypatch):
    from app.core.config import Settings

    s = Settings(
        SOFTRAIL_HOST="127.0.0.1",
        SOFTRAIL_PORT=8000,
        NORAOPS_ROOT_PATH="/NoraOps",
        NORAOPS_PUBLIC_BASE_URL="",
        _env_file=None,
    )
    assert public_base_url(None, s) == "http://127.0.0.1:8000/NoraOps"
    s2 = Settings(
        SOFTRAIL_HOST="127.0.0.1",
        SOFTRAIL_PORT=8000,
        NORAOPS_ROOT_PATH="",
        NORAOPS_PUBLIC_BASE_URL="",
        _env_file=None,
    )
    assert public_base_url(None, s2) == "http://127.0.0.1:8000"


def test_template_context_url(monkeypatch):
    monkeypatch.setenv("NORAOPS_ROOT_PATH", "")
    from app.core.config import get_settings

    get_settings.cache_clear()
    request = MagicMock()
    request.scope = {}
    request.headers = {}
    ctx = template_context(request, {})
    assert ctx["url"]("/static/styles.css") == "/static/styles.css"
    get_settings.cache_clear()
