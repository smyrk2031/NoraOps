"""Unit tests for repo access helpers (Gitea permissions)."""

from __future__ import annotations

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.models import Base, NoraOpsUser
from app.db.migrate_registry import migrate_registry_schema
from app.noraops.services.repo_access_service import (
    RepoAccessError,
    assert_repo_write_access,
    can_write_repo,
    repo_role,
    repo_summary,
    resolve_email_to_gitea_login,
)


def _session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    migrate_registry_schema(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    return factory()


def test_repo_role_owner_vs_collaborator():
    repo = {
        "owner": {"login": "alice"},
        "name": "demo",
        "permissions": {"admin": False, "push": True, "pull": True},
    }
    assert repo_role(repo, "alice") == "owner"
    assert repo_role(repo, "bob") == "write"


def test_repo_summary_includes_role_and_clone():
    repo = {
        "id": 7,
        "owner": {"login": "alice"},
        "name": "demo",
        "full_name": "alice/demo",
        "html_url": "https://gitea.example/alice/demo",
        "clone_url": "https://gitea.example/alice/demo.git",
        "private": True,
        "permissions": {"admin": True, "push": True, "pull": True},
    }
    summary = repo_summary(repo, actor_login="alice")
    assert summary["fullName"] == "alice/demo"
    assert summary["role"] == "owner"
    assert summary["giteaRepoId"] == 7
    assert summary["cloneUrl"].endswith(".git")


def test_can_write_repo_requires_push_or_admin():
    assert can_write_repo({"permissions": {"push": True}}) is True
    assert can_write_repo({"permissions": {"admin": True, "push": False}}) is True
    assert can_write_repo({"permissions": {"pull": True}}) is False
    assert can_write_repo(None) is False


def test_resolve_email_to_gitea_login():
    db = _session()
    db.add(
        NoraOpsUser(
            verified_email="dev@example.com",
            gitea_login="devuser",
        )
    )
    db.commit()
    assert resolve_email_to_gitea_login(db, "dev@example.com") == "devuser"
    assert resolve_email_to_gitea_login(db, "missing@example.com") is None


class _FakeGitea:
    def __init__(self, repo: dict | None) -> None:
        self._repo = repo

    async def get_repo(self, owner: str, name: str) -> dict | None:
        return self._repo


@pytest.mark.asyncio
async def test_assert_repo_write_access_rejects_read_only():
    repo = {
        "owner": {"login": "alice"},
        "name": "demo",
        "permissions": {"pull": True, "push": False, "admin": False},
    }
    client = _FakeGitea(repo)
    with pytest.raises(RepoAccessError) as exc:
        await assert_repo_write_access(client, "alice", "demo", actor_login="bob")
    assert exc.value.code == "repo_forbidden"


@pytest.mark.asyncio
async def test_assert_repo_write_access_allows_create_for_actor():
    client = _FakeGitea(None)
    result = await assert_repo_write_access(
        client, "alice", "new-app", actor_login="alice", allow_create_as_actor=True
    )
    assert result is None


@pytest.mark.asyncio
async def test_assert_repo_write_access_blocks_create_for_other_owner():
    client = _FakeGitea(None)
    with pytest.raises(RepoAccessError) as exc:
        await assert_repo_write_access(
            client, "alice", "new-app", actor_login="bob", allow_create_as_actor=True
        )
    assert exc.value.code == "repo_forbidden"
