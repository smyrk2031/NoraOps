"""Tests for published version validation."""

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.models import Base, PublishedVersion
from app.noraops.services.published_version_service import (
    publish_state_payload,
    record_published_version,
    suggest_next_version,
    validate_version_bump,
    version_to_tag,
)


def test_validate_version_bump_rejects_downgrade():
    with pytest.raises(ValueError, match="以上"):
        validate_version_bump("1.0.0", "1.2.0")


def test_validate_version_bump_rejects_same():
    with pytest.raises(ValueError, match="既に公開済み"):
        validate_version_bump("1.2.0", "1.2.0")


def test_validate_version_bump_accepts_patch():
    assert validate_version_bump("1.2.1", "1.2.0") == "1.2.1"
    assert version_to_tag("1.2.1") == "v1.2.1"


def test_suggest_next_version():
    assert suggest_next_version("1.2.0") == "1.2.1"
    assert suggest_next_version(None) == "0.1.0"


def test_publish_state_and_record():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    db = Session()
    record_published_version(
        db,
        owner="alice",
        name="demo",
        version="1.0.0",
        tag="v1.0.0",
        commit_sha="abc",
        published_by_email="alice@example.com",
        published_by_login="alice",
    )
    state = publish_state_payload(db, "alice", "demo")
    assert state["latestPublishedVersion"] == "1.0.0"
    assert state["suggestedVersion"] == "1.0.1"
    assert len(state["publishedVersions"]) == 1
    assert state["publishedVersions"][0]["publisherEmail"] == "alice@example.com"
    db.close()
