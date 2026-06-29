"""FastAPI dependencies for NoraOps authenticated user."""

from __future__ import annotations

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.db.models import NoraOpsIdentityRow, NoraOpsUser
from app.db.session import get_session
from app.noraops.auth.access_token_store import get_access_token_store
from app.noraops.auth.device_store import get_device_store
from app.noraops.auth.identity import (
    NoraOpsIdentity,
    identity_from_external_id,
    parse_identity_from_request,
    parse_verified_email_from_request,
)
from app.noraops.auth.identity_resolver import ensure_stub_user, get_user_by_canonical, primary_external_id
from app.noraops.auth.session_store import get_session_store
from app.services.gitea_user_provision import resolve_noraops_user, user_external_id


def _session_token_from_request(request: Request) -> str:
    return (request.headers.get("X-NoraOps-Session-Token") or "").strip()


def _access_token_from_request(request: Request) -> str:
    auth = (request.headers.get("Authorization") or "").strip()
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return (request.headers.get("X-NoraOps-Access-Token") or "").strip()


def resolve_identity_from_access_token(request: Request, db: Session, settings: Settings) -> NoraOpsIdentity | None:
    raw = _access_token_from_request(request)
    if not raw:
        return None
    canonical = getattr(request.state, "noraops_access_canonical", None)
    if not canonical:
        canonical = get_access_token_store().resolve_canonical(db, settings, raw, touch=False)
        if not canonical:
            return None
        request.state.noraops_access_canonical = canonical
    ext = getattr(request.state, "noraops_access_external_id", None)
    if not ext:
        ident_row = db.scalar(
            select(NoraOpsIdentityRow)
            .where(NoraOpsIdentityRow.canonical_user_id == canonical)
            .order_by(NoraOpsIdentityRow.created_at.asc())
            .limit(1)
        )
        if ident_row:
            ext = ident_row.external_id
            request.state.noraops_access_external_id = ext
    if not ext:
        return None
    return identity_from_external_id(ext)


def resolve_identity_from_session_token(request: Request, db: Session, settings: Settings) -> NoraOpsIdentity | None:
    raw = _session_token_from_request(request)
    if not raw:
        return None
    canonical = getattr(request.state, "noraops_session_canonical", None)
    if not canonical:
        canonical = get_session_store().resolve_canonical(db, settings, raw, touch=False)
        if not canonical:
            return None
        request.state.noraops_session_canonical = canonical
    ext = getattr(request.state, "noraops_session_external_id", None)
    if not ext:
        ident_row = db.scalar(
            select(NoraOpsIdentityRow)
            .where(NoraOpsIdentityRow.canonical_user_id == canonical)
            .order_by(NoraOpsIdentityRow.created_at.asc())
            .limit(1)
        )
        if ident_row:
            ext = ident_row.external_id
            request.state.noraops_session_external_id = ext
    if not ext:
        return None
    return identity_from_external_id(ext)


def get_request_identity(request: Request, db: Session | None = None, settings: Settings | None = None) -> NoraOpsIdentity | None:
    ident = getattr(request.state, "noraops_identity", None)
    if ident:
        return ident
    ident = parse_identity_from_request(request, settings)
    if ident:
        return ident
    if db is not None and settings is not None:
        access_ident = resolve_identity_from_access_token(request, db, settings)
        if access_ident:
            return access_ident
        session_ident = resolve_identity_from_session_token(request, db, settings)
        if session_ident:
            return session_ident
    token = request.headers.get("X-NoraOps-Device-Token")
    return resolve_identity_from_device_token(token)


async def _resolve_user_from_access_token(
    request: Request,
    db: Session,
    settings: Settings,
) -> NoraOpsUser | None:
    raw = _access_token_from_request(request)
    if not raw:
        return None

    canonical = getattr(request.state, "noraops_access_canonical", None)
    if not canonical:
        canonical = get_access_token_store().resolve_canonical(db, settings, raw, touch=True)
        if not canonical:
            return None
        request.state.noraops_access_canonical = canonical

    user = get_user_by_canonical(db, canonical)
    if not user:
        return None

    ident_row = db.scalar(
        select(NoraOpsIdentityRow)
        .where(NoraOpsIdentityRow.canonical_user_id == canonical)
        .order_by(NoraOpsIdentityRow.created_at.asc())
        .limit(1)
    )
    if ident_row:
        user._primary_external_id = ident_row.external_id  # type: ignore[attr-defined]
        request.state.noraops_access_external_id = ident_row.external_id
        request.state.noraops_identity = identity_from_external_id(ident_row.external_id)
    return user


async def get_optional_noraops_user(
    request: Request,
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> NoraOpsUser | None:
    user = getattr(request.state, "noraops_user", None)
    if user:
        return user

    access_user = await _resolve_user_from_access_token(request, db, settings)
    if access_user:
        request.state.noraops_user = access_user
        return access_user

    session_user = await _resolve_user_from_session(request, db, settings)
    if session_user:
        request.state.noraops_user = session_user
        return session_user

    ident = get_request_identity(request, db, settings)
    if not ident:
        return None

    verified_email = None
    if not (
        (settings.is_windows_trust_auth and settings.noraops_require_email_activation)
        or settings.is_email_token_auth
    ):
        verified_email = parse_verified_email_from_request(request, settings)
    user = await resolve_noraops_user(db, settings, ident, verified_email=verified_email)
    if user and not getattr(user, "_primary_external_id", None):
        user._primary_external_id = ident.external_id  # type: ignore[attr-defined]
    if user:
        request.state.noraops_user = user
        request.state.noraops_identity = ident
    return user


async def _resolve_user_from_session(
    request: Request,
    db: Session,
    settings: Settings,
) -> NoraOpsUser | None:
    raw = _session_token_from_request(request)
    if not raw:
        return None

    canonical = getattr(request.state, "noraops_session_canonical", None)
    if not canonical:
        canonical = get_session_store().resolve_canonical(db, settings, raw, touch=True)
        if not canonical:
            return None
        request.state.noraops_session_canonical = canonical

    user = get_user_by_canonical(db, canonical)
    if not user:
        return None

    ident_row = db.scalar(
        select(NoraOpsIdentityRow)
        .where(NoraOpsIdentityRow.canonical_user_id == canonical)
        .order_by(NoraOpsIdentityRow.created_at.asc())
        .limit(1)
    )
    if ident_row:
        user._primary_external_id = ident_row.external_id  # type: ignore[attr-defined]
        request.state.noraops_session_external_id = ident_row.external_id
        request.state.noraops_identity = identity_from_external_id(ident_row.external_id)
    return user


async def require_identity_record(
    request: Request,
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> NoraOpsUser:
    """windows_trust: stub ユーザ（Gitea 未 provision）も可。"""
    user = await get_optional_noraops_user(request, db, settings)
    if user:
        return user
    if not settings.is_windows_trust_auth:
        raise HTTPException(status_code=501, detail="Requires NORAOPS_AUTH_MODE=windows_trust")
    ident = get_request_identity(request, db, settings)
    if not ident:
        raise HTTPException(status_code=401, detail="Windows authenticated user not found.")
    user = await ensure_stub_user(db, settings, ident)
    if not user:
        raise HTTPException(status_code=401, detail="ユーザレコードの作成に失敗しました。")
    request.state.noraops_user = user
    return user


async def require_provisioned_user(
    request: Request,
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> NoraOpsUser:
    from app.noraops.auth.email_activation_service import is_user_provisioned

    user = await get_optional_noraops_user(request, db, settings)
    if not user:
        raise HTTPException(status_code=401, detail="認証が必要です。")

    if settings.is_email_token_auth:
        if not is_user_provisioned(user):
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "registration_incomplete",
                    "message": "メール登録と有効化が完了していません。Setting でメールを登録してください。",
                },
            )
        return user

    user = await require_identity_record(request, db, settings)
    if settings.is_windows_trust_auth and settings.noraops_require_email_activation:
        if not is_user_provisioned(user):
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "registration_incomplete",
                    "message": "メール登録と有効化が完了していません。Setting でメールを登録してください。",
                },
            )
    return user


async def require_noraops_user(
    request: Request,
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> NoraOpsUser:
    if settings.is_email_otp_auth:
        user = await get_optional_noraops_user(request, db, settings)
        if not user:
            raise HTTPException(
                status_code=401,
                detail={"code": "session_expired", "message": "ログインセッションが無効または期限切れです。"},
            )
        return user
    if settings.is_email_token_auth:
        return await require_provisioned_user(request, db, settings)
    if not settings.is_windows_trust_auth:
        raise HTTPException(status_code=501, detail="Requires NORAOPS_AUTH_MODE=windows_trust, email_otp, or email_token")
    return await require_provisioned_user(request, db, settings)


def resolve_identity_from_device_token(token: str | None) -> NoraOpsIdentity | None:
    raw = (token or "").strip()
    if not raw:
        return None
    external_id = get_device_store().resolve_token(raw)
    if not external_id:
        return None
    return identity_from_external_id(external_id)


def external_id_for_user(db: Session, user: NoraOpsUser) -> str:
    ext = user_external_id(user)
    if ext:
        return ext
    return primary_external_id(db, user)
