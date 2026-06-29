"""HTTP integration tests for email_token auth (register / activate / push)."""

from __future__ import annotations

import re
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import get_settings
from app.db import session as db_session_mod
from app.db.migrate_identity import migrate_identity_schema
from app.db.models import Base
from app.db.session import get_session
from app.main import app

CAPTURED_ACTIVATION_TOKENS: list[str] = []


@pytest.fixture()
def test_db_engine():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    migrate_identity_schema(engine)
    Base.metadata.create_all(bind=engine)
    try:
        yield engine
    finally:
        engine.dispose()


@pytest.fixture()
def test_session_factory(test_db_engine):
    return sessionmaker(bind=test_db_engine, autoflush=False, autocommit=False)


def _bind_test_database(engine, factory: sessionmaker, monkeypatch: pytest.MonkeyPatch):
    """Route handlers and middleware both call get_session(); point it at the in-memory DB."""
    monkeypatch.setattr(db_session_mod, "_engine", None)
    monkeypatch.setattr(db_session_mod, "_session_factory", None)

    def _override_session():
        session = factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_session] = _override_session
    monkeypatch.setattr(db_session_mod, "_engine", engine)
    monkeypatch.setattr(db_session_mod, "_session_factory", factory)


@pytest.fixture()
def email_token_client(test_db_engine, test_session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("NORAOPS_AUTH_MODE", "email_token")
    monkeypatch.setenv("NORAOPS_GITEA_AUTO_PROVISION", "1")
    get_settings.cache_clear()
    _bind_test_database(test_db_engine, test_session_factory, monkeypatch)
    client = TestClient(app)
    try:
        yield client
    finally:
        app.dependency_overrides.clear()
        get_settings.cache_clear()


@pytest.fixture()
def open_mode_client(test_db_engine, test_session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("NORAOPS_AUTH_MODE", "open")
    get_settings.cache_clear()
    _bind_test_database(test_db_engine, test_session_factory, monkeypatch)
    client = TestClient(app)
    try:
        yield client
    finally:
        app.dependency_overrides.clear()
        get_settings.cache_clear()


def _capture_activation_token(
    settings,
    *,
    to_addr: str,
    subject: str,
    body_text: str,
    body_html: str | None = None,
) -> None:
    text = f"{body_html or ''}{body_text}"
    match = re.search(r"activate-email\?token=([^\"'\s<>]+)", text)
    if match:
        CAPTURED_ACTIVATION_TOKENS.append(match.group(1))


async def _fake_provision(db, settings, user, **kwargs):
    ident = kwargs.get("identity")
    user.gitea_login = ident.username if ident else "user"
    user.gitea_token_encrypted = "encrypted"
    if kwargs.get("email"):
        user.verified_email = kwargs["email"]
    db.commit()
    return True


@pytest.fixture()
def mock_mail_and_gitea():
    CAPTURED_ACTIVATION_TOKENS.clear()
    with patch("app.noraops.auth.email_activation_service.send_mail", side_effect=_capture_activation_token):
        with patch(
            "app.noraops.auth.email_activation_service.provision_gitea_for_canonical",
            new_callable=AsyncMock,
            side_effect=_fake_provision,
        ):
            yield CAPTURED_ACTIVATION_TOKENS


def _activate_via_http(client: TestClient, activation_token: str) -> str:
    response = client.get(f"/api/v1/noraops/auth/activate-email?token={activation_token}")
    assert response.status_code == 200, response.text
    match = re.search(r'id="tok"[^>]*>([^<]+)</code>', response.text)
    assert match, response.text
    return match.group(1).strip()


def _register_and_get_access_token(client: TestClient, email: str, captured: list[str]) -> str:
    reg = client.post("/api/v1/noraops/auth/register-email", json={"email": email})
    assert reg.status_code == 200, reg.text
    assert len(captured) == 1
    return _activate_via_http(client, captured[0])


def test_register_email_http(email_token_client: TestClient, mock_mail_and_gitea):
    response = email_token_client.post(
        "/api/v1/noraops/auth/register-email",
        json={"email": "alice@corp.example.com"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["email"] == "alice@corp.example.com"
    assert body["registrationStatus"] == "pending_activation"


def test_push_sessions_requires_token(email_token_client: TestClient, mock_mail_and_gitea):
    response = email_token_client.post("/api/v1/noraops/push/sessions", json={})
    assert response.status_code == 401
    detail = response.json()["detail"]
    assert detail["code"] == "access_token_required"


def test_push_sessions_rejects_invalid_token(email_token_client: TestClient, mock_mail_and_gitea):
    response = email_token_client.post(
        "/api/v1/noraops/push/sessions",
        json={},
        headers={"X-NoraOps-Access-Token": "not-a-valid-token"},
    )
    assert response.status_code == 401
    detail = response.json()["detail"]
    assert detail["code"] == "access_token_invalid"


def test_full_flow_register_activate_push(email_token_client: TestClient, mock_mail_and_gitea):
    access_token = _register_and_get_access_token(
        email_token_client, "bob@corp.example.com", mock_mail_and_gitea
    )
    push = email_token_client.post(
        "/api/v1/noraops/push/sessions",
        json={"device_label": "test-pc", "scope": "write"},
        headers={"X-NoraOps-Access-Token": access_token},
    )
    assert push.status_code == 200, push.text
    body = push.json()
    assert body.get("pushToken")
    assert body.get("scope") == "write"


def test_registration_status_provisioned_with_token(email_token_client: TestClient, mock_mail_and_gitea):
    access_token = _register_and_get_access_token(
        email_token_client, "carol@corp.example.com", mock_mail_and_gitea
    )
    status = email_token_client.get(
        "/api/v1/noraops/auth/registration-status",
        headers={"X-NoraOps-Access-Token": access_token},
    )
    assert status.status_code == 200
    body = status.json()
    assert body["authMode"] == "email_token"
    assert body["registrationStatus"] == "provisioned"
    assert body["provisioned"] is True
    assert body["requiresAccessToken"] is True
    assert body["email"] == "carol@corp.example.com"


def test_reissue_invalidates_old_token(email_token_client: TestClient, mock_mail_and_gitea):
    email = "dave@corp.example.com"
    token1 = _register_and_get_access_token(email_token_client, email, mock_mail_and_gitea)

    push1 = email_token_client.post(
        "/api/v1/noraops/push/sessions",
        json={},
        headers={"X-NoraOps-Access-Token": token1},
    )
    assert push1.status_code == 200

    reissue = email_token_client.post("/api/v1/noraops/auth/reissue-access-token", json={"email": email})
    assert reissue.status_code == 200, reissue.text
    assert len(mock_mail_and_gitea) == 2

    token2 = _activate_via_http(email_token_client, mock_mail_and_gitea[1])
    assert token2
    assert token2 != token1

    push_old = email_token_client.post(
        "/api/v1/noraops/push/sessions",
        json={},
        headers={"X-NoraOps-Access-Token": token1},
    )
    assert push_old.status_code == 401

    push_new = email_token_client.post(
        "/api/v1/noraops/push/sessions",
        json={},
        headers={"X-NoraOps-Access-Token": token2},
    )
    assert push_new.status_code == 200


def test_open_mode_push_without_token(open_mode_client: TestClient):
    response = open_mode_client.post("/api/v1/noraops/push/sessions", json={})
    assert response.status_code == 200
    assert response.json().get("pushToken")
