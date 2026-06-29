"""Gitea repository policy audit — Node checkRunner via repo-audit-cli."""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.db.models import RepoAuditState
from app.db.session import get_session
from app.noraops.services.repo_audit_runner import RepoAuditRunnerError, run_repo_audit
from app.noraops.services.zip_utils import safe_extract_zip
from app.services.admin_config_service import AdminConfigService, RuntimeIntegrationConfig
from app.services.gitea_client import GiteaClient, GiteaClientError

logger = logging.getLogger(__name__)


def parse_gitea_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    s = value.strip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is not None:
            return dt.astimezone(timezone.utc).replace(tzinfo=None)
        return dt
    except ValueError:
        return None


def _full_name(owner: str, name: str) -> str:
    return f"{owner}/{name}"


def _get_state(db: Session, owner: str, name: str) -> RepoAuditState | None:
    fn = _full_name(owner, name)
    return db.scalar(select(RepoAuditState).where(RepoAuditState.full_name == fn))


def _persist_audit(
    db: Session,
    owner: str,
    name: str,
    payload: dict[str, Any],
    *,
    trigger: str,
    gitea_updated_at: datetime | None,
) -> RepoAuditState:
    fn = _full_name(owner, name)
    row = _get_state(db, owner, name)
    if row is None:
        row = RepoAuditState(owner=owner, name=name, full_name=fn)
        db.add(row)

    readme = payload.get("readme") or {}
    py = payload.get("pyproject") or {}
    summary = payload.get("summary") or {}

    row.last_gitea_updated_at = gitea_updated_at or row.last_gitea_updated_at
    row.last_audit_at = datetime.utcnow()
    row.last_audit_trigger = trigger
    row.readme_path = str(readme.get("path") or "")
    row.readme_excerpt = str(readme.get("excerpt") or "")[:4000]
    row.pyproject_rel = str(py.get("rel") or "")
    row.policy_ok = bool(summary.get("ok"))
    row.error_count = int(summary.get("secErrorCount") or 0) + int(summary.get("polErrorCount") or 0)
    row.warn_count = int(summary.get("secWarnCount") or 0) + int(summary.get("warnCount") or 0)
    row.result_json = json.dumps(payload, ensure_ascii=False)
    row.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    return row


def audit_workspace_persist(
    db: Session,
    settings: Settings,
    owner: str,
    name: str,
    workspace: Path,
    *,
    trigger: str,
    gitea_updated_at: datetime | None = None,
) -> dict[str, Any]:
    if not settings.noraops_repo_audit_enabled:
        return {"skipped": True, "reason": "disabled"}

    try:
        payload = run_repo_audit(workspace, settings)
    except RepoAuditRunnerError as e:
        logger.warning("Repo audit failed for %s/%s: %s", owner, name, e)
        return {"ok": False, "error": str(e), "owner": owner, "name": name}

    row = _persist_audit(db, owner, name, payload, trigger=trigger, gitea_updated_at=gitea_updated_at)
    summary = payload.get("summary") or {}
    return {
        "ok": True,
        "owner": owner,
        "name": name,
        "full_name": row.full_name,
        "trigger": trigger,
        "policy_ok": row.policy_ok,
        "error_count": row.error_count,
        "warn_count": row.warn_count,
        "readme_path": row.readme_path,
        "pyproject_rel": row.pyproject_rel,
        "summary": summary,
    }


def audit_zip_and_persist(
    settings: Settings,
    owner: str,
    name: str,
    zip_data: bytes,
    *,
    trigger: str,
    gitea_updated_at: datetime | None = None,
) -> dict[str, Any]:
    """Extract zip and audit (creates its own DB session — safe from worker threads)."""
    if not settings.noraops_repo_audit_enabled:
        return {"skipped": True, "reason": "disabled"}
    if not zip_data:
        return {"skipped": True, "reason": "empty_zip"}

    import tempfile

    db = next(get_session())
    try:
        with tempfile.TemporaryDirectory(prefix="noraops-audit-") as tmp:
            work = Path(tmp) / "ws"
            safe_extract_zip(zip_data, work, max_bytes=settings.save_max_zip_bytes)
            return audit_workspace_persist(
                db,
                settings,
                owner,
                name,
                work,
                trigger=trigger,
                gitea_updated_at=gitea_updated_at,
            )
    finally:
        db.close()


def _repo_updated_today(updated_at: datetime | None, *, day: date | None = None) -> bool:
    if updated_at is None:
        return False
    ref = day or date.today()
    return updated_at.date() >= ref


def _needs_audit(state: RepoAuditState | None, gitea_updated_at: datetime | None) -> bool:
    if gitea_updated_at is None:
        return state is None or state.last_audit_at is None
    if state is None or state.last_audit_at is None:
        return True
    if state.last_gitea_updated_at is None:
        return True
    return gitea_updated_at > state.last_gitea_updated_at


async def audit_repo_from_gitea(
    db: Session,
    cfg: RuntimeIntegrationConfig,
    settings: Settings,
    owner: str,
    name: str,
    *,
    trigger: str,
    force: bool = False,
) -> dict[str, Any]:
    if not settings.noraops_repo_audit_enabled:
        return {"skipped": True, "reason": "disabled"}

    client = GiteaClient(cfg)
    repo = await client.get_repo(owner, name)
    if not repo:
        return {"ok": False, "error": "repo_not_found", "owner": owner, "name": name}

    gitea_updated_at = parse_gitea_iso(repo.get("updated_at"))
    state = _get_state(db, owner, name)
    if not force and not _needs_audit(state, gitea_updated_at):
        return {
            "skipped": True,
            "reason": "unchanged",
            "owner": owner,
            "name": name,
            "last_gitea_updated_at": gitea_updated_at.isoformat() if gitea_updated_at else None,
        }

    try:
        zip_data = await client.download_repo_archive(owner, name)
    except GiteaClientError as e:
        return {"ok": False, "error": str(e), "owner": owner, "name": name}

    import tempfile

    with tempfile.TemporaryDirectory(prefix="noraops-audit-") as tmp:
        work = Path(tmp) / "ws"
        await asyncio.to_thread(
            safe_extract_zip,
            zip_data,
            work,
            max_bytes=settings.save_max_zip_bytes,
        )
        return await asyncio.to_thread(
            audit_workspace_persist,
            db,
            settings,
            owner,
            name,
            work,
            trigger=trigger,
            gitea_updated_at=gitea_updated_at,
        )


async def run_delta_audit(
    db: Session,
    cfg: RuntimeIntegrationConfig,
    settings: Settings,
    *,
    trigger: str = "nightly",
    only_today: bool = True,
    limit: int | None = None,
) -> dict[str, Any]:
    client = GiteaClient(cfg)
    repos = await client.list_org_repos()
    today = date.today()
    audited = 0
    skipped = 0
    failed = 0
    items: list[dict[str, Any]] = []

    for repo in repos:
        if limit is not None and audited + failed >= limit:
            break
        owner_obj = repo.get("owner") or {}
        owner = str(owner_obj.get("login") or repo.get("owner") or "").strip()
        name = str(repo.get("name") or "").strip()
        if not owner or not name:
            continue

        updated_at = parse_gitea_iso(repo.get("updated_at"))
        if only_today and not _repo_updated_today(updated_at, day=today):
            continue

        result = await audit_repo_from_gitea(
            db,
            cfg,
            settings,
            owner,
            name,
            trigger=trigger,
            force=False,
        )
        if result.get("skipped"):
            skipped += 1
        elif result.get("ok"):
            audited += 1
            items.append(result)
        else:
            failed += 1
            items.append(result)

    return {
        "ok": True,
        "trigger": trigger,
        "only_today": only_today,
        "total_repos": len(repos),
        "audited": audited,
        "skipped": skipped,
        "failed": failed,
        "items": items[:50],
    }


def build_repo_audit_dashboard(db: Session) -> dict[str, Any]:
    total = db.scalar(select(func.count()).select_from(RepoAuditState)) or 0
    failing = db.scalar(
        select(func.count()).select_from(RepoAuditState).where(RepoAuditState.policy_ok.is_(False))
    ) or 0
    rows = db.scalars(
        select(RepoAuditState).order_by(RepoAuditState.updated_at.desc()).limit(100)
    ).all()
    return {
        "total": total,
        "failing": failing,
        "passing": max(0, total - failing),
        "items": [
            {
                "full_name": r.full_name,
                "owner": r.owner,
                "name": r.name,
                "policy_ok": r.policy_ok,
                "error_count": r.error_count,
                "warn_count": r.warn_count,
                "readme_path": r.readme_path,
                "pyproject_rel": r.pyproject_rel,
                "last_audit_at": r.last_audit_at.isoformat() if r.last_audit_at else None,
                "last_audit_trigger": r.last_audit_trigger,
                "last_gitea_updated_at": r.last_gitea_updated_at.isoformat()
                if r.last_gitea_updated_at
                else None,
            }
            for r in rows
        ],
    }


def run_nightly_delta_sync() -> None:
    settings = get_settings()
    if not settings.noraops_repo_audit_enabled or not settings.noraops_repo_audit_nightly:
        return
    db = next(get_session())
    try:
        logger.info("Starting nightly repo audit delta batch")
        cfg = AdminConfigService(db).resolve_runtime_config(settings)
        result = asyncio.run(
            run_delta_audit(db, cfg, settings, trigger="nightly", only_today=True)
        )
        logger.info(
            "Nightly repo audit done: audited=%s skipped=%s failed=%s",
            result.get("audited"),
            result.get("skipped"),
            result.get("failed"),
        )
    except Exception:
        logger.exception("Nightly repo audit batch failed")
    finally:
        db.close()
