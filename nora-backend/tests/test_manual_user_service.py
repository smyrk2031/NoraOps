"""Manual admin user provisioning."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import Settings
from app.db.migrate_identity import migrate_identity_schema
from app.db.models import Base, NoraOpsIdentityRow, NoraOpsUser
from app.noraops.auth.email_activation_service import is_user_provisioned
from app.noraops.auth.email_util import identity_kind, manual_external_id
from app.services.manual_user_service import (
    create_manual_user,
    issue_manual_access_token,
    list_manual_users,
    slugify_manual_login,
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
    return Settings(
        NORAOPS_AUTH_MODE="email_token",
        NORAOPS_ADMIN_MANUAL_PROVISION=True,
        NORAOPS_GITEA_AUTO_PROVISION=False,
    )


def test_slugify_manual_login_from_memo():
    assert slugify_manual_login("初回デモ用", "") == slugify_manual_login("初回デモ用", "")
    assert slugify_manual_login("demo user", "") == "demo_user"
    assert slugify_manual_login("メモ", "my_login") == "my_login"


def test_identity_kind_manual():
    assert identity_kind(manual_external_id("ops_demo")) == "manual"


@pytest.mark.asyncio
async def test_create_manual_user_provisions_and_issues_token(db_session: Session):
    settings = _settings()

    async def _fake_provision(db, _settings, user, **kwargs):
        user.gitea_login = user.gitea_login or "manual_demo"
        user.gitea_id = 42
        user.gitea_token_encrypted = "enc-token"
        return True

    with patch(
        "app.services.manual_user_service.provision_gitea_for_canonical",
        new_callable=AsyncMock,
    ) as prov:
        prov.side_effect = _fake_provision
        result = await create_manual_user(
            db_session,
            settings,
            memo="初回デモ用",
            gitea_login_hint="manual_demo",
        )

    assert result.gitea_login == "manual_demo"
    assert len(result.access_token) > 16
    assert is_user_provisioned(db_session.get(NoraOpsUser, result.user.canonical_user_id))

    alias = db_session.get(NoraOpsIdentityRow, result.user.external_id)
    assert alias is not None
    assert alias.kind == "manual"
    assert alias.email == "初回デモ用"

    rows = list_manual_users(db_session)
    assert len(rows) == 1
    assert rows[0].memo == "初回デモ用"


@pytest.mark.asyncio
async def test_issue_manual_access_token_revokes_and_reissues(db_session: Session):
    settings = _settings()
    user = NoraOpsUser(
        canonical_user_id="u-manual-1",
        gitea_login="manual_u",
        gitea_id=1,
        gitea_token_encrypted="enc",
    )
    db_session.add(user)
    db_session.add(
        NoraOpsIdentityRow(
            external_id=manual_external_id("manual_u"),
            canonical_user_id="u-manual-1",
            kind="manual",
            email="棚卸用",
        )
    )
    db_session.commit()

    row1, tok1 = issue_manual_access_token(db_session, settings, "u-manual-1")
    row2, tok2 = issue_manual_access_token(db_session, settings, "u-manual-1")
    assert tok1 != tok2
    assert row2.has_access_token is True
