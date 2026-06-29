"""AI 中継の実行時設定 — CMS (DB) が .env を上書き（再起動不要）。"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.services.admin_config_service import AdminConfigService

KEY_AI_ENABLED = "noraops_ai_enabled"
KEY_COPILOT_ENABLED = "noraops_copilot_enabled"
KEY_CONTINUE_ENABLED = "noraops_continue_enabled"


@dataclass
class AiRuntimeSettings:
    enabled: bool
    copilot_enabled: bool
    continue_enabled: bool
    cms_override: bool


def _parse_bool(raw: str | None, default: bool) -> tuple[bool, bool]:
    if raw is None or not str(raw).strip():
        return default, False
    return str(raw).strip().lower() in ("1", "true", "on", "yes"), True


def resolve_ai_runtime(settings: Settings, db: Session | None = None) -> AiRuntimeSettings:
    if db is None:
        ai_on = bool(settings.noraops_ai_enabled)
        return AiRuntimeSettings(
            enabled=ai_on,
            copilot_enabled=ai_on and bool(settings.noraops_copilot_enabled),
            continue_enabled=ai_on and bool(settings.noraops_continue_enabled),
            cms_override=False,
        )
    values = AdminConfigService(db).list_all()
    enabled, o1 = _parse_bool(values.get(KEY_AI_ENABLED), bool(settings.noraops_ai_enabled))
    copilot, o2 = _parse_bool(values.get(KEY_COPILOT_ENABLED), bool(settings.noraops_copilot_enabled))
    cont, o3 = _parse_bool(values.get(KEY_CONTINUE_ENABLED), bool(settings.noraops_continue_enabled))
    return AiRuntimeSettings(
        enabled=enabled,
        copilot_enabled=enabled and copilot,
        continue_enabled=enabled and cont,
        cms_override=o1 or o2 or o3,
    )


def read_ai_cms_settings(db: Session, settings: Settings) -> dict:
    runtime = resolve_ai_runtime(settings, db)
    return {
        "schema": "nora.ai-cms-settings/1",
        "aiEnabled": runtime.enabled,
        "copilotEnabled": runtime.copilot_enabled,
        "continueEnabled": runtime.continue_enabled,
        "cmsOverride": runtime.cms_override,
        "envDefaults": {
            "aiEnabled": bool(settings.noraops_ai_enabled),
            "copilotEnabled": bool(settings.noraops_copilot_enabled),
            "continueEnabled": bool(settings.noraops_continue_enabled),
        },
        "azureConfigured": bool(
            settings.azure_openai_endpoint.strip()
            and settings.azure_openai_api_key.strip()
            and settings.azure_openai_deployment.strip()
        ),
        "note": "Azure キー・エンドポイントは .env のみ。ここでは ON/OFF のみ切り替え（再起動不要）。",
    }


def write_ai_cms_settings(
    db: Session,
    *,
    ai_enabled: bool | None = None,
    copilot_enabled: bool | None = None,
    continue_enabled: bool | None = None,
) -> dict:
    svc = AdminConfigService(db)
    if ai_enabled is not None:
        svc.set(KEY_AI_ENABLED, "1" if ai_enabled else "0")
    if copilot_enabled is not None:
        svc.set(KEY_COPILOT_ENABLED, "1" if copilot_enabled else "0")
    if continue_enabled is not None:
        svc.set(KEY_CONTINUE_ENABLED, "1" if continue_enabled else "0")
    settings = get_settings()
    return read_ai_cms_settings(db, settings)


def usage_context_from_request(request) -> dict[str, str]:
    headers = request.headers

    def h(name: str) -> str:
        return (headers.get(name) or "").strip()

    return {
        "app_id": h("x-noraops-app-id"),
        "repo_owner": h("x-noraops-repo-owner"),
        "repo_name": h("x-noraops-repo-name"),
    }
