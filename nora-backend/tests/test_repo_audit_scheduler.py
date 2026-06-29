"""Tests for repo audit scheduler timing."""

from datetime import datetime

from app.noraops.services import repo_audit_scheduler as sched


def test_should_run_nightly_audit_respects_time(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.noraops.services.repo_audit_scheduler.get_settings",
        lambda: type(
            "S",
            (),
            {
                "noraops_repo_audit_enabled": True,
                "noraops_repo_audit_nightly": True,
                "noraops_repo_audit_hour": 23,
                "noraops_repo_audit_minute": 30,
            },
        )(),
    )
    sched._last_nightly_date = None
    assert sched.should_run_nightly_audit(datetime(2024, 6, 1, 23, 30, 0)) is True
    assert sched.should_run_nightly_audit(datetime(2024, 6, 1, 23, 31, 0)) is False
