"""Email activation flow (windows_trust)."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import Settings
from app.db.migrate_identity import migrate_identity_schema
from app.db.models import Base, NoraOpsEmailActivation
from app.noraops.auth.email_activation_service import (
    get_email_activation_service,
    is_user_provisioned,
    registration_status,
)
from app.noraops.auth.identity import NoraOpsIdentity
from app.noraops.auth.identity_resolver import ensure_stub_user


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
