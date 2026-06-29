"""App registry service — gitea_repo_id binding (Phase 4)."""

from __future__ import annotations

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.models import Base
from app.db.migrate_registry import migrate_registry_schema
from app.noraops.services.app_registry_service import AppRegistryError, AppRegistryService


def _session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    migrate_registry_schema(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    return factory()


def test_register_stores_gitea_repo_id():
    db = _session()
    svc = AppRegistryService(db)
    row = svc.register("nora.app.test-1", "team", "my-app", gitea_repo_id=42)
    assert row.gitea_repo_id == 42
    found = svc.get_by_gitea_repo_id(42)
    assert found is not None
    assert found.app_id == "nora.app.test-1"


def test_backfill_gitea_repo_id_on_existing_row():
    db = _session()
    svc = AppRegistryService(db)
    svc.register("nora.app.test-2", "team", "legacy", display_name="Legacy")
    row = svc.backfill_gitea_repo_id("team", "legacy", 99)
    assert row is not None
    assert row.gitea_repo_id == 99


def test_rejects_conflicting_gitea_repo_id():
    db = _session()
    svc = AppRegistryService(db)
    svc.register("nora.app.a", "team", "one", gitea_repo_id=10)
    with pytest.raises(AppRegistryError):
        svc.register("nora.app.b", "team", "two", gitea_repo_id=10)


def test_sync_repo_identity_from_gitea_updates_owner_name():
    db = _session()
    svc = AppRegistryService(db)
    svc.register("nora.app.rename", "team", "old-name", gitea_repo_id=55)
    updated = svc.sync_repo_identity_from_gitea(55, "team", "new-name")
    assert updated is not None
    assert updated.owner == "team"
    assert updated.name == "new-name"
    assert svc.get_by_repo("team", "new-name") is not None


def test_binding_lookup_by_gitea_repo_id_field():
    db = _session()
    svc = AppRegistryService(db)
    svc.register("nora.app.lookup", "o", "n", gitea_repo_id=7)
    entry = svc.get_by_gitea_repo_id(7)
    assert entry.app_id == "nora.app.lookup"
