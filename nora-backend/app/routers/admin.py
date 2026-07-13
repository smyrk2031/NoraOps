import json

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.db.models import ApiAccessLog, DownloadLog, TelemetryEvent
from app.db.session import get_session
from app.core.template_ctx import render_template
from app.services.admin_analytics import build_admin_dashboard, search_similar_repos
from app.services.system_dashboard import build_system_dashboard
from app.services.admin_config_service import AdminConfigService
from app.services.backup_service import (
    build_backup_status,
    create_backup,
    extract_from_backup,
    read_backup_manifest,
    restore_from_backup,
    write_backup_settings,
)
from app.services.cms_rules import REPO_POLICY_FILE, SECURITY_FILE, cms_snapshot
from app.services.package_allowlist import (
    XlsxImportConfig,
    allowlist_summary,
    ingest_xlsx,
    load_allowlist,
)
from app.services.package_deps_audit import build_packages_dashboard
from app.services.admin_help_search import search_admin_help
from app.services.topology_snapshot import build_topology_snapshot
from app.services.package_review_status import (
    REVIEW_STATUSES,
    get_package_review,
    set_package_review,
)
from app.services.cms_rules import write_mcp_sources, write_rule_file
from app.noraops.services.concierge_prompt_template import validate_and_write_template
from app.noraops.services.env_prompt_template import validate_and_write_template as validate_env_prompt
from app.services.manual_user_service import (
    create_manual_user,
    delete_manual_user,
    issue_manual_access_token,
    list_manual_users,
    manual_user_to_dict,
    retry_manual_gitea,
)
from app.services.admin_user_service import (
    admin_user_to_dict,
    delete_admin_user,
    get_admin_user,
    issue_admin_access_token,
    list_admin_users,
    retry_admin_user_gitea,
    update_admin_user_email,
)

router = APIRouter(prefix="/api/admin", tags=["admin"])
web_router = APIRouter(tags=["admin-web"])


class CmsPayload(BaseModel):
    security_rules_json: str | None = None
    repo_policy_rules_json: str | None = None
    mcp_sources_json: str | None = None
    concierge_prompt_markdown: str | None = None
    env_prompt_markdown: str | None = None


class ManualUserCreateBody(BaseModel):
    memo: str = Field(min_length=1, max_length=200)
    giteaLoginHint: str = Field(default="", max_length=40)


class AdminUserEmailBody(BaseModel):
    verifiedEmail: str = Field(min_length=3, max_length=256)


def _require_manual_provision(settings: Settings) -> None:
    if not settings.noraops_admin_manual_provision:
        raise HTTPException(
            status_code=501,
            detail="手動ユーザ管理は無効です。.env で NORAOPS_ADMIN_MANUAL_PROVISION=1 にして再起動してください。",
        )


@router.get("/manual-users")
def admin_list_manual_users(
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> dict:
    _require_manual_provision(settings)
    rows = list_manual_users(db)
    return {
        "ok": True,
        "enabled": True,
        "users": [manual_user_to_dict(r) for r in rows],
    }


@router.post("/manual-users")
async def admin_create_manual_user(
    body: ManualUserCreateBody,
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> dict:
    _require_manual_provision(settings)
    try:
        result = await create_manual_user(
            db,
            settings,
            memo=body.memo.strip(),
            gitea_login_hint=(body.giteaLoginHint or "").strip(),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {
        "ok": True,
        "user": manual_user_to_dict(result.user),
        "giteaLogin": result.gitea_login,
        "accessToken": result.access_token,
        "hint": "NoraAccessToken はこの画面でのみ表示されます。VS Code の Setting に貼り付けてください。",
    }


@router.post("/manual-users/{canonical_user_id}/retry-gitea")
async def admin_retry_manual_gitea(
    canonical_user_id: str,
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> dict:
    _require_manual_provision(settings)
    try:
        row = await retry_manual_gitea(db, settings, canonical_user_id.strip())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"ok": True, "user": manual_user_to_dict(row)}


@router.post("/manual-users/{canonical_user_id}/issue-token")
def admin_issue_manual_token(
    canonical_user_id: str,
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> dict:
    _require_manual_provision(settings)
    try:
        row, token = issue_manual_access_token(db, settings, canonical_user_id.strip())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {
        "ok": True,
        "user": manual_user_to_dict(row),
        "accessToken": token,
        "hint": "旧トークンは失効しました。このトークンを VS Code に貼り付けてください。",
    }


@router.delete("/manual-users/{canonical_user_id}")
async def admin_delete_manual_user(
    canonical_user_id: str,
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> dict:
    _require_manual_provision(settings)
    try:
        await delete_manual_user(db, settings, canonical_user_id.strip())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"ok": True, "deleted": canonical_user_id.strip()}


@router.get("/users")
def admin_list_users(
    q: str = Query("", max_length=200),
    db: Session = Depends(get_session),
) -> dict:
    rows = list_admin_users(db, query=q.strip())
    return {
        "ok": True,
        "query": q.strip(),
        "count": len(rows),
        "users": [admin_user_to_dict(r) for r in rows],
    }


@router.get("/users/{canonical_user_id}")
def admin_get_user(
    canonical_user_id: str,
    db: Session = Depends(get_session),
) -> dict:
    row = get_admin_user(db, canonical_user_id.strip())
    if not row:
        raise HTTPException(status_code=404, detail="ユーザが見つかりません。")
    return {"ok": True, "user": admin_user_to_dict(row)}


@router.post("/users/{canonical_user_id}/retry-gitea")
async def admin_retry_user_gitea(
    canonical_user_id: str,
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> dict:
    try:
        row = await retry_admin_user_gitea(db, settings, canonical_user_id.strip())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"ok": True, "user": admin_user_to_dict(row)}


@router.post("/users/{canonical_user_id}/issue-token")
def admin_issue_user_token(
    canonical_user_id: str,
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> dict:
    try:
        row, token = issue_admin_access_token(db, settings, canonical_user_id.strip())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {
        "ok": True,
        "user": admin_user_to_dict(row),
        "accessToken": token,
        "hint": "旧トークンは失効しました。このトークンを VS Code に貼り付けてください。",
    }


@router.patch("/users/{canonical_user_id}/email")
def admin_patch_user_email(
    canonical_user_id: str,
    body: AdminUserEmailBody,
    db: Session = Depends(get_session),
) -> dict:
    try:
        row = update_admin_user_email(
            db,
            canonical_user_id.strip(),
            verified_email=body.verifiedEmail.strip(),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"ok": True, "user": admin_user_to_dict(row)}


@router.delete("/users/{canonical_user_id}")
async def admin_delete_user(
    canonical_user_id: str,
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> dict:
    try:
        await delete_admin_user(db, settings, canonical_user_id.strip())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"ok": True, "deleted": canonical_user_id.strip()}


@router.get("/packages/allowlist")
def admin_get_allowlist() -> dict:
    data = load_allowlist()
    summary = allowlist_summary(data)
    return {"allowlist": data, "summary": summary}


@router.post("/packages/allowlist/upload")
async def admin_upload_allowlist(
    file: UploadFile = File(...),
    header_row: int = Form(9),
    category_col: str = Form("A"),
    category_filter: str = Form("Pythonライブラリ"),
    package_col: str = Form("B"),
    version_col: str = Form("C"),
    maintenance_date_col: str = Form("D"),
) -> dict:
    name = (file.filename or "").lower()
    if not name.endswith((".xlsx", ".xlsm")):
        raise HTTPException(status_code=400, detail="XLSX ファイルを指定してください")
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="空のファイルです")
    if header_row < 1:
        raise HTTPException(status_code=400, detail="ヘッダ行番号は 1 以上を指定してください")
    config = XlsxImportConfig(
        header_row=header_row,
        category_col=category_col,
        category_filter=category_filter,
        package_col=package_col,
        version_col=version_col,
        maintenance_date_col=maintenance_date_col,
    )
    try:
        result = ingest_xlsx(content, config)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"取込失敗: {e}") from e
    summary = allowlist_summary(result["allowlist"])
    counts = result["allowlist"].get("lastImport", {}).get("counts", {})
    diff = result.get("diff") or {}
    diff_parts = []
    if diff.get("added"):
        diff_parts.append(f"追加 {len(diff['added'])}")
    if diff.get("removed"):
        diff_parts.append(f"削除 {len(diff['removed'])}")
    if diff.get("changed"):
        diff_parts.append(f"変更 {len(diff['changed'])}")
    diff_text = f"（差分: {', '.join(diff_parts)}）" if diff_parts else ""
    return {
        "ok": True,
        "message": (
            f"許可 {counts.get('allowed', 0)} 件を取込みました。"
            f" 要確認 {counts.get('review', 0)} 件、スキップ {counts.get('skipped', 0)} 件。"
            f"{diff_text}"
        ),
        "summary": summary,
        "importResult": {
            "allowed": result["allowed"],
            "review": result["review"],
            "skipped": result["skipped"],
            "counts": counts,
            "config": result["config"],
            "diff": diff,
        },
    }


@router.get("/packages/deps-audit-dashboard")
def admin_deps_audit_dashboard(
    db: Session = Depends(get_session),
    status: str | None = Query(default=None, alias="reviewStatus"),
) -> dict:
    filt = (status or "all").strip().lower()
    if filt not in (*REVIEW_STATUSES, "all"):
        raise HTTPException(status_code=400, detail="reviewStatus が不正です")
    return build_packages_dashboard(db, status_filter=None if filt == "all" else filt)


class PackageReviewStatusBody(BaseModel):
    package: str = Field(min_length=1, max_length=200)
    status: str = Field(min_length=1, max_length=32)
    note: str | None = Field(default=None, max_length=2000)


@router.patch("/packages/review-status")
def admin_patch_package_review_status(body: PackageReviewStatusBody) -> dict:
    st = body.status.strip().lower()
    if st not in REVIEW_STATUSES:
        raise HTTPException(status_code=400, detail=f"status は {', '.join(REVIEW_STATUSES)} のいずれかです")
    try:
        row = set_package_review(body.package, st, note=body.note)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"ok": True, "review": row}


@router.get("/packages/review-status/{package_name}")
def admin_get_package_review_status(package_name: str) -> dict:
    return {"ok": True, "review": get_package_review(package_name)}


class RepoAuditRunOneBody(BaseModel):
    owner: str
    name: str
    force: bool = False


@router.get("/help/search")
def admin_help_search_api(
    q: str = Query("", max_length=200),
    limit: int = Query(default=20, ge=1, le=50),
    settings: Settings = Depends(get_settings),
) -> dict:
    return search_admin_help(q, limit=limit, settings=settings)


@router.get("/repo-audit/dashboard")
def admin_repo_audit_dashboard(db: Session = Depends(get_session)) -> dict:
    from app.noraops.services.repo_audit_service import build_repo_audit_dashboard

    return build_repo_audit_dashboard(db)


@router.post("/repo-audit/run-delta")
async def admin_repo_audit_run_delta(
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    only_today: bool = Query(default=True),
) -> dict:
    from app.noraops.services.repo_audit_service import run_delta_audit

    cfg = AdminConfigService(db).resolve_runtime_config(settings)
    return await run_delta_audit(db, cfg, settings, trigger="manual", only_today=only_today)


@router.post("/repo-audit/run-one")
async def admin_repo_audit_run_one(
    body: RepoAuditRunOneBody,
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> dict:
    from app.noraops.services.repo_audit_service import audit_repo_from_gitea

    owner = body.owner.strip()
    name = body.name.strip()
    if not owner or not name:
        raise HTTPException(status_code=400, detail="owner と name を指定してください。")
    cfg = AdminConfigService(db).resolve_runtime_config(settings)
    return await audit_repo_from_gitea(
        db,
        cfg,
        settings,
        owner,
        name,
        trigger="manual",
        force=body.force,
    )


@router.get("/dashboard-data")
def admin_dashboard_data(
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> dict:
    return build_admin_dashboard(db, settings)


@router.get("/recommendations")
async def admin_recommendations(
    q: str = Query("", max_length=200),
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> dict:
    items = await search_similar_repos(db, settings, q, limit=12)
    return {"query": q, "items": items}


class CheckTogglesPayload(BaseModel):
    toggles: dict[str, bool]


class AiCmsSettingsPayload(BaseModel):
    ai_enabled: bool | None = None
    copilot_enabled: bool | None = None
    continue_enabled: bool | None = None


class BuiltinPromptEntryPayload(BaseModel):
    key: str
    title: str
    category: str = "xllm"
    showInXllm: bool = False
    order: int = 0
    dynamic: bool = False
    legacyMode: str | None = None
    description: str | None = None
    defaultEnabled: bool = True
    body: str | None = None
    resolver: str | None = None


class BuiltinPromptCatalogPayload(BaseModel):
    version: str
    prompts: list[BuiltinPromptEntryPayload]


@router.get("/cms/checks")
def get_cms_checks() -> dict:
    from app.noraops.services.check_toggles import checks_for_cms

    return checks_for_cms()


@router.post("/cms/checks")
def save_cms_checks(payload: CheckTogglesPayload) -> dict:
    from app.noraops.services.check_toggles import write_toggles

    if not payload.toggles:
        return {"ok": True, "message": "変更はありません。"}
    write_toggles(payload.toggles)
    enabled = sum(1 for v in payload.toggles.values() if v)
    disabled = sum(1 for v in payload.toggles.values() if not v)
    return {
        "ok": True,
        "message": f"チェック設定を保存しました（有効 {enabled} / 無効 {disabled}）。拡張は次回ルール取得時に反映されます。",
    }


@router.get("/cms/ai-settings")
def get_ai_cms_settings_api(db: Session = Depends(get_session)) -> dict:
    from app.noraops.services.ai_gateway import build_status
    from app.noraops.services.ai_runtime_settings import read_ai_cms_settings, resolve_ai_runtime

    settings = get_settings()
    runtime = resolve_ai_runtime(settings, db)
    data = read_ai_cms_settings(db, settings)
    data["status"] = build_status(settings, runtime)
    return data


@router.post("/cms/ai-settings")
def save_ai_cms_settings_api(payload: AiCmsSettingsPayload, db: Session = Depends(get_session)) -> dict:
    from app.noraops.services.ai_gateway import build_status
    from app.noraops.services.ai_runtime_settings import resolve_ai_runtime, write_ai_cms_settings

    settings = get_settings()
    if payload.ai_enabled is None and payload.copilot_enabled is None and payload.continue_enabled is None:
        return {"ok": True, "message": "変更はありません。"}
    data = write_ai_cms_settings(
        db,
        ai_enabled=payload.ai_enabled,
        copilot_enabled=payload.copilot_enabled,
        continue_enabled=payload.continue_enabled,
    )
    runtime = resolve_ai_runtime(settings, db)
    data["ok"] = True
    data["message"] = "AI 設定を保存しました（再起動不要）。"
    data["status"] = build_status(settings, runtime)
    return data


@router.get("/cms/builtin-prompts")
def get_builtin_prompts_cms() -> dict:
    from app.noraops.services.builtin_prompt_catalog import read_catalog_for_cms

    return read_catalog_for_cms()


@router.post("/cms/builtin-prompts")
def save_builtin_prompts_cms(payload: BuiltinPromptCatalogPayload) -> dict:
    from app.noraops.services.builtin_prompt_catalog import validate_and_write_catalog

    try:
        ver = validate_and_write_catalog(payload.model_dump(mode="json"))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    count = len(payload.prompts)
    return {
        "ok": True,
        "message": (
            f"基本プロンプトカタログを保存しました（version {ver} · {count} 件）。"
            "拡張は次回同期時に反映されます。"
        ),
        "version": ver,
        "count": count,
    }


@router.get("/cms/mcp-reference")
def get_mcp_reference() -> dict:
    from app.services.cms_rules import read_mcp_sources_parsed

    data = read_mcp_sources_parsed()
    sources = []
    for s in data.get("sources") or []:
        sources.append(
            {
                "id": s.get("id"),
                "title": s.get("title") or s.get("id"),
                "summary": s.get("summary") or "",
                "when": s.get("when") or [],
                "promptSnippet": (s.get("promptSnippet") or "")[:200],
            }
        )
    return {
        "schema": "nora.mcp-reference/1",
        "description": data.get("description") or "",
        "sources": sources,
        "runtimeConnected": False,
    }


@router.post("/cms")
def save_cms(payload: CmsPayload) -> dict:
    saved: list[str] = []
    try:
        if payload.security_rules_json is not None:
            write_rule_file(SECURITY_FILE, payload.security_rules_json)
            saved.append("セキュリティルール（JSON 直接 — 非推奨）")
        if payload.repo_policy_rules_json is not None:
            write_rule_file(REPO_POLICY_FILE, payload.repo_policy_rules_json)
            saved.append("リポジトリポリシー（JSON 直接 — 非推奨）")
        if payload.mcp_sources_json is not None:
            write_mcp_sources(payload.mcp_sources_json)
            saved.append("MCP ソース")
        if payload.concierge_prompt_markdown is not None:
            validate_and_write_template(payload.concierge_prompt_markdown)
            saved.append("コンシェルジュプロンプト")
        if payload.env_prompt_markdown is not None:
            validate_env_prompt(payload.env_prompt_markdown)
            saved.append("環境セットアッププロンプト")
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"invalid JSON: {e}") from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    if not saved:
        return {"ok": True, "message": "変更はありません。"}
    msg = (
        "保存しました: " + "、".join(saved) + "。"
        + " チェックルールとコンシェルジュテンプレは再起動なしで API に反映されます。"
    )
    return {"ok": True, "message": msg}


class AdminSettingsPayload(BaseModel):
    gitea_base_url: str | None = None
    gitea_token: str | None = None
    gitea_orgs: str | None = None
    gitea_list_mode: str | None = None
    gitea_default_per_page: int | None = None
    gitea_exe_path: str | None = None
    mcp_bridge_api_key: str | None = None


@router.get("/settings")
def get_settings_api(db: Session = Depends(get_session)):
    svc = AdminConfigService(db)
    return svc.list_all()


@router.post("/settings")
def save_settings_api(payload: AdminSettingsPayload, db: Session = Depends(get_session)):
    svc = AdminConfigService(db)
    for key, value in payload.model_dump(exclude_none=True).items():
        svc.set(key, str(value))
    return {"ok": True}


@router.post("/detect-gitea-db")
def detect_gitea_db(payload: AdminSettingsPayload, db: Session = Depends(get_session)):
    if not payload.gitea_exe_path:
        raise HTTPException(status_code=400, detail="gitea_exe_path is required")
    svc = AdminConfigService(db)
    detected = svc.detect_gitea_db_from_exe(payload.gitea_exe_path)
    if detected.get("db_url"):
        svc.set("gitea_detected_db_url", detected["db_url"])
    svc.set("gitea_exe_path", payload.gitea_exe_path)
    return detected


@router.get("/system-dashboard")
async def admin_system_dashboard_api(
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> dict:
    return await build_system_dashboard(db, settings)


class BackupSettingsPayload(BaseModel):
    enabled: bool | None = None
    interval_hours: int | None = None
    retention: int | None = None
    local_dir: str | None = None
    remote_dir: str | None = None
    include_artifacts: bool | None = None
    include_tools: bool | None = None


class BackupRestorePayload(BaseModel):
    backup_id: str
    confirm: str
    components: list[str] | None = None


class BackupExtractPayload(BaseModel):
    backup_id: str
    confirm: str
    components: list[str]


@router.get("/backup/status")
def admin_backup_status(
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> dict:
    return build_backup_status(settings, db)


@router.post("/backup/settings")
def admin_backup_settings_save(
    payload: BackupSettingsPayload,
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> dict:
    cfg = write_backup_settings(
        db,
        settings,
        enabled=payload.enabled,
        interval_hours=payload.interval_hours,
        retention=payload.retention,
        local_dir=payload.local_dir,
        remote_dir=payload.remote_dir,
        include_artifacts=payload.include_artifacts,
        include_tools=payload.include_tools,
    )
    return {
        "ok": True,
        "message": "バックアップ設定を保存しました。",
        "settings": {
            "enabled": cfg.enabled,
            "interval_hours": cfg.interval_hours,
            "retention": cfg.retention,
            "local_dir": str(cfg.local_dir),
            "remote_dir": str(cfg.remote_dir) if cfg.remote_dir else None,
            "include_artifacts": cfg.include_artifacts,
            "include_tools": cfg.include_tools,
        },
    }


@router.post("/backup/run")
def admin_backup_run(
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> dict:
    result = create_backup(settings, db, trigger="manual")
    return {
        "ok": result.ok,
        "backup_id": result.backup_id,
        "size_bytes": result.size_bytes,
        "size_human": result.message,
        "warnings": result.warnings,
        "components": result.components,
        "path": str(result.zip_path) if result.zip_path else None,
        "remote_path": str(result.remote_path) if result.remote_path else None,
        "message": result.message,
    }


@router.get("/backup/{backup_id}/manifest")
def admin_backup_manifest(
    backup_id: str,
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> dict:
    try:
        return read_backup_manifest(settings, db, backup_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@router.post("/backup/restore")
def admin_backup_restore(
    payload: BackupRestorePayload,
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> dict:
    if payload.confirm != "RESTORE":
        raise HTTPException(status_code=400, detail='confirm must be "RESTORE"')
    try:
        return restore_from_backup(
            settings,
            db,
            payload.backup_id,
            components=payload.components,
            pre_backup=True,
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/backup/extract")
def admin_backup_extract(
    payload: BackupExtractPayload,
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> dict:
    if payload.confirm != "EXTRACT":
        raise HTTPException(status_code=400, detail='confirm must be "EXTRACT"')
    if not payload.components:
        raise HTTPException(status_code=400, detail="components is required")
    try:
        return extract_from_backup(settings, db, payload.backup_id, payload.components)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@web_router.get("/admin/packages", response_class=HTMLResponse)
def admin_packages_page(
    request: Request,
    db: Session = Depends(get_session),
    review_status: str | None = Query(default="all", alias="reviewStatus"),
):
    filt = (review_status or "all").strip().lower()
    if filt not in (*REVIEW_STATUSES, "all"):
        filt = "all"
    dash = build_packages_dashboard(
        db,
        status_filter=None if filt == "all" else filt,
    )
    allow = load_allowlist()
    return render_template(
        request=request,
        name="admin_packages.html",
        context={
            "dashboard": dash,
            "allowlist": allow,
            "reviewStatusFilter": filt,
        },
    )


@web_router.get("/admin/backup", response_class=HTMLResponse)
def admin_backup_page(
    request: Request,
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
):
    status = build_backup_status(settings, db)
    return render_template(
        request=request,
        name="admin_backup.html",
        context={"status": status},
    )


@router.get("/topology/snapshot")
def admin_topology_snapshot(
    request: Request,
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> dict:
    """連携モードの現状（秘密情報なし）。"""
    return build_topology_snapshot(db, settings, request)


@web_router.get("/admin/topology", response_class=HTMLResponse)
def admin_topology_page(request: Request):
    return render_template(request=request, name="admin_topology.html", context={})


@web_router.get("/admin/help", response_class=HTMLResponse)
def admin_help_page(
    request: Request,
    q: str = Query("", max_length=200),
    settings: Settings = Depends(get_settings),
):
    result = search_admin_help(q, limit=24, settings=settings)
    return render_template(
        request=request,
        name="admin_help.html",
        context={"query": q, "result": result},
    )


@web_router.get("/admin/system", response_class=HTMLResponse)
async def admin_system_page(
    request: Request,
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
):
    report = await build_system_dashboard(db, settings)
    return render_template(
        request=request,
        name="admin_system.html",
        context={"report": report},
    )


@web_router.get("/admin", response_class=HTMLResponse)
def admin_hub_page(
    request: Request,
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
):
    data = build_admin_dashboard(db, settings)
    return render_template(
        request=request,
        name="admin_hub.html",
        context={"dashboard": data},
    )


@web_router.get("/admin/cms", response_class=HTMLResponse)
def admin_cms_page(request: Request, db: Session = Depends(get_session)):
    from app.noraops.services.ai_gateway import build_status
    from app.noraops.services.ai_runtime_settings import read_ai_cms_settings, resolve_ai_runtime

    settings = get_settings()
    runtime = resolve_ai_runtime(settings, db)
    snap = cms_snapshot()
    snap["ai_status"] = build_status(settings, runtime)
    snap["ai_settings"] = read_ai_cms_settings(db, settings)
    return render_template(
        request=request,
        name="admin_cms.html",
        context=snap,
    )


@web_router.get("/admin/settings", response_class=HTMLResponse)
def admin_settings_page(
    request: Request,
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
    svc = AdminConfigService(db)
    saved = svc.list_all()
    return render_template(
        request=request,
        name="admin_settings.html",
        context={
            "saved": saved,
            "env_db_backend": settings.db_backend,
            "env_sqlite_path": settings.sqlite_path,
            "env_db_url": settings.db_url,
        },
    )


@web_router.get("/admin/manual-users", response_class=HTMLResponse)
def admin_manual_users_page(
    request: Request,
    settings: Settings = Depends(get_settings),
):
    return render_template(
        request=request,
        name="admin_manual_users.html",
        context={
            "enabled": bool(settings.noraops_admin_manual_provision),
        },
    )


@web_router.get("/admin/users", response_class=HTMLResponse)
def admin_users_page(request: Request):
    return render_template(
        request=request,
        name="admin_users.html",
        context={},
    )


@web_router.get("/admin/logs", response_class=HTMLResponse)
def admin_logs_page(
    request: Request,
    db: Session = Depends(get_session),
):
    q_access = db.scalars(select(ApiAccessLog).order_by(ApiAccessLog.id.desc()).limit(350)).all()
    q_dl = db.scalars(select(DownloadLog).order_by(DownloadLog.id.desc()).limit(350)).all()
    q_telemetry = db.scalars(select(TelemetryEvent).order_by(TelemetryEvent.id.desc()).limit(200)).all()
    return render_template(
        request=request,
        name="admin_logs.html",
        context={
            "access": q_access,
            "downloads": q_dl,
            "telemetry_rows": q_telemetry,
        },
    )
