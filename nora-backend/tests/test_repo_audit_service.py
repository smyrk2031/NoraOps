from datetime import datetime

from app.db.models import RepoAuditState
from app.noraops.services.repo_audit_service import (
    _needs_audit,
    parse_gitea_iso,
)


def test_parse_gitea_iso_z_suffix() -> None:
    dt = parse_gitea_iso("2024-06-01T12:30:00Z")
    assert dt == datetime(2024, 6, 1, 12, 30, 0)


def test_needs_audit_when_gitea_newer() -> None:
    state = RepoAuditState(
        owner="o",
        name="n",
        full_name="o/n",
        last_gitea_updated_at=datetime(2024, 1, 1),
        last_audit_at=datetime(2024, 1, 2),
    )
    assert _needs_audit(state, datetime(2024, 1, 3)) is True
    assert _needs_audit(state, datetime(2024, 1, 1)) is False


def test_needs_audit_when_never_audited() -> None:
    assert _needs_audit(None, datetime(2024, 1, 1)) is True
