"""サブパス経由の静的ファイル配信。"""

from unittest.mock import MagicMock

from fastapi.testclient import TestClient

from app.core.root_path import template_context
from app.main import app


def test_static_direct():
    client = TestClient(app)
    assert client.get("/static/portal.css").status_code == 200


def test_static_subpath_stripped(monkeypatch):
    """Pattern A: フルパス着信 + NORAOPS_ROOT_PATH で strip（IIS ヘッダなしでも env で可）。"""
    monkeypatch.setenv("NORAOPS_ROOT_PATH", "/NoraOps")
    from app.core.config import get_settings

    get_settings.cache_clear()
    client = TestClient(app)
    assert client.get("/NoraOps/static/portal.css").status_code == 200
    get_settings.cache_clear()


def test_static_subpath_with_forwarded_prefix():
    client = TestClient(app)
    headers = {"X-Forwarded-Prefix": "/NoraOps"}
    assert client.get("/NoraOps/static/portal.css", headers=headers).status_code == 200
    assert client.get("/NoraOps/api/v1/portal/health", headers=headers).status_code == 200


def test_template_url_uses_env_root(monkeypatch):
    monkeypatch.setenv("NORAOPS_ROOT_PATH", "/NoraOps")
    from app.core.config import get_settings

    get_settings.cache_clear()
    request = MagicMock()
    request.scope = {}
    request.headers = {}
    ctx = template_context(request, {})
    assert ctx["url"]("/static/portal.css") == "/NoraOps/static/portal.css"
    get_settings.cache_clear()
