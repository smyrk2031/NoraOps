"""NoraOps サーバーストレージ · Gitea 容量 — 管理者システムダッシュボード。"""

from __future__ import annotations

import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.noraops.services.ai_runtime_settings import resolve_ai_runtime
from app.services.admin_analytics import build_admin_dashboard
from app.services.admin_config_service import AdminConfigService
from app.services.data_bootstrap import resolve_data_root
from app.services.gitea_client import GiteaClient, GiteaClientError


def format_bytes(n: int) -> str:
    n = max(0, int(n))
    if n < 1024:
        return f"{n} B"
    if n < 1024**2:
        return f"{n / 1024:.1f} KB"
    if n < 1024**3:
        return f"{n / 1024**2:.1f} MB"
    return f"{n / 1024**3:.2f} GB"


def _dir_size(path: Path, *, max_files: int = 100_000) -> tuple[int, int]:
    total = 0
    count = 0
    if not path.exists():
        return 0, 0
    if path.is_file():
        try:
            return path.stat().st_size, 1
        except OSError:
            return 0, 0
    try:
        for root, _dirs, files in path.walk():
            for name in files:
                if count >= max_files:
                    return total, count
                fp = root / name
                if fp.is_symlink():
                    continue
                try:
                    total += fp.stat().st_size
                    count += 1
                except OSError:
                    continue
    except AttributeError:
        for fp in path.rglob("*"):
            if count >= max_files:
                break
            if fp.is_symlink():
                continue
            try:
                if fp.is_file():
                    total += fp.stat().st_size
                    count += 1
            except OSError:
                continue
    return total, count


def _file_size(path: Path) -> int:
    try:
        return path.stat().st_size if path.is_file() else 0
    except OSError:
        return 0


def _scan_artifacts(artifacts_dir: Path) -> tuple[int, list[dict[str, Any]]]:
    rows: list[dict[str, Any]] = []
    total = 0
    if not artifacts_dir.is_dir():
        return 0, rows
    for owner_dir in sorted(artifacts_dir.iterdir()):
        if not owner_dir.is_dir() or owner_dir.name.startswith("."):
            continue
        for repo_dir in sorted(owner_dir.iterdir()):
            if not repo_dir.is_dir():
                continue
            sz, fc = _dir_size(repo_dir, max_files=20_000)
            total += sz
            rows.append(
                {
                    "owner": owner_dir.name,
                    "name": repo_dir.name,
                    "full_name": f"{owner_dir.name}/{repo_dir.name}",
                    "bytes": sz,
                    "size_human": format_bytes(sz),
                    "file_count": fc,
                }
            )
    rows.sort(key=lambda r: r["bytes"], reverse=True)
    return total, rows


def _scan_data_categories(data_root: Path, settings: Settings) -> list[dict[str, Any]]:
    cats: list[dict[str, Any]] = []
    noraops = data_root / "noraops"
    tools = data_root / "tools"

    if noraops.is_dir():
        for name, label in (
            ("artifacts", "Runner 成果物 (artifacts)"),
            ("checks", "チェックルール JSON"),
            ("mcp", "MCP 定義"),
            ("prompts", "プロンプト"),
            ("concierge", "コンシェルジュ"),
        ):
            p = noraops / name
            if p.exists():
                sz, fc = _dir_size(p, max_files=30_000)
                cats.append(
                    {
                        "id": f"noraops/{name}",
                        "label": label,
                        "path": str(p),
                        "bytes": sz,
                        "size_human": format_bytes(sz),
                        "file_count": fc,
                    }
                )
        ai_usage = noraops / "ai-usage.json"
        if ai_usage.is_file():
            sz = _file_size(ai_usage)
            cats.append(
                {
                    "id": "noraops/ai-usage",
                    "label": "AI 利用量ログ",
                    "path": str(ai_usage),
                    "bytes": sz,
                    "size_human": format_bytes(sz),
                    "file_count": 1,
                }
            )

    if tools.is_dir():
        for child in sorted(tools.iterdir()):
            if not child.is_dir():
                continue
            sz, fc = _dir_size(child, max_files=50_000)
            cats.append(
                {
                    "id": f"tools/{child.name}",
                    "label": f"共有ツール ({child.name})",
                    "path": str(child),
                    "bytes": sz,
                    "size_human": format_bytes(sz),
                    "file_count": fc,
                }
            )

    db_path = settings.sqlite_abs_path
    if db_path.is_file():
        sz = _file_size(db_path)
        cats.append(
            {
                "id": "database/sqlite",
                "label": "SQLite DB (ログ・設定)",
                "path": str(db_path),
                "bytes": sz,
                "size_human": format_bytes(sz),
                "file_count": 1,
            }
        )

    cats.sort(key=lambda c: c["bytes"], reverse=True)
    return cats


def _largest_under(root: Path, *, limit: int = 12) -> list[dict[str, Any]]:
    found: list[tuple[int, Path]] = []
    if not root.is_dir():
        return []
    for fp in root.rglob("*"):
        if fp.is_symlink() or not fp.is_file():
            continue
        try:
            found.append((fp.stat().st_size, fp))
        except OSError:
            continue
        if len(found) > limit * 8:
            found.sort(key=lambda x: x[0], reverse=True)
            found = found[: limit * 2]
    found.sort(key=lambda x: x[0], reverse=True)
    out = []
    for sz, fp in found[:limit]:
        try:
            rel = fp.relative_to(root)
        except ValueError:
            rel = fp.name
        out.append({"path": str(rel).replace("\\", "/"), "bytes": sz, "size_human": format_bytes(sz)})
    return out


def _host_disk(path: Path) -> dict[str, Any]:
    try:
        usage = shutil.disk_usage(path)
        used_pct = round(usage.used / usage.total * 100, 1) if usage.total else 0
        return {
            "path": str(path),
            "total_bytes": usage.total,
            "used_bytes": usage.used,
            "free_bytes": usage.free,
            "used_pct": used_pct,
            "total_human": format_bytes(usage.total),
            "used_human": format_bytes(usage.used),
            "free_human": format_bytes(usage.free),
        }
    except OSError as e:
        return {"path": str(path), "error": str(e)}


def _build_warnings(report: dict[str, Any]) -> list[dict[str, str]]:
    warnings: list[dict[str, str]] = []
    host = report.get("host") or {}
    if host.get("used_pct", 0) >= 90:
        warnings.append(
            {"level": "error", "message": f"ディスク使用率 {host['used_pct']}% — 空き {host.get('free_human', '?')}"}
        )
    elif host.get("used_pct", 0) >= 80:
        warnings.append(
            {"level": "warn", "message": f"ディスク使用率 {host['used_pct']}% — そろそろ容量確認を"}
        )
    gitea = report.get("gitea") or {}
    if not gitea.get("configured"):
        warnings.append({"level": "warn", "message": "Gitea 未設定 — リポジトリ容量は取得できません"})
    elif gitea.get("error"):
        warnings.append({"level": "error", "message": f"Gitea 接続エラー: {gitea['error']}"})
    if (report.get("totals") or {}).get("artifacts_bytes", 0) > 5 * 1024**3:
        warnings.append({"level": "warn", "message": "Runner 成果物 (artifacts) が 5 GB を超えています"})
    db_b = (report.get("totals") or {}).get("database_bytes", 0)
    if db_b > 500 * 1024**2:
        warnings.append({"level": "warn", "message": f"SQLite が {format_bytes(db_b)} — ログローテーションを検討"})
    return warnings


async def _fetch_gitea_stats(db: Session, settings: Settings) -> dict[str, Any]:
    cfg = AdminConfigService(db).resolve_runtime_config(settings)
    base = (cfg.gitea_base_url or "").strip()
    if not base:
        return {"configured": False, "base_url": "", "repos": [], "repo_count": 0}
    client = GiteaClient(cfg)
    try:
        raw = await client.list_org_repos()
    except GiteaClientError as e:
        return {
            "configured": True,
            "base_url": base,
            "error": str(e),
            "hint": getattr(e, "hint", None),
            "repos": [],
            "repo_count": 0,
        }
    repos: list[dict[str, Any]] = []
    total_kb = 0
    published = 0
    for r in raw:
        topics = r.get("topics") or []
        if isinstance(topics, str):
            topics = [topics]
        size_kb = int(r.get("size") or 0)
        total_kb += size_kb
        is_pub = "nora-published" in topics
        if is_pub:
            published += 1
        owner_obj = r.get("owner") or {}
        owner_login = owner_obj.get("login") if isinstance(owner_obj, dict) else str(owner_obj or "")
        full = r.get("full_name") or (f"{owner_login}/{r.get('name', '?')}" if owner_login else str(r.get("name", "?")))
        repos.append(
            {
                "full_name": full,
                "size_kb": size_kb,
                "size_bytes": size_kb * 1024,
                "size_human": format_bytes(size_kb * 1024),
                "stars": int(r.get("stars_count") or 0),
                "updated_at": (r.get("updated_at") or "")[:10],
                "topics": topics,
                "nora_published": is_pub,
                "private": bool(r.get("private")),
            }
        )
    repos.sort(key=lambda x: x["size_kb"], reverse=True)
    return {
        "configured": True,
        "base_url": base,
        "list_mode": cfg.gitea_list_mode,
        "repo_count": len(repos),
        "published_count": published,
        "total_size_kb": total_kb,
        "total_size_bytes": total_kb * 1024,
        "total_size_human": format_bytes(total_kb * 1024),
        "repos": repos,
        "top_repos": repos[:15],
    }


def scan_local_storage(settings: Settings) -> dict[str, Any]:
    data_root = resolve_data_root(settings)
    artifacts_dir = settings.artifacts_abs_dir
    artifacts_bytes, artifact_rows = _scan_artifacts(artifacts_dir)
    categories = _scan_data_categories(data_root, settings)
    data_total, _ = _dir_size(data_root, max_files=200_000)
    db_bytes = _file_size(settings.sqlite_abs_path)
    host = _host_disk(data_root)
    largest = _largest_under(data_root, limit=12)
    return {
        "data_root": str(data_root),
        "artifacts_dir": str(artifacts_dir),
        "host": host,
        "totals": {
            "data_bytes": data_total,
            "data_human": format_bytes(data_total),
            "artifacts_bytes": artifacts_bytes,
            "artifacts_human": format_bytes(artifacts_bytes),
            "database_bytes": db_bytes,
            "database_human": format_bytes(db_bytes),
            "category_count": len(categories),
            "artifact_repo_count": len(artifact_rows),
        },
        "categories": categories,
        "artifacts": artifact_rows[:25],
        "largest_files": largest,
    }


async def build_system_dashboard(db: Session, settings: Settings) -> dict[str, Any]:
    local = scan_local_storage(settings)
    gitea = await _fetch_gitea_stats(db, settings)
    runtime = resolve_ai_runtime(settings, db)
    from app.noraops.services.ai_gateway import build_status

    ai_status = build_status(settings, runtime)
    usage_summary = build_admin_dashboard(db, settings)
    report: dict[str, Any] = {
        "schema": "nora.system-dashboard/1",
        "scanned_at": datetime.now(timezone.utc).isoformat(),
        **local,
        "gitea": gitea,
        "quick_stats": {
            "downloads_30d": usage_summary.get("downloads", {}).get("total", 0),
            "runner_total": usage_summary.get("runner", {}).get("total", 0),
            "api_7d": usage_summary.get("apiTraffic", {}).get("total", 0),
            "ai_enabled": ai_status.get("enabled"),
            "ai_tokens_today": (ai_status.get("usageToday") or {}).get("tokens_in", 0)
            + (ai_status.get("usageToday") or {}).get("tokens_out", 0),
        },
    }
    report["warnings"] = _build_warnings(report)
    return report
