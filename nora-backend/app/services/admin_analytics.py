"""管理者ダッシュボード用の集計。"""

from __future__ import annotations

import json
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db.models import ApiAccessLog, DownloadLog, RunnerActivityLog, TelemetryEvent
from app.noraops.services.ai_gateway import list_usage_summary
from app.services.admin_config_service import AdminConfigService


def _day_key(dt: datetime | None) -> str:
    if not dt:
        return ""
    return dt.strftime("%Y-%m-%d")


def aggregate_downloads(db: Session, days: int = 30) -> dict[str, Any]:
    since = datetime.utcnow() - timedelta(days=days)
    rows = db.scalars(
        select(DownloadLog).where(DownloadLog.created_at >= since).order_by(DownloadLog.created_at.desc())
    ).all()
    by_day: dict[str, int] = defaultdict(int)
    by_tool: Counter[str] = Counter()
    ok = 0
    for r in rows:
        by_day[_day_key(r.created_at)] += 1
        by_tool[r.tool_name or "unknown"] += 1
        if r.status == "ok":
            ok += 1
    return {
        "total": len(rows),
        "ok": ok,
        "byDay": [{"date": d, "count": c} for d, c in sorted(by_day.items())],
        "byTool": [{"tool": k, "count": v} for k, v in by_tool.most_common(12)],
    }


def aggregate_telemetry(db: Session, days: int = 30) -> dict[str, Any]:
    since = datetime.utcnow() - timedelta(days=days)
    rows = db.scalars(
        select(TelemetryEvent).where(TelemetryEvent.created_at >= since).order_by(TelemetryEvent.created_at.desc())
    ).all()
    by_type: Counter[str] = Counter()
    by_day: dict[str, int] = defaultdict(int)
    users: Counter[str] = Counter()
    for r in rows:
        by_type[r.event_type] += 1
        by_day[_day_key(r.created_at)] += 1
        try:
            payload = json.loads(r.payload_json or "{}")
        except json.JSONDecodeError:
            payload = {}
        u = payload.get("user") or payload.get("userLabel") or r.source
        users[str(u)] += 1
    return {
        "total": len(rows),
        "byType": [{"type": k, "count": v} for k, v in by_type.most_common(20)],
        "byDay": [{"date": d, "count": c} for d, c in sorted(by_day.items())],
        "topUsers": [{"user": k, "count": v} for k, v in users.most_common(15)],
    }


def aggregate_runner(db: Session, days: int = 30) -> dict[str, Any]:
    since = datetime.utcnow() - timedelta(days=days)
    rows = db.scalars(
        select(RunnerActivityLog)
        .where(RunnerActivityLog.created_at >= since)
        .order_by(RunnerActivityLog.created_at.desc())
    ).all()
    by_app: Counter[str] = Counter()
    by_day: dict[str, int] = defaultdict(int)
    by_user: Counter[str] = Counter()
    for r in rows:
        by_app[r.app_full_name] += 1
        by_day[_day_key(r.created_at)] += 1
        by_user[r.user_label or "anonymous"] += 1
    return {
        "total": len(rows),
        "byApp": [{"app": k, "count": v} for k, v in by_app.most_common(20)],
        "byDay": [{"date": d, "count": c} for d, c in sorted(by_day.items())],
        "byUser": [{"user": k, "count": v} for k, v in by_user.most_common(15)],
        "recent": [
            {
                "app": r.app_full_name,
                "user": r.user_label,
                "action": r.action,
                "at": r.created_at.isoformat() if r.created_at else "",
            }
            for r in rows[:25]
        ],
    }


def aggregate_api_traffic(db: Session, days: int = 7) -> dict[str, Any]:
    since = datetime.utcnow() - timedelta(days=days)
    rows = db.scalars(
        select(ApiAccessLog).where(ApiAccessLog.created_at >= since).order_by(ApiAccessLog.created_at.desc())
    ).all()
    by_path: Counter[str] = Counter()
    errors = 0
    for r in rows:
        by_path[r.path] += 1
        if r.status_code >= 400:
            errors += 1
    return {
        "total": len(rows),
        "errors": errors,
        "topPaths": [{"path": k, "count": v} for k, v in by_path.most_common(15)],
    }


def build_admin_dashboard(db: Session, settings: Settings) -> dict[str, Any]:
    ai = list_usage_summary(settings, days=30)
    cms = AdminConfigService(db)
    return {
        "downloads": aggregate_downloads(db),
        "telemetry": aggregate_telemetry(db),
        "runner": aggregate_runner(db),
        "apiTraffic": aggregate_api_traffic(db),
        "aiUsage": ai,
        "aiStatus": {
            "enabled": settings.noraops_ai_enabled,
            "configured": bool(settings.azure_openai_endpoint and settings.azure_openai_api_key),
        },
        "cms": {
            "rulesApi": "/api/v1/checks/rules",
            "securityFile": "data/noraops/checks/security.rules.json",
        },
    }


async def search_similar_repos(
    db: Session,
    settings: Settings,
    query: str,
    *,
    limit: int = 10,
    owner_login: str | None = None,
    gitea_client: Any | None = None,
) -> list[dict[str, Any]]:
    """既存 Gitea リポとの簡易レコメンド（名前・説明の部分一致）。"""
    from app.services.analyzer import RepoAnalyzer
    from app.services.gitea_client import GiteaClient

    q = (query or "").strip().lower()
    if len(q) < 2:
        return []
    cfg = AdminConfigService(db).resolve_runtime_config(settings)
    if not cfg.gitea_base_url:
        return []

    try:
        client = gitea_client or GiteaClient(cfg)
        repos = await client.list_org_repos()
    except Exception:
        return []

    login = (owner_login or "").strip().lower()
    if login:
        prefix = f"{login}/"
        repos = [
            r
            for r in repos
            if str(r.get("full_name") or "").lower().startswith(prefix)
        ]

    analyzer = RepoAnalyzer()
    apps = analyzer.app_catalog(repos)
    scored: list[tuple[float, dict[str, Any]]] = []
    for app in apps:
        if hasattr(app, "model_dump"):
            row = app.model_dump()
        elif isinstance(app, dict):
            row = app
        else:
            row = {
                "full_name": getattr(app, "full_name", ""),
                "description": getattr(app, "readme_hint", None) or "",
                "stars": getattr(app, "stars", 0),
            }
        name = str(row.get("full_name") or "").lower()
        desc = str(row.get("description") or row.get("readme_hint") or "").lower()
        score = 0.0
        if q in name:
            score += 3.0
        if q in desc:
            score += 1.5
        for token in q.split():
            if len(token) >= 2 and token in name:
                score += 1.0
            if len(token) >= 2 and token in desc:
                score += 0.5
        if score > 0:
            scored.append(
                (
                    score,
                    {
                        "full_name": row.get("full_name") or "",
                        "description": row.get("description") or row.get("readme_hint") or "",
                        "stars": row.get("stars", 0),
                    },
                )
            )
    scored.sort(key=lambda x: -x[0])
    return [a for _, a in scored[:limit]]
