"""Aggregate deps_audit telemetry for admin dashboard."""

from __future__ import annotations

import json
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import TelemetryEvent
from app.noraops.services.pyproject_resolve import parse_pyproject_summary, resolve_pyproject
from app.services.package_allowlist import allowlist_summary, classify_packages, normalize_pkg_name
from app.services.package_review_status import (
    REVIEW_STATUS_LABELS,
    REVIEW_STATUSES,
    get_package_review,
    list_review_records,
)


def audit_local_repo_pyproject(repo_root: str | Path) -> dict:
    """リポジトリ 1 件の pyproject 解決 + 依存概要（管理画面・バッチ走査用）。"""
    res = resolve_pyproject(repo_root)
    if not res.ok:
        return {
            "ok": False,
            "repoRoot": str(Path(repo_root).resolve()),
            "error": "pyproject_not_found",
        }
    summary = parse_pyproject_summary(res.pyproject_path)
    dep_rows = [{"name": name} for name in summary.get("dependencies") or []]
    classified = classify_packages(dep_rows)
    return {
        "ok": True,
        "repoRoot": str(res.app_root),
        "pyprojectRel": res.pyproject_rel,
        "source": res.source,
        "ambiguous": res.ambiguous,
        "alternateRels": list(res.alternate_rels),
        "requiresPython": summary.get("requiresPython"),
        "dependencies": summary.get("dependencies") or [],
        "unapprovedPackages": classified.get("unapproved") or [],
    }


def _installed_map(payload: dict) -> dict[str, str]:
    out: dict[str, str] = {}
    for row in payload.get("installed") or []:
        if not isinstance(row, dict):
            continue
        name = normalize_pkg_name(str(row.get("name") or ""))
        if name:
            out[name] = str(row.get("version") or "").strip()
    return out


def _aggregate_unapproved_from_events(rows: list[TelemetryEvent]) -> dict[str, dict]:
    stats: dict[str, dict] = defaultdict(
        lambda: {
            "auditCount": 0,
            "emails": set(),
            "versions": Counter(),
        }
    )
    for ev in rows:
        try:
            payload = json.loads(ev.payload_json or "{}")
        except json.JSONDecodeError:
            payload = {}
        email = str(payload.get("userEmail") or "").strip()
        installed = _installed_map(payload)
        unapproved = payload.get("unapproved") or []
        for raw_name in unapproved:
            name = normalize_pkg_name(str(raw_name or ""))
            if not name:
                continue
            entry = stats[name]
            entry["auditCount"] += 1
            if email:
                entry["emails"].add(email)
            ver = installed.get(name, "")
            if ver:
                entry["versions"][ver] += 1
    return stats


def build_review_queue(
    stats: dict[str, dict],
    *,
    status_filter: str | None = None,
    review_records: dict[str, dict] | None = None,
) -> list[dict]:
    review_records = review_records if review_records is not None else list_review_records()
    queue: list[dict] = []
    for name, entry in stats.items():
        review = review_records.get(name) or {}
        status = review.get("status") or "todo"
        if status_filter and status_filter != "all" and status != status_filter:
            continue
        versions = entry.get("versions") or Counter()
        version_rows = [
            {"version": ver, "count": cnt}
            for ver, cnt in versions.most_common(10)
            if ver
        ]
        queue.append(
            {
                "package": name,
                "auditCount": int(entry.get("auditCount") or 0),
                "emails": sorted(entry.get("emails") or []),
                "versions": version_rows,
                "reviewStatus": status,
                "reviewNote": review.get("note") or "",
                "reviewUpdatedAt": review.get("updatedAt"),
            }
        )
    queue.sort(key=lambda r: (-r["auditCount"], r["package"]))
    return queue


def build_packages_dashboard(
    db: Session,
    *,
    days: int = 30,
    limit: int = 40,
    status_filter: str | None = None,
) -> dict:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    rows = db.scalars(
        select(TelemetryEvent)
        .where(TelemetryEvent.event_type == "deps_audit")
        .where(TelemetryEvent.created_at >= since)
        .order_by(TelemetryEvent.id.desc())
        .limit(500)
    ).all()

    stats = _aggregate_unapproved_from_events(rows)
    review_records = list_review_records()
    review_queue = build_review_queue(stats, status_filter=status_filter, review_records=review_records)

    pkg_counter: Counter[str] = Counter()
    recent: list[dict] = []
    fallback_count = 0

    for ev in rows:
        try:
            payload = json.loads(ev.payload_json or "{}")
        except json.JSONDecodeError:
            payload = {}
        unapproved = payload.get("unapproved") or []
        for name in unapproved:
            pkg_counter[normalize_pkg_name(str(name).strip())] += 1
        if payload.get("usedFallback"):
            fallback_count += 1
        if len(recent) < limit:
            recent.append(
                {
                    "id": ev.id,
                    "at": ev.created_at.isoformat() if ev.created_at else "",
                    "appId": payload.get("appId") or "",
                    "workspace": (payload.get("workspace") or "")[:120],
                    "userEmail": payload.get("userEmail") or "",
                    "unapproved": unapproved,
                    "usedFallback": bool(payload.get("usedFallback")),
                    "declaredCount": len(payload.get("declared") or []),
                    "installedCount": len(payload.get("installed") or []),
                }
            )

    top_unapproved = []
    for item in review_queue[:25]:
        top_unapproved.append(
            {
                "package": item["package"],
                "count": item["auditCount"],
                "emails": item["emails"],
                "reviewStatus": item["reviewStatus"],
            }
        )

    return {
        "periodDays": days,
        "auditEventCount": len(rows),
        "fallbackEventCount": fallback_count,
        "allowlist": allowlist_summary(),
        "topUnapproved": top_unapproved,
        "reviewQueue": review_queue,
        "reviewStatuses": [
            {"id": s, "label": REVIEW_STATUS_LABELS[s]} for s in REVIEW_STATUSES
        ],
        "statusFilter": status_filter or "all",
        "recentAudits": recent,
    }
