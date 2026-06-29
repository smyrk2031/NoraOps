import json
from datetime import datetime, timezone

from app.db.models import TelemetryEvent
from app.services.package_deps_audit import _aggregate_unapproved_from_events, build_review_queue
from app.services.package_review_status import (
    REVIEW_STATUSES,
    get_package_review,
    load_review_status,
    set_package_review,
)


def test_set_and_get_package_review(tmp_path, monkeypatch):
    monkeypatch.setattr(
        "app.services.package_review_status.review_status_path",
        lambda: tmp_path / "review-status.json",
    )
    row = set_package_review("Flask", "considering", note="要調査")
    assert row["package"] == "flask"
    assert row["status"] == "considering"
    assert row["note"] == "要調査"
    got = get_package_review("flask")
    assert got["status"] == "considering"


def test_review_status_invalid_normalized_to_todo(tmp_path, monkeypatch):
    monkeypatch.setattr(
        "app.services.package_review_status.review_status_path",
        lambda: tmp_path / "review-status.json",
    )
    import pytest

    with pytest.raises(ValueError):
        set_package_review("x", "invalid")


def test_aggregate_unapproved_collects_emails_and_versions():
    now = datetime.now(timezone.utc)
    ev = TelemetryEvent(
        event_type="deps_audit",
        source="extension",
        payload_json=json.dumps(
            {
                "unapproved": ["requests", "flask"],
                "installed": [
                    {"name": "requests", "version": "2.31.0"},
                    {"name": "flask", "version": "3.0.0"},
                ],
                "userEmail": "dev@example.com",
            },
            ensure_ascii=False,
        ),
        ip="127.0.0.1",
        user_agent="test",
        created_at=now,
    )
    stats = _aggregate_unapproved_from_events([ev])
    assert stats["requests"]["auditCount"] == 1
    assert "dev@example.com" in stats["requests"]["emails"]
    assert stats["requests"]["versions"]["2.31.0"] == 1
    assert stats["flask"]["versions"]["3.0.0"] == 1


def test_build_review_queue_status_filter():
    stats = {
        "numpy": {"auditCount": 3, "emails": {"a@x.com"}, "versions": {}},
        "flask": {"auditCount": 1, "emails": set(), "versions": {}},
    }
    review_records = {"flask": {"status": "rejected", "note": ""}}
    queue = build_review_queue(stats, status_filter="todo", review_records=review_records)
    assert len(queue) == 1
    assert queue[0]["package"] == "numpy"
    assert queue[0]["reviewStatus"] == "todo"


def test_all_review_statuses_defined():
    assert len(REVIEW_STATUSES) == 5
