"""メール登録・アクティベーション・NoraAccessToken 発行。"""

from __future__ import annotations

import hashlib
import logging
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.root_path import public_base_url
from app.db.models import NoraOpsEmailActivation, NoraOpsIdentityRow, NoraOpsUser
from app.noraops.auth.access_token_store import get_access_token_store
from app.noraops.auth.email_util import email_external_id, normalize_email
from app.noraops.auth.identity import NoraOpsIdentity, identity_from_external_id
from app.noraops.auth.identity_errors import IdentityCollisionError
from app.noraops.auth.identity_resolver import get_user_by_canonical, resolve_identity
from app.noraops.auth.mail_sender import MailDeliveryError, send_mail
from app.services.gitea_client import GiteaClientError
from app.services.gitea_user_provision import GiteaProvisionError, provision_gitea_for_canonical

logger = logging.getLogger(__name__)

RATE_LIMIT_COUNT = 3
RATE_LIMIT_WINDOW_MINUTES = 30


class ActivationRateLimitError(Exception):
    pass


@dataclass
class ActivationResult:
    user: NoraOpsUser
    access_token: str | None = None


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _naive_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt
    return dt.astimezone(timezone.utc).replace(tzinfo=None)


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def is_user_provisioned(user: NoraOpsUser | None) -> bool:
    return bool(user and user.gitea_login and user.gitea_token_encrypted)


def registration_status(user: NoraOpsUser | None, pending_email: str | None = None) -> str:
    if is_user_provisioned(user):
        return "provisioned"
    if pending_email:
        return "pending_activation"
    if user and (user.gitea_login or user.verified_email):
        return "provision_incomplete"
    return "pending_email"


def _check_email_domain(settings: Settings, norm: str) -> None:
    domains = settings.allowed_email_domains
    if not domains:
        return
    part = norm.split("@", 1)[-1].lower()
    if part not in domains:
        raise ValueError(f"許可されていないメールドメインです（{part}）。")


def _check_rate_limit(db: Session, external_id: str) -> None:
    since = _naive_utc(_utcnow() - timedelta(minutes=RATE_LIMIT_WINDOW_MINUTES))
    count = db.scalar(
        select(func.count())
        .select_from(NoraOpsEmailActivation)
        .where(
            NoraOpsEmailActivation.external_id == external_id,
            NoraOpsEmailActivation.created_at >= since,
        )
    )
    if count and int(count) >= RATE_LIMIT_COUNT:
        raise ActivationRateLimitError("Too many activation requests.")


def _activation_url(settings: Settings, token: str) -> str:
    base = public_base_url(None, settings).rstrip("/")
    return f"{base}/api/v1/noraops/auth/activate-email?token={token}"


def _pending_ttl_hours(settings: Settings) -> int:
    if settings.is_email_token_auth:
        return max(1, int(settings.noraops_pending_registration_hours))
    return max(1, int(settings.noraops_activation_ttl_hours))


class EmailActivationService:
    async def request_registration(
        self,
        db: Session,
        settings: Settings,
        *,
        email: str,
    ) -> str:
        """初回登録: メールに有効化リンクを送信。"""
        if not (settings.is_email_token_auth or settings.is_windows_trust_auth):
            raise ValueError("この認証モードでは利用できません。")

        norm = normalize_email(email)
        if not norm or "@" not in norm:
            raise ValueError("メールアドレスが不正です。")
        _check_email_domain(settings, norm)

        ext_id = email_external_id(norm)
        ident = identity_from_external_id(ext_id)
        _check_rate_limit(db, ext_id)
        self.cleanup_expired_pending(db, settings)

        user = await self._resolve_stub_user(db, settings, ident, email_norm=norm)
        if not user:
            raise ValueError("ユーザレコードの作成に失敗しました。")
        if is_user_provisioned(user):
            raise ValueError("既に登録が完了しています。トークン再発行を利用してください。")

        recovered = await self._try_complete_gitea_provision(
            db, settings, user, identity=ident, email=norm
        )
        if recovered:
            raise ValueError(
                "Gitea 登録が完了しました。トークン再発行で NoraAccessToken を取得してください。"
            )

        return await self._send_activation_mail(db, settings, ext_id=ext_id, email=norm)

    async def request_activation(
        self,
        db: Session,
        settings: Settings,
        *,
        external_id: str,
        email: str,
    ) -> str:
        """windows_trust レガシー: device 紐づけ済み identity 向け。"""
        if not settings.is_windows_trust_auth:
            raise ValueError("windows_trust モードでのみ利用できます。")

        norm = normalize_email(email)
        if not norm or "@" not in norm:
            raise ValueError("メールアドレスが不正です。")

        ext_id = (external_id or "").strip()
        if not ext_id:
            raise ValueError("identity が未解決です。")

        ident = identity_from_external_id(ext_id)
        _check_rate_limit(db, ext_id)

        user = await self._resolve_stub_user(db, settings, ident)
        if not user:
            raise ValueError("ユーザレコードの作成に失敗しました。")
        if is_user_provisioned(user):
            raise ValueError("既に Gitea 登録が完了しています。")

        return await self._send_activation_mail(db, settings, ext_id=ext_id, email=norm)

    async def request_reissue(
        self,
        db: Session,
        settings: Settings,
        *,
        email: str,
    ) -> str:
        """本登録済みユーザ向けアクセストークン再発行リンク。"""
        if not settings.is_email_token_auth:
            raise ValueError("email_token モードでのみ利用できます。")

        norm = normalize_email(email)
        if not norm or "@" not in norm:
            raise ValueError("メールアドレスが不正です。")
        _check_email_domain(settings, norm)

        ext_id = email_external_id(norm)
        _check_rate_limit(db, ext_id)

        ident = identity_from_external_id(ext_id)
        user = await self._resolve_stub_user(db, settings, ident, email_norm=norm)
        if not user:
            raise ValueError("アカウントが見つかりません。先に初回登録を行ってください。")

        if not is_user_provisioned(user):
            recovered = await self._try_complete_gitea_provision(
                db, settings, user, identity=ident, email=norm
            )
            if not recovered:
                return await self._send_activation_mail(
                    db,
                    settings,
                    ext_id=ext_id,
                    email=norm,
                    subject="NoraOps アカウント登録の再開",
                    intro="Gitea 登録が未完了です。下の URL で登録を完了してください。",
                )

        return await self._send_activation_mail(
            db,
            settings,
            ext_id=ext_id,
            email=norm,
            subject="NoraOps アクセストークン再発行",
            intro="NoraOps アクセストークンの再発行を完了してください。",
        )

    async def _send_activation_mail(
        self,
        db: Session,
        settings: Settings,
        *,
        ext_id: str,
        email: str,
        subject: str = "NoraOps アカウント登録",
        intro: str = "NoraOps アカウントの登録を完了してください。",
    ) -> str:
        token = secrets.token_urlsafe(32)
        ttl_h = _pending_ttl_hours(settings)
        expires = _naive_utc(_utcnow() + timedelta(hours=ttl_h))

        db.execute(
            delete(NoraOpsEmailActivation).where(
                NoraOpsEmailActivation.external_id == ext_id,
                NoraOpsEmailActivation.consumed == False,  # noqa: E712
            )
        )
        db.add(
            NoraOpsEmailActivation(
                external_id=ext_id,
                email_normalized=email,
                token_hash=_hash_token(token),
                expires_at=expires,
            )
        )
        db.commit()

        url = _activation_url(settings, token)
        body = (
            f"{intro}\n\n"
            f"下の URL をブラウザで開いてください。\n\n"
            f"{url}\n\n"
            f"有効期限: {ttl_h} 時間\n"
            "心当たりがない場合はこのメールを無視してください。"
        )
        html = f"<p>{intro}</p><p><a href=\"{url}\">続ける</a></p><p>有効期限: {ttl_h} 時間</p>"
        try:
            send_mail(settings, to_addr=email, subject=subject, body_text=body, body_html=html)
        except MailDeliveryError:
            raise
        except Exception as e:
            raise MailDeliveryError(str(e)) from e

        return email

    async def activate_token(self, db: Session, settings: Settings, token: str) -> ActivationResult:
        raw = (token or "").strip()
        if len(raw) < 16:
            raise ValueError("トークンが無効です。")

        digest = _hash_token(raw)
        row = db.scalar(
            select(NoraOpsEmailActivation)
            .where(
                NoraOpsEmailActivation.token_hash == digest,
                NoraOpsEmailActivation.consumed == False,  # noqa: E712
            )
            .limit(1)
        )
        if not row:
            raise ValueError("トークンが無効または期限切れです。")

        now = _utcnow()
        expires = row.expires_at.replace(tzinfo=timezone.utc) if row.expires_at.tzinfo is None else row.expires_at
        if now > expires:
            row.consumed = True
            db.commit()
            raise ValueError("トークンの有効期限が切れています。")

        ident = identity_from_external_id(row.external_id)
        user = await self._resolve_stub_user(db, settings, ident, email_norm=row.email_normalized)
        if not user:
            raise ValueError("ユーザが見つかりません。")

        access_token: str | None = None
        if not is_user_provisioned(user):
            user.verified_email = row.email_normalized
            try:
                await provision_gitea_for_canonical(
                    db,
                    settings,
                    user,
                    identity=ident,
                    email=row.email_normalized,
                )
            except GiteaProvisionError as e:
                db.refresh(user)
                hint = e.hint or "GITEA_TOKEN の権限と接続設定を確認してください。"
                raise ValueError(
                    f"Gitea 登録に失敗しました（{e.stage}）: {e} "
                    f"{hint} 設定を直したあと、同じ URL を再度開いてください。"
                ) from e
            except GiteaClientError as e:
                db.refresh(user)
                hint = e.hint or ""
                raise ValueError(
                    f"Gitea API エラー: {e} {hint} 同じ URL を再度開いてください。"
                ) from e

        if settings.is_email_token_auth:
            store = get_access_token_store()
            store.revoke_all_for_user(db, user.canonical_user_id)
            access_token = store.create_token(db, settings, canonical_user_id=user.canonical_user_id)

        row.consumed = True
        db.commit()
        db.refresh(user)
        return ActivationResult(user=user, access_token=access_token)

    def pending_email_for(self, db: Session, external_id: str) -> str | None:
        row = db.scalar(
            select(NoraOpsEmailActivation)
            .where(
                NoraOpsEmailActivation.external_id == external_id,
                NoraOpsEmailActivation.consumed == False,  # noqa: E712
            )
            .order_by(NoraOpsEmailActivation.id.desc())
            .limit(1)
        )
        if not row:
            return None
        expires = row.expires_at.replace(tzinfo=timezone.utc) if row.expires_at.tzinfo is None else row.expires_at
        if _utcnow() > expires:
            return None
        return row.email_normalized

    def cleanup_expired_pending(self, db: Session, settings: Settings) -> int:
        """未完了の仮登録を削除（メールリンク期限切れ）。"""
        now_naive = _naive_utc(_utcnow())
        expired_rows = list(
            db.scalars(
                select(NoraOpsEmailActivation).where(
                    NoraOpsEmailActivation.consumed == False,  # noqa: E712
                    NoraOpsEmailActivation.expires_at < now_naive,
                )
            ).all()
        )
        removed = 0
        for row in expired_rows:
            row.consumed = True
            ident = identity_from_external_id(row.external_id)
            alias = db.get(NoraOpsIdentityRow, ident.external_id)
            if alias:
                user = get_user_by_canonical(db, alias.canonical_user_id)
                if user and not is_user_provisioned(user):
                    db.delete(user)
                    removed += 1
        db.commit()
        return removed

    async def retry_gitea_provision(
        self,
        db: Session,
        settings: Settings,
        *,
        email: str,
    ) -> dict:
        """未完了の Gitea プロビジョンを再試行（管理者設定修正後の復旧用）。"""
        if not (settings.is_email_token_auth or settings.is_windows_trust_auth):
            raise ValueError("この認証モードでは利用できません。")

        norm = normalize_email(email)
        if not norm or "@" not in norm:
            raise ValueError("メールアドレスが不正です。")
        _check_email_domain(settings, norm)

        ext_id = email_external_id(norm)
        ident = identity_from_external_id(ext_id)
        user = await self._resolve_stub_user(db, settings, ident, email_norm=norm)
        if not user:
            raise ValueError("アカウントが見つかりません。先に初回登録を行ってください。")
        if is_user_provisioned(user):
            return {
                "status": "already_provisioned",
                "giteaLogin": user.gitea_login,
                "email": norm,
            }

        try:
            await provision_gitea_for_canonical(
                db,
                settings,
                user,
                identity=ident,
                email=norm,
            )
        except GiteaProvisionError as e:
            db.refresh(user)
            hint = e.hint or "GITEA_TOKEN の権限と接続設定を確認してください。"
            raise ValueError(f"Gitea 登録の再試行に失敗しました（{e.stage}）: {e} {hint}") from e
        except GiteaClientError as e:
            db.refresh(user)
            raise ValueError(f"Gitea API エラー: {e} {e.hint or ''}") from e

        db.commit()
        db.refresh(user)
        if not is_user_provisioned(user):
            raise ValueError("Gitea 登録が完了しませんでした。管理者に連絡してください。")

        return {
            "status": "provisioned",
            "giteaLogin": user.gitea_login,
            "email": norm,
            "hint": "トークン再発行で NoraAccessToken を取得してください。",
        }

    async def _try_complete_gitea_provision(
        self,
        db: Session,
        settings: Settings,
        user: NoraOpsUser,
        *,
        identity: NoraOpsIdentity,
        email: str,
    ) -> bool:
        if is_user_provisioned(user):
            return True
        if not user.gitea_login and not user.verified_email:
            return False
        try:
            await provision_gitea_for_canonical(
                db,
                settings,
                user,
                identity=identity,
                email=email,
            )
        except (GiteaProvisionError, GiteaClientError) as e:
            logger.warning("Gitea auto-recovery failed for %s: %s", email, e)
            db.refresh(user)
            return False
        db.commit()
        db.refresh(user)
        return is_user_provisioned(user)

    async def _resolve_stub_user(
        self,
        db: Session,
        settings: Settings,
        identity: NoraOpsIdentity,
        *,
        email_norm: str = "",
    ) -> NoraOpsUser | None:
        try:
            result = await resolve_identity(
                db,
                settings,
                identity,
                verified_email=email_norm or None,
                auto_provision=False,
                create_stub_if_missing=True,
            )
        except IdentityCollisionError:
            return None
        if not result:
            return None
        return result.user


_activation_service: EmailActivationService | None = None


def get_email_activation_service() -> EmailActivationService:
    global _activation_service
    if _activation_service is None:
        _activation_service = EmailActivationService()
    return _activation_service
