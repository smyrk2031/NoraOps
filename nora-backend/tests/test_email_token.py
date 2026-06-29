"""Email token auth flow (email_token mode)."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import Settings
from app.db.migrate_identity import migrate_identity_schema
from app.db.models import Base, NoraOpsAccessToken, NoraOpsEmailActivation
from app.noraops.auth.access_token_store import get_access_token_store
from app.noraops.auth.email_activation_service import (
    get_email_activation_service,
    is_user_provisioned,
)
from app.noraops.auth.email_util import email_external_id


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


def _email_token_settings() -> Settings:
    return Settings(
        NORAOPS_AUTH_MODE="email_token",
        NORAOPS_GITEA_AUTO_PROVISION=True,
        NORAOPS_PENDING_REGISTRATION_HOURS=12,
        NORAOPS_MAIL_PROVIDER="smtp",
        NORAOPS_SMTP_HOST="",
    )


@pytest.mark.asyncio
async def test_register_email_creates_pending(db_session: Session):
    settings = _email_token_settings()
    svc = get_email_activation_service()
    with patch("app.noraops.auth.email_activation_service.send_mail") as send:
        email = await svc.request_registration(
            db_session, settings, email="alice@corp.example.com"
        )
    assert email == "alice@corp.example.com"
    send.assert_called_once()
    ext = email_external_id("alice@corp.example.com")
    row = db_session.query(NoraOpsEmailActivation).filter_by(external_id=ext).first()
    assert row is not None


@pytest.mark.asyncio
async def test_activate_issues_access_token(db_session: Session):
    settings = _email_token_settings()
    svc = get_email_activation_service()
    with patch("app.noraops.auth.email_activation_service.send_mail"):
        await svc.request_registration(db_session, settings, email="bob@corp.example.com")

    ext = email_external_id("bob@corp.example.com")
    row = db_session.query(NoraOpsEmailActivation).filter_by(external_id=ext).first()
    assert row is not None

    from app.noraops.auth.email_activation_service import _hash_token

    token = "activation-test-token-value-xyz"
    row.token_hash = _hash_token(token)
    db_session.commit()

    async def _fake_prov(db, settings, user, **kwargs):
        user.gitea_login = "bob"
        user.gitea_token_encrypted = "encrypted"
        db.commit()
        return True

    with patch(
        "app.noraops.auth.email_activation_service.provision_gitea_for_canonical",
        new_callable=AsyncMock,
        side_effect=_fake_prov,
    ) as prov:
        result = await svc.activate_token(db_session, settings, token)

    assert is_user_provisioned(result.user)
    assert result.access_token
    canonical = get_access_token_store().resolve_canonical(db_session, settings, result.access_token)
    assert canonical == result.user.canonical_user_id
    assert db_session.query(NoraOpsAccessToken).count() == 1


@pytest.mark.asyncio
async def test_reissue_requires_provisioned_user(db_session: Session):
    settings = _email_token_settings()
    svc = get_email_activation_service()
    with pytest.raises(ValueError, match="登録済み"):
        await svc.request_reissue(db_session, settings, email="nobody@corp.example.com")
