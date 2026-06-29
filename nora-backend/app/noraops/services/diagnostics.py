"""NoraOps smoke diagnostics (GUI / API — not pytest)."""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.noraops.auth.store import PushSessionStore
from app.services.admin_config_service import AdminConfigService
from app.services.gitea_client import GiteaClient
from app.services.gitea_token_check import classify_gitea_token


def _check(id_: str, name: str, ok: bool, detail: str = "", hint: str = "") -> dict[str, Any]:
    return {"id": id_, "name": name, "ok": ok, "detail": detail, "hint": hint}


async def run_server_diagnostics(db: Session, settings: Settings) -> dict[str, Any]:
    checks: list[dict[str, Any]] = []

    checks.append(
        _check("config_gitea_url", "GITEA_BASE_URL", bool(settings.gitea_base_url), settings.gitea_base_url or "未設定")
    )
    checks.append(
        _check(
            "config_gitea_token",
            "GITEA_TOKEN",
            bool(settings.gitea_token),
            "設定あり" if settings.gitea_token else "未設定",
        )
    )

    git = shutil.which("git") or ""
    checks.append(
        _check("server_git", "サーバー git", bool(git), git or "PATH に git がありません")
    )

    art_dir = settings.artifacts_abs_dir
    try:
        art_dir.mkdir(parents=True, exist_ok=True)
        probe = art_dir / ".diag_probe"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink()
        art_ok = True
        art_detail = str(art_dir)
    except OSError as e:
        art_ok = False
        art_detail = str(e)
    checks.append(_check("artifacts_dir", "artifact キャッシュ", art_ok, art_detail))

    cfg = AdminConfigService(db).resolve_runtime_config(settings)
    token_info = classify_gitea_token(cfg.gitea_token)
    checks.append(
        _check(
            "gitea_token_format",
            "トークン形式",
            token_info.get("format") != "invalid",
            str(token_info.get("hint") or token_info.get("format") or ""),
        )
    )

    if cfg.gitea_base_url and cfg.gitea_token:
        client = GiteaClient(cfg)
        user = await client.get_current_user()
        checks.append(
            _check(
                "gitea_user",
                "Gitea ユーザー API",
                bool(user),
                (user or {}).get("login", "") if user else "接続失敗",
            )
        )
        probe = await client.probe_create_permission()
        checks.append(
            _check(
                "gitea_create_repo",
                "リポ作成権限",
                bool(probe.get("ok")),
                str(probe.get("reason") or "OK"),
                str(probe.get("hint") or ""),
            )
        )
    else:
        checks.append(_check("gitea_user", "Gitea ユーザー API", False, "URL/TOKEN 未設定"))
        checks.append(_check("gitea_create_repo", "リポ作成権限", False, "スキップ"))

    store = PushSessionStore(ttl_minutes=settings.noraops_push_session_ttl_minutes)
    write_sess = store.create_push_session(subject="diagnostics", scope="write")
    read_sess = store.create_push_session(subject="diagnostics", scope="read")
    checks.append(
        _check(
            "push_session_write",
            "保存用セッション",
            bool(write_sess.token),
            f"TTL {settings.noraops_push_session_ttl_minutes} 分",
        )
    )
    checks.append(
        _check(
            "push_session_read",
            "Runner 用セッション",
            bool(read_sess.token),
            "artifact ダウンロード用",
        )
    )

    tools_path = settings.tools_manifest_abs_path
    checks.append(
        _check(
            "tools_manifest",
            "uv manifest ファイル",
            tools_path.is_file(),
            str(tools_path),
        )
    )

    passed = sum(1 for c in checks if c["ok"])
    return {
        "ok": passed == len(checks),
        "passed": passed,
        "total": len(checks),
        "checks": checks,
        "component": "nora-backend",
    }
