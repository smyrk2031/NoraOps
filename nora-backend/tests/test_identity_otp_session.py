"""Identity resolver, OTP, and session tests."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import Settings
from app.db.migrate_identity import migrate_identity_schema
from app.db.models import Base, NoraOpsIdentityRow, NoraOpsOtpChallenge, NoraOpsSession, NoraOpsUser
from app.noraops.auth.email_util import email_external_id, normalize_email
from app.noraops.auth.identity import NoraOpsIdentity, identity_from_external_id
from app.noraops.auth.identity_resolver import IdentityCollisionError, resolve_identity
from app.noraops.auth.otp_service import OtpRateLimitError, get_otp_service
from app.noraops.auth.session_store import get_session_store


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


def test_normalize_email_and_external_id():
    assert normalize_email("  User@Corp.COM ") == "user@corp.com"
    assert email_external_id("User@Corp.COM") == "email:user@corp.com"


def test_identity_from_external_id_email():
    ident = identity_from_external_id("email:alice@corp.example.com")
    assert ident.external_id == "email:alice@corp.example.com"
    assert ident.username == "alice"


@pytest.mark.asyncio
async def test_resolve_identity_creates_canonical(db_session: Session):
    settings = Settings(NORAOPS_GITEA_AUTO_PROVISION=False)
    ident = NoraOpsIdentity(external_id="CORP\\alice", domain="CORP", username="alice", raw="CORP\\alice")

    with patch("app.noraops.auth.identity_resolver.provision_gitea_for_canonical", new_callable=AsyncMock) as prov:
        prov.return_value = True
        result = await resolve_identity(db_session, settings, ident, auto_provision=True)

    assert result is not None
    assert result.created is True
    user = db_session.get(NoraOpsUser, result.user.canonical_user_id)
    assert user is not None
    alias = db_session.get(NoraOpsIdentityRow, "CORP\\alice")
    assert alias is not None
    assert alias.canonical_user_id == user.canonical_user_id


@pytest.mark.asyncio
async def test_auto_link_by_verified_email(db_session: Session):
    settings = Settings(NORAOPS_GITEA_AUTO_PROVISION=False)
    cid = str(uuid.uuid4())
    user = NoraOpsUser(
        canonical_user_id=cid,
        gitea_login="alice",
        verified_email="alice@corp.example.com",
        gitea_token_encrypted="enc",
    )
    db_session.add(user)
    db_session.add(
        NoraOpsIdentityRow(
            external_id="email:alice@corp.example.com",
            canonical_user_id=cid,
            kind="email",
            email="alice@corp.example.com",
        )
    )
    db_session.commit()

    win_ident = NoraOpsIdentity(external_id="CORP\\alice", domain="CORP", username="alice", raw="CORP\\alice")
    result = await resolve_identity(
        db_session,
        settings,
        win_ident,
        verified_email="alice@corp.example.com",
        auto_provision=False,
    )
    assert result is not None
    assert result.linked is True
    assert db_session.get(NoraOpsIdentityRow, "CORP\\alice") is not None


@pytest.mark.asyncio
async def test_email_collision_guard(db_session: Session):
    settings = Settings(NORAOPS_GITEA_AUTO_PROVISION=False)
    for i, login in enumerate(("alice", "alice2")):
        cid = str(uuid.uuid4())
        db_session.add(
            NoraOpsUser(
                canonical_user_id=cid,
                gitea_login=login,
                verified_email="alice@corp.example.com",
            )
        )
    db_session.commit()

    ident = NoraOpsIdentity(external_id="CORP\\bob", domain="CORP", username="bob", raw="CORP\\bob")
    with pytest.raises(IdentityCollisionError):
        await resolve_identity(db_session, settings, ident, verified_email="alice@corp.example.com")


def test_otp_request_and_verify(db_session: Session):
    settings = Settings(NORAOPS_SMTP_HOST="", NORAOPS_OTP_TTL_MINUTES=10)
    svc = get_otp_service()
    email = "user@corp.example.com"
    with patch.object(svc, "_send_email"):
        svc.request_otp(db_session, settings, email)
    challenge = db_session.query(NoraOpsOtpChallenge).first()
    assert challenge is not None
    assert svc.verify_otp(db_session, email, "000000") is False


def test_otp_rate_limit(db_session: Session):
    settings = Settings(NORAOPS_SMTP_HOST="")
    svc = get_otp_service()
    now = datetime.now(timezone.utc)
    for _ in range(3):
        db_session.add(
            NoraOpsOtpChallenge(
                email_normalized="a@b.com",
                otp_hash="x$y",
                expires_at=now,
                created_at=now.replace(tzinfo=None),
            )
        )
    db_session.commit()
    with patch.object(svc, "_send_email"):
        with pytest.raises(OtpRateLimitError):
            svc.request_otp(db_session, settings, "a@b.com")


def test_session_sliding_touch(db_session: Session):
    import hashlib

    settings = Settings(NORAOPS_SESSION_IDLE_DAYS=7, NORAOPS_SESSION_ABSOLUTE_DAYS=30)
    cid = str(uuid.uuid4())
    user = NoraOpsUser(canonical_user_id=cid, gitea_login="u1")
    db_session.add(user)
    db_session.commit()

    store = get_session_store()
    token = store.create_session(db_session, settings, canonical_user_id=cid)
    resolved1 = store.resolve_canonical(db_session, settings, token, touch=True)
    assert resolved1 == cid

    row = db_session.get(NoraOpsSession, hashlib.sha256(token.encode()).hexdigest())
    assert row is not None
    first_expires = row.expires_at

    row.last_seen_at = datetime.utcnow() - timedelta(days=1)
    row.expires_at = datetime.utcnow() - timedelta(hours=1)
    db_session.commit()

    resolved2 = store.resolve_canonical(db_session, settings, token, touch=True)
    assert resolved2 == cid
    db_session.refresh(row)
    assert row.expires_at >= first_expires or row.expires_at > datetime.utcnow()
