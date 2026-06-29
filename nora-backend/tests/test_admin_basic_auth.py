"""Tests for optional admin Basic auth middleware."""

import base64

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.middleware.admin_basic_auth import AdminBasicAuthMiddleware


def _make_app():
    app = FastAPI()
    app.add_middleware(AdminBasicAuthMiddleware)

    @app.get("/admin")
    def admin_home():
        return {"ok": True}

    @app.get("/api/admin/ping")
    def admin_api():
        return {"pong": True}

    @app.get("/help")
    def public_help():
        return {"public": True}

    return app


def test_admin_basic_auth_disabled_by_default(monkeypatch):
    monkeypatch.setenv("NORAOPS_ADMIN_BASIC_USER", "")
    monkeypatch.setenv("NORAOPS_ADMIN_BASIC_PASSWORD", "")
    from app.core.config import get_settings

    get_settings.cache_clear()

    client = TestClient(_make_app())
    assert client.get("/admin").status_code == 200
    get_settings.cache_clear()


def test_admin_basic_auth_protects_admin_paths(monkeypatch):
    monkeypatch.setenv("NORAOPS_ADMIN_BASIC_USER", "admin")
    monkeypatch.setenv("NORAOPS_ADMIN_BASIC_PASSWORD", "secret")
    from app.core.config import get_settings

    get_settings.cache_clear()

    client = TestClient(_make_app())
    assert client.get("/admin").status_code == 401
    assert client.get("/help").status_code == 200

    token = base64.b64encode(b"admin:secret").decode("ascii")
    res = client.get("/admin", headers={"Authorization": f"Basic {token}"})
    assert res.status_code == 200
    assert res.json()["ok"] is True

    get_settings.cache_clear()
