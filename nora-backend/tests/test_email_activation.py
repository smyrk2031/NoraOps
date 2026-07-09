"""Email activation flow (windows_trust)."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import Settings
from app.db.migrate_identity import migrate_identity_schema
from app.db.models import Base, NoraOpsEmailActivation, NoraOpsUser
from app.noraops.auth.email_activation_service import (
    get_email_activation_service,
    is_user_provisioned,
    registration_status,
)
from app.noraops.auth.identity import NoraOpsIdentity
from app.noraops.auth.identity_resolver import ensure_stub_user
from app.services.gitea_user_provision import GiteaProvisionError


@pytest.fixture()
def db_session() -> Session:
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    migrate_identity_schema(engine)
    Base.metadata.create_all(bind=engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    session = factory()
    try:
        yield session
    finally:
        session.close()


def _windows_settings() -> Settings:
    return Settings(
        NORAOPS_AUTH_MODE="windows_trust",
        NORAOPS_GITEA_AUTO_PROVISION=True,
        NORAOPS_REQUIRE_EMAIL_ACTIVATION=True,
        NORAOPS_ACTIVATION_TTL_HOURS=24,
        NORAOPS_MAIL_PROVIDER="smtp",
        NORAOPS_SMTP_HOST="",
    )


def _email_token_settings() -> Settings:
    return Settings(
        NORAOPS_AUTH_MODE="email_token",
        NORAOPS_GITEA_AUTO_PROVISION=False,
        NORAOPS_MAIL_PROVIDER="smtp",
        NORAOPS_SMTP_HOST="",
    )


@pytest.mark.asyncio
async def test_stub_user_without_gitea(db_session: Session):
    settings = _windows_settings()
    ident = NoraOpsIdentity(external_id="CORP\\bob", domain="CORP", username="bob", raw="CORP\\bob")
    user = await ensure_stub_user(db_session, settings, ident)
    assert user is not None
    assert user.gitea_login == ""
    assert not is_user_provisioned(user)
    assert registration_status(user) == "pending_email"


@pytest.mark.asyncio
async def test_registration_status_provision_incomplete(db_session: Session):
    user = NoraOpsUser(canonical_user_id="u1", gitea_login="alice", verified_email="alice@corp.example.com")
    assert registration_status(user) == "provision_incomplete"
    assert registration_status(user, "alice@corp.example.com") == "pending_activation"


@pytest.mark.asyncio
async def test_register_email_creates_activation(db_session: Session):
    settings = _windows_settings()
    ident = NoraOpsIdentity(external_id="CORP\\carol", domain="CORP", username="carol", raw="CORP\\carol")
    await ensure_stub_user(db_session, settings, ident)
    svc = get_email_activation_service()
    with patch("app.noraops.auth.email_activation_service.send_mail") as send:
        email = await svc.request_activation(
            db_session, settings, external_id="CORP\\carol", email="carol@corp.example.com"
        )
    assert email == "carol@corp.example.com"
    send.assert_called_once()
    row = db_session.query(NoraOpsEmailActivation).filter_by(external_id="CORP\\carol").first()
    assert row is not None
    assert row.email_normalized == "carol@corp.example.com"
    assert registration_status(None, "carol@corp.example.com") == "pending_activation"


@pytest.mark.asyncio
async def test_register_email_allows_resend_when_not_provisioned(db_session: Session):
    settings = _email_token_settings()
    svc = get_email_activation_service()
    with patch("app.noraops.auth.email_activation_service.send_mail"):
        await svc.request_registration(db_session, settings, email="retry@corp.example.com")
    with patch("app.noraops.auth.email_activation_service.send_mail") as send:
        email = await svc.request_registration(db_session, settings, email="retry@corp.example.com")
    assert email == "retry@corp.example.com"
    send.assert_called_once()


@pytest.mark.asyncio
async def test_activate_provisions_gitea(db_session: Session):
    settings = _windows_settings()
    ident = NoraOpsIdentity(external_id="CORP\\dave", domain="CORP", username="dave", raw="CORP\\dave")
    user = await ensure_stub_user(db_session, settings, ident)
    svc = get_email_activation_service()
    with patch("app.noraops.auth.email_activation_service.send_mail"):
        await svc.request_activation(
            db_session, settings, external_id="CORP\\dave", email="dave@corp.example.com"
        )
    row = db_session.query(NoraOpsEmailActivation).filter_by(external_id="CORP\\dave").first()
    assert row is not None
    from app.noraops.auth.email_activation_service import _hash_token

    token = "test-token-value-for-activation-flow"
    row.token_hash = _hash_token(token)
    db_session.commit()

    with patch(
        "app.noraops.auth.email_activation_service.provision_gitea_for_canonical",
        new_callable=AsyncMock,
    ) as prov:
        prov.return_value = True
        activated = await svc.activate_token(db_session, settings, token)
    assert activated.user.canonical_user_id == user.canonical_user_id
    prov.assert_called_once()
    db_session.refresh(row)
    assert row.consumed is True


@pytest.mark.asyncio
async def test_activate_keeps_token_when_gitea_fails(db_session: Session):
    settings = _email_token_settings()
    svc = get_email_activation_service()
    with patch("app.noraops.auth.email_activation_service.send_mail"):
        await svc.request_registration(db_session, settings, email="fail@corp.example.com")
    row = db_session.query(NoraOpsEmailActivation).filter_by(
        external_id="email:fail@corp.example.com"
    ).first()
    from app.noraops.auth.email_activation_service import _hash_token

    token = "activation-token-gitea-fail-case"
    row.token_hash = _hash_token(token)
    db_session.commit()

    with patch(
        "app.noraops.auth.email_activation_service.provision_gitea_for_canonical",
        new_callable=AsyncMock,
    ) as prov:
        prov.side_effect = GiteaProvisionError("token", "permission denied", hint="fix PAT")
        with pytest.raises(ValueError, match="Gitea 登録に失敗"):
            await svc.activate_token(db_session, settings, token)
    db_session.refresh(row)
    assert row.consumed is False


@pytest.mark.asyncio
async def test_reissue_sends_activation_when_not_provisioned(db_session: Session):
    settings = _email_token_settings()
    svc = get_email_activation_service()
    with patch("app.noraops.auth.email_activation_service.send_mail"):
        await svc.request_registration(db_session, settings, email="half@corp.example.com")
    with patch("app.noraops.auth.email_activation_service.send_mail") as send:
        email = await svc.request_reissue(db_session, settings, email="half@corp.example.com")
    assert email == "half@corp.example.com"
    send.assert_called_once()
    assert "再開" in send.call_args.kwargs.get("subject", send.call_args[0][3] if len(send.call_args[0]) > 3 else "")


@pytest.mark.asyncio
async def test_retry_gitea_provision(db_session: Session):
    settings = _email_token_settings()
    svc = get_email_activation_service()
    with patch("app.noraops.auth.email_activation_service.send_mail"):
        await svc.request_registration(db_session, settings, email="recover@corp.example.com")
    with patch(
        "app.noraops.auth.email_activation_service.provision_gitea_for_canonical",
        new_callable=AsyncMock,
    ) as prov:
        async def _mark_provisioned(db, _settings, user, **kwargs):
            user.gitea_login = "recover"
            user.gitea_token_encrypted = "enc"
            return True

        prov.side_effect = _mark_provisioned
        result = await svc.retry_gitea_provision(db_session, settings, email="recover@corp.example.com")
    assert result["status"] == "provisioned"
    assert result["giteaLogin"] == "recover"
