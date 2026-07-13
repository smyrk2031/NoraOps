"""Admin user management (all identity kinds)."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import Settings
from app.db.migrate_identity import migrate_identity_schema
from app.db.models import Base, NoraOpsIdentityRow, NoraOpsUser
from app.noraops.auth.email_util import email_external_id, manual_external_id
from app.services.admin_user_service import (
    admin_user_to_dict,
    issue_admin_access_token,
    list_admin_users,
    retry_admin_user_gitea,
    update_admin_user_email,
)


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


def _settings() -> Settings:
    return Settings(NORAOPS_AUTH_MODE="email_token", NORAOPS_GITEA_AUTO_PROVISION=False)


def _seed_email_user(db: Session, *, email: str, login: str) -> NoraOpsUser:
    user = NoraOpsUser(
        canonical_user_id="user-email-1",
        gitea_login=login,
        gitea_id=10,
        verified_email=email,
        gitea_token_encrypted="enc",
    )
    db.add(user)
    db.add(
        NoraOpsIdentityRow(
            external_id=email_external_id(email),
            canonical_user_id=user.canonical_user_id,
            kind="email",
            email=email,
        )
    )
    db.commit()
    return user


def _seed_manual_user(db: Session) -> NoraOpsUser:
    user = NoraOpsUser(
        canonical_user_id="user-manual-1",
        gitea_login="manual_ops",
        gitea_id=11,
        verified_email="",
        gitea_token_encrypted="enc",
    )
    db.add(user)
    db.add(
        NoraOpsIdentityRow(
            external_id=manual_external_id("ops_demo"),
            canonical_user_id=user.canonical_user_id,
            kind="manual",
            email="初回デモ用",
        )
    )
    db.commit()
    return user


def test_list_admin_users_all_kinds(db_session: Session):
    _seed_email_user(db_session, email="alice@example.com", login="alice")
    _seed_manual_user(db_session)
    rows = list_admin_users(db_session)
    assert len(rows) == 2
    kinds = {tuple(r.identity_kinds) for r in rows}
    assert ("email",) in kinds
    assert ("manual",) in kinds


def test_list_admin_users_search_by_email(db_session: Session):
    _seed_email_user(db_session, email="alice@example.com", login="alice")
    _seed_manual_user(db_session)
    rows = list_admin_users(db_session, query="alice@example")
    assert len(rows) == 1
    assert rows[0].verified_email == "alice@example.com"


def test_list_admin_users_search_by_manual_memo(db_session: Session):
    _seed_email_user(db_session, email="alice@example.com", login="alice")
    _seed_manual_user(db_session)
    rows = list_admin_users(db_session, query="デモ")
    assert len(rows) == 1
    assert rows[0].gitea_login == "manual_ops"


def test_update_admin_user_email(db_session: Session):
    _seed_email_user(db_session, email="alice@example.com", login="alice")
    row = update_admin_user_email(
        db_session,
        "user-email-1",
        verified_email="alice.new@example.com",
    )
    assert row.verified_email == "alice.new@example.com"


@pytest.mark.asyncio
async def test_retry_admin_user_gitea(db_session: Session):
    user = NoraOpsUser(
        canonical_user_id="user-pending-1",
        gitea_login="",
        verified_email="bob@example.com",
    )
    db_session.add(user)
    db_session.add(
        NoraOpsIdentityRow(
            external_id=email_external_id("bob@example.com"),
            canonical_user_id=user.canonical_user_id,
            kind="email",
            email="bob@example.com",
        )
    )
    db_session.commit()

    async def _fake_provision(db, _settings, row, **kwargs):
        row.gitea_login = "bob"
        row.gitea_id = 99
        row.gitea_token_encrypted = "enc-token"
        return True

    with patch(
        "app.services.admin_user_service.provision_gitea_for_canonical",
        new_callable=AsyncMock,
    ) as prov:
        prov.side_effect = _fake_provision
        row = await retry_admin_user_gitea(db_session, _settings(), "user-pending-1")

    assert row.provisioned is True
    assert row.gitea_login == "bob"


def test_issue_admin_access_token(db_session: Session):
    _seed_email_user(db_session, email="alice@example.com", login="alice")
    row, token = issue_admin_access_token(db_session, _settings(), "user-email-1")
    assert len(token) > 16
    data = admin_user_to_dict(row)
    assert data["hasAccessToken"] is True
