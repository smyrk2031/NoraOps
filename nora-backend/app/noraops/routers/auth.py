"""NoraOps authentication (email_token, email_otp, windows_trust legacy, open)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.db.session import get_session
from app.noraops.auth.email_activation_service import (
    ActivationRateLimitError,
    get_email_activation_service,
    is_user_provisioned,
    registration_status,
)
from app.noraops.auth.email_util import email_external_id
from app.noraops.auth.identity import identity_from_external_id, parse_verified_email_from_request
from app.noraops.auth.identity_resolver import IdentityCollisionError, resolve_identity_by_external_id
from app.noraops.auth.mail_sender import MailDeliveryError
from app.noraops.auth.otp_service import OtpRateLimitError, get_otp_service
from app.noraops.auth.session_store import get_session_store
from app.services.gitea_client import GiteaClientError
from app.services.gitea_user_provision import GiteaProvisionError
from app.noraops.auth.user_deps import (
    external_id_for_user,
    get_optional_noraops_user,
    get_request_identity,
    require_identity_record,
    require_noraops_user,
    resolve_identity_from_device_token,
)
from app.services.gitea_user_provision import resolve_noraops_user

router = APIRouter(prefix="/api/v1/noraops/auth", tags=["noraops-auth"])


def _device_token(request: Request, header: str | None = None) -> str:
    return (header or request.headers.get("X-NoraOps-Device-Token") or "").strip()


async def _user_for_client_request(
    request: Request,
    db: Session,
    settings: Settings,
    device_token: str | None = None,
):
    user = await get_optional_noraops_user(request, db, settings)
    if user:
        return user, external_id_for_user(db, user)
    if settings.is_windows_trust_auth:
        ident = resolve_identity_from_device_token(device_token or _device_token(request))
        if ident:
            from app.noraops.auth.identity_resolver import ensure_stub_user

            user = await ensure_stub_user(db, settings, ident)
            if user:
                return user, ident.external_id
    return None, None


def _requires_email_flow(settings: Settings) -> bool:
    return bool(
        settings.is_email_token_auth
        or (settings.is_windows_trust_auth and settings.noraops_require_email_activation)
    )


def _registration_payload(
    settings: Settings,
    user,
    external_id: str | None,
    pending_email: str | None,
) -> dict:
    status = registration_status(user, pending_email)
    has_token = bool(user and settings.is_email_token_auth and is_user_provisioned(user))
    incomplete = bool(
        user
        and not is_user_provisioned(user)
        and (user.gitea_login or user.verified_email)
    )
    return {
        "authMode": settings.auth_mode_normalized,
        "registrationStatus": status,
        "email": user.verified_email if user else None,
        "pendingEmail": pending_email,
        "giteaLogin": user.gitea_login if user and user.gitea_login else None,
        "provisioned": is_user_provisioned(user),
        "provisionIncomplete": incomplete,
        "identity": {"externalId": external_id},
        "requiresEmailActivation": _requires_email_flow(settings),
        "requiresAccessToken": settings.is_email_token_auth,
        "hasAccessToken": has_token,
    }


@router.get("/me")
async def auth_me(
    request: Request,
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> dict:
    user, ext_id = await _user_for_client_request(request, db, settings)
    ident = get_request_identity(request, db, settings)
    if not ext_id and ident:
        ext_id = ident.external_id
    pending = None
    if ext_id:
        pending = get_email_activation_service().pending_email_for(db, ext_id)
    base = _registration_payload(settings, user, ext_id, pending)
    return {
        **base,
        "identity": {
            "externalId": ext_id,
            "username": ident.username if ident else None,
            "domain": ident.domain if ident else None,
            "email": user.verified_email if user else None,
        },
        "canonicalUserId": user.canonical_user_id if user else None,
    }


@router.get("/registration-status")
async def registration_status_api(
    request: Request,
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> dict:
    user, ext_id = await _user_for_client_request(request, db, settings)
    pending = get_email_activation_service().pending_email_for(db, ext_id) if ext_id else None
    payload = _registration_payload(settings, user, ext_id, pending)
    if settings.is_email_token_auth and not user:
        payload["registrationStatus"] = "pending_email"
        payload["provisioned"] = False
    return payload


class RegisterEmailBody(BaseModel):
    email: EmailStr


@router.post("/register-email")
async def register_email(
    body: RegisterEmailBody,
    request: Request,
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    x_noraops_device_token: str | None = Header(default=None, alias="X-NoraOps-Device-Token"),
) -> dict:
    svc = get_email_activation_service()
    try:
        if settings.is_email_token_auth:
            norm = await svc.request_registration(db, settings, email=str(body.email))
        elif settings.is_windows_trust_auth:
            ident = resolve_identity_from_device_token(x_noraops_device_token or _device_token(request))
            if not ident:
                raise HTTPException(
                    status_code=401,
                    detail="デバイス登録が必要です（レガシー windows_trust）。",
                )
            norm = await svc.request_activation(
                db, settings, external_id=ident.external_id, email=str(body.email)
            )
        else:
            raise HTTPException(status_code=501, detail="この認証モードでは利用できません。")
    except ActivationRateLimitError:
        raise HTTPException(status_code=429, detail="リクエストが多すぎます。しばらく待ってから再試行してください。")
    except MailDeliveryError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return {
        "ok": True,
        "email": norm,
        "registrationStatus": "pending_activation",
        "hint": "メールに届いた URL を開き、アクセストークンを VS Code の Setting に貼り付けてください。",
    }


@router.post("/reissue-access-token")
async def reissue_access_token(
    body: RegisterEmailBody,
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> dict:
    if not settings.is_email_token_auth:
        raise HTTPException(status_code=501, detail="email_token モードでのみ利用できます。")
    svc = get_email_activation_service()
    try:
        norm = await svc.request_reissue(db, settings, email=str(body.email))
    except ActivationRateLimitError:
        raise HTTPException(status_code=429, detail="リクエストが多すぎます。しばらく待ってから再試行してください。")
    except MailDeliveryError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {
        "ok": True,
        "email": norm,
        "hint": "メールの URL を開き、新しいアクセストークンを VS Code に貼り付けてください。",
    }


@router.post("/retry-gitea-provision")
async def retry_gitea_provision(
    body: RegisterEmailBody,
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> dict:
    """Gitea プロビジョン未完了時の復旧（GITEA_TOKEN 修正後など）。"""
    if not (settings.is_email_token_auth or settings.is_windows_trust_auth):
        raise HTTPException(status_code=501, detail="この認証モードでは利用できません。")
    svc = get_email_activation_service()
    try:
        result = await svc.retry_gitea_provision(db, settings, email=str(body.email))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True, **result}


@router.get("/activate-email", response_class=HTMLResponse)
async def activate_email(
    token: str,
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> HTMLResponse:
    svc = get_email_activation_service()
    try:
        result = await svc.activate_token(db, settings, token)
    except ValueError as e:
        return HTMLResponse(
            _activation_html_page(success=False, message=str(e), retryable=True),
            status_code=400,
        )
    except GiteaProvisionError as e:
        hint = e.hint or "GITEA_TOKEN の権限と接続設定を確認してください。"
        return HTMLResponse(
            _activation_html_page(
                success=False,
                message=f"Gitea 登録に失敗しました（{e.stage}）: {e} {hint}",
                retryable=True,
            ),
            status_code=400,
        )
    except GiteaClientError as e:
        return HTMLResponse(
            _activation_html_page(
                success=False,
                message=f"Gitea API エラー: {e} {e.hint or ''}",
                retryable=True,
            ),
            status_code=400,
        )
    login = result.user.gitea_login or ""
    return HTMLResponse(
        _activation_html_page(
            success=True,
            message="登録が完了しました。下のアクセストークンを VS Code の NoraOps Setting に貼り付けてください。",
            gitea_login=login,
            access_token=result.access_token,
        )
    )


def _activation_html_page(
    *,
    success: bool,
    message: str,
    gitea_login: str = "",
    access_token: str | None = None,
    retryable: bool = False,
) -> str:
    color = "#16a34a" if success else "#dc2626"
    extra = f"<p>Gitea ユーザ: <code>{gitea_login}</code></p>" if gitea_login else ""
    retry_note = (
        "<p><small>この URL は有効な間、設定を直したあとに<strong>同じページを再読み込み</strong>して再試行できます。</small></p>"
        if retryable
        else ""
    )
    token_block = ""
    if access_token:
        token_block = f"""
<div style="margin:16px 0;padding:12px;background:#0f172a;border-radius:8px;word-break:break-all;">
  <div style="font-size:12px;color:#94a3b8;margin-bottom:8px;">NoraAccessToken（この画面でのみ表示されます）</div>
  <code id="tok" style="color:#e2e8f0;font-size:13px;">{access_token}</code>
</div>
<button type="button" onclick="navigator.clipboard.writeText(document.getElementById('tok').textContent)"
  style="padding:8px 16px;border-radius:6px;border:none;background:#2563eb;color:#fff;cursor:pointer;">
  トークンをコピー
</button>
"""
    return f"""<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8"/><title>NoraOps 登録</title>
<style>body{{font-family:Segoe UI,sans-serif;max-width:520px;margin:48px auto;padding:0 16px;}}
h1{{color:{color};font-size:1.25rem;}}</style></head>
<body><h1>{"完了" if success else "エラー"}</h1><p>{message}</p>{extra}{token_block}{retry_note}
<p><small>このページは閉じて構いません。</small></p></body></html>"""


class OtpRequestBody(BaseModel):
    email: EmailStr


@router.post("/otp/request")
async def otp_request(
    body: OtpRequestBody,
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> dict:
    if not settings.is_email_otp_auth:
        raise HTTPException(status_code=501, detail="NORAOPS_AUTH_MODE=email_otp が必要です。")
    try:
        norm = get_otp_service().request_otp(db, settings, str(body.email))
    except OtpRateLimitError:
        raise HTTPException(status_code=429, detail="リクエストが多すぎます。しばらく待ってから再試行してください。")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {
        "ok": True,
        "email": norm,
        "expiresInMinutes": settings.noraops_otp_ttl_minutes,
        "hint": "メールに届いた6桁コードでログインしてください。",
    }


class OtpVerifyBody(BaseModel):
    email: EmailStr
    otp: str = Field(min_length=6, max_length=6)


@router.post("/otp/verify")
async def otp_verify(
    body: OtpVerifyBody,
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> dict:
    if not settings.is_email_otp_auth:
        raise HTTPException(status_code=501, detail="NORAOPS_AUTH_MODE=email_otp が必要です。")
    ok = get_otp_service().verify_otp(db, str(body.email), body.otp.strip())
    if not ok:
        raise HTTPException(status_code=401, detail="コードが無効または期限切れです。")

    ext_id = email_external_id(str(body.email))
    try:
        result = await resolve_identity_by_external_id(
            db,
            settings,
            ext_id,
            verified_email=str(body.email),
        )
    except IdentityCollisionError as e:
        raise HTTPException(
            status_code=409,
            detail={"code": "identity_collision", "message": str(e), "giteaLogins": e.gitea_logins},
        )
    if not result or not result.user:
        raise HTTPException(status_code=503, detail="ユーザのプロビジョンに失敗しました。")

    session_token = get_session_store().create_session(db, settings, canonical_user_id=result.user.canonical_user_id)
    idle_days = settings.noraops_session_idle_days
    return {
        "ok": True,
        "sessionToken": session_token,
        "expiresInDays": idle_days,
        "identity": {"externalId": ext_id, "email": result.user.verified_email},
        "giteaLogin": result.user.gitea_login,
    }


@router.post("/logout")
async def auth_logout(
    request: Request,
    db: Session = Depends(get_session),
    x_noraops_session_token: str | None = Header(default=None, alias="X-NoraOps-Session-Token"),
) -> dict:
    token = (x_noraops_session_token or request.headers.get("X-NoraOps-Session-Token") or "").strip()
    if token:
        get_session_store().revoke(db, token)
    return {"ok": True}


async def resolve_subject_for_push_session(
    request: Request,
    db: Session,
    settings: Settings,
    *,
    device_token: str | None,
    device_label: str,
    session_token: str | None = None,
    access_token: str | None = None,
) -> str:
    if settings.is_email_token_auth:
        from app.noraops.auth.access_token_store import get_access_token_store

        raw = (access_token or "").strip()
        if not raw:
            auth = (request.headers.get("Authorization") or "").strip()
            if auth.lower().startswith("bearer "):
                raw = auth[7:].strip()
            else:
                raw = (request.headers.get("X-NoraOps-Access-Token") or "").strip()
        if not raw:
            raise HTTPException(
                status_code=401,
                detail={
                    "code": "access_token_required",
                    "message": "NoraAccessToken が必要です。Setting で登録してください。",
                },
            )
        canonical = get_access_token_store().resolve_canonical(db, settings, raw, touch=True)
        if not canonical:
            raise HTTPException(
                status_code=401,
                detail={
                    "code": "access_token_invalid",
                    "message": "アクセストークンが無効です。メールから再発行してください。",
                },
            )
        user = await get_optional_noraops_user(request, db, settings)
        if user:
            if not is_user_provisioned(user):
                raise HTTPException(
                    status_code=403,
                    detail={
                        "code": "registration_incomplete",
                        "message": "メール登録と有効化が完了していません。",
                    },
                )
            return external_id_for_user(db, user)
        return canonical

    if settings.is_email_otp_auth:
        raw = (session_token or request.headers.get("X-NoraOps-Session-Token") or "").strip()
        if not raw:
            raise HTTPException(
                status_code=401,
                detail={"code": "session_expired", "message": "メール OTP ログインが必要です。"},
            )
        canonical = get_session_store().resolve_canonical(db, settings, raw, touch=True)
        if not canonical:
            raise HTTPException(
                status_code=401,
                detail={"code": "session_expired", "message": "セッションが期限切れです。"},
            )
        user = await get_optional_noraops_user(request, db, settings)
        if user:
            return user.canonical_user_id
        return canonical

    if settings.is_windows_trust_auth:
        ident = get_request_identity(request, db, settings)
        if ident:
            verified_email = parse_verified_email_from_request(request, settings)
            user = await resolve_noraops_user(db, settings, ident, verified_email=verified_email)
            if user:
                if settings.noraops_require_email_activation and not is_user_provisioned(user):
                    raise HTTPException(
                        status_code=403,
                        detail={
                            "code": "registration_incomplete",
                            "message": "メール登録と有効化が完了していません。",
                        },
                    )
                return external_id_for_user(db, user)
        dev_ident = resolve_identity_from_device_token(device_token)
        if dev_ident:
            from app.noraops.auth.identity_resolver import ensure_stub_user

            user = await ensure_stub_user(db, settings, dev_ident)
            if user:
                if settings.noraops_require_email_activation and not is_user_provisioned(user):
                    raise HTTPException(
                        status_code=403,
                        detail={
                            "code": "registration_incomplete",
                            "message": "メール登録と有効化が完了していません。",
                        },
                    )
                return external_id_for_user(db, user)
            return dev_ident.external_id
        raise HTTPException(
            status_code=401,
            detail="windows_trust: IIS 認証またはデバイストークンが必要です。",
        )
    label = (device_label or "").strip()
    if label:
        return label
    import os

    return os.environ.get("USERNAME") or os.environ.get("USER") or "noraops-client"
