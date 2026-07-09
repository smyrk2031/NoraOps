"""NoraOps 連携モードのスナップショット（秘密情報なし）。"""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.root_path import configured_root_path, public_base_url, resolve_request_root_path
from app.noraops.routers.packages import pypi_runtime_fields
from app.services.admin_config_service import AdminConfigService
from app.services.gitea_token_check import classify_gitea_token
from app.services.topology_hints import action_items, build_topology_hints


def _flag(on: bool) -> str:
    return "on" if on else "off"


def build_topology_snapshot(
    db: Session,
    settings: Settings,
    request=None,
) -> dict[str, Any]:
    cfg = AdminConfigService(db).resolve_runtime_config(settings)
    pypi = pypi_runtime_fields(settings, request)
    gitea_url = (cfg.gitea_base_url or settings.gitea_base_url or "").rstrip("/")
    gitea_token_ok = bool(cfg.gitea_token)
    token_info = classify_gitea_token(cfg.gitea_token) if gitea_token_ok else {}
    pypi_index = (pypi.get("pypiIndexUrl") or "").strip()
    pypi_on = bool(pypi_index)
    allow_count = int(pypi.get("packageAllowlistCount") or 0)
    ai_on = bool(settings.noraops_ai_enabled)
    ai_configured = bool(
        settings.azure_openai_endpoint.strip() and settings.azure_openai_api_key.strip()
    )
    root = resolve_request_root_path(request, settings) if request else configured_root_path(settings)
    auth = (settings.noraops_auth_mode or "open").strip().lower()

    gitea_ready = bool(gitea_url and gitea_token_ok and not token_info.get("issue"))

    features = {
        "clientOnly": {
            "xllm": True,
            "localSecurityCheck": True,
            "localUv": True,
            "mockDevScaffold": True,
            "offlineWorkspace": True,
        },
        "serverRequired": {
            "giteaSave": gitea_ready,
            "runnerCatalog": gitea_ready,
            "pushSession": gitea_ready,
            "serverRulesSync": True,
            "vsixUpdate": bool(settings.client_download_url),
            "toolsManifest": bool(settings.tools_manifest_path),
        },
        "optional": {
            "pypiAllowlist": pypi_on and allow_count > 0,
            "pypiMirrorOnly": pypi_on,
            "aiGateway": ai_on and ai_configured,
            "repoAudit": bool(settings.noraops_repo_audit_enabled),
            "emailRegistration": auth == "email_token",
            "windowsTrust": auth == "windows_trust",
            "adminManualProvision": bool(settings.noraops_admin_manual_provision),
        },
    }

    snapshot = {
        "generatedAt": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
        "deployment": {
            "env": settings.env,
            "rootPath": root or "/",
            "publicBaseUrl": public_base_url(request, settings) if request else (settings.noraops_public_base_url or ""),
            "dbBackend": settings.db_backend,
        },
        "auth": {
            "mode": auth,
            "label": _auth_label(auth),
            "giteaAutoProvision": bool(settings.noraops_gitea_auto_provision),
            "requireEmailActivation": bool(settings.noraops_require_email_activation),
            "adminManualProvision": bool(settings.noraops_admin_manual_provision),
        },
        "gitea": {
            "status": _flag(gitea_ready),
            "baseUrl": gitea_url,
            "tokenConfigured": gitea_token_ok,
            "tokenFormat": token_info.get("format") or "",
            "tokenIssue": token_info.get("issue") or "",
            "listMode": settings.gitea_list_mode,
            "orgs": cfg.gitea_orgs or settings.gitea_orgs,
            "exposeTokenToClient": bool(settings.expose_gitea_token_to_client),
            "publishedTopic": settings.noraops_published_topic,
            "catalogDevShowAll": bool(settings.noraops_catalog_dev_show_all),
        },
        "pypi": {
            "status": _flag(pypi_on),
            "indexUrl": pypi_index,
            "fallbackEnabled": bool(pypi.get("pypiFallbackEnabled")),
            "allowlistCount": allow_count,
            "allowlistEtag": (pypi.get("packageAllowlistEtag") or "")[:16],
        },
        "ai": {
            "status": _flag(ai_on and ai_configured),
            "enabled": ai_on,
            "configured": ai_configured,
            "copilot": bool(settings.noraops_copilot_enabled),
            "continue": bool(settings.noraops_continue_enabled),
        },
        "checks": {
            "repoAuditEnabled": bool(settings.noraops_repo_audit_enabled),
            "repoAuditOnSave": bool(settings.noraops_repo_audit_on_save),
        },
        "backup": {
            "enabled": bool(settings.noraops_backup_enabled),
        },
        "features": features,
        "clientModes": _client_mode_summary(gitea_ready, pypi_on, auth, ai_on and ai_configured),
    }
    snapshot["hints"] = build_topology_hints(snapshot, settings)
    snapshot["actionItems"] = action_items(snapshot["hints"])
    return snapshot


def _auth_label(mode: str) -> str:
    return {
        "open": "open（開発・誰でも push セッション）",
        "email_token": "email_token（本番推奨・メール登録）",
        "windows_trust": "windows_trust（IIS ヘッダ信頼）",
        "email_otp": "email_otp（レガシー OTP）",
    }.get(mode, mode)


def _client_mode_summary(gitea_ready: bool, pypi_on: bool, auth: str, ai_on: bool) -> list[dict[str, str]]:
    modes = [
        {
            "id": "standalone",
            "label": "拡張のみ（サーバー未接続）",
            "active": not gitea_ready,
            "desc": "xLLM・ローカルチェック・uv・モック/開発。Gitea 保存なし",
        },
        {
            "id": "server_min",
            "label": "サーバー接続（最小）",
            "active": gitea_ready and not pypi_on and auth == "open",
            "desc": "保存・Runner・ルール同期。PyPI は公開直",
        },
        {
            "id": "enterprise",
            "label": "本番構成",
            "active": gitea_ready and auth == "email_token",
            "desc": "email_token + Gitea プロビジョン + 保存/Runner",
        },
        {
            "id": "pypi_mirror",
            "label": "PyPI ミラー連携",
            "active": pypi_on,
            "desc": "社内 index + 許可リスト（拡張 uv が index を参照）",
        },
    ]
    if ai_on:
        modes.append(
            {
                "id": "ai_gateway",
                "label": "AI 踏み台",
                "active": True,
                "desc": "Copilot BYOK / 組織ゲートウェイ経由",
            }
        )
    return modes
