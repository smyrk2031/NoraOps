"""Admin-only manual user provisioning (no email)."""

from __future__ import annotations

import hashlib
import re
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db.models import NoraOpsAccessToken, NoraOpsIdentityRow, NoraOpsUser
from app.noraops.auth.access_token_store import get_access_token_store
from app.noraops.auth.email_activation_service import is_user_provisioned
from app.noraops.auth.email_util import identity_kind, manual_external_id
from app.noraops.auth.identity import NoraOpsIdentity, identity_from_external_id
from app.services.admin_config_service import AdminConfigService
from app.services.gitea_client import GiteaClient, GiteaClientError
from app.services.gitea_user_provision import GiteaProvisionError, provision_gitea_for_canonical

_LOGIN_SAFE = re.compile(r"[^a-zA-Z0-9._-]+")


@dataclass
class ManualUserRow:
    canonical_user_id: str
    external_id: str
    memo: str
    gitea_login: str
    gitea_id: int
    provisioned: bool
    has_access_token: bool
    created_at: datetime
    last_seen_at: datetime


@dataclass
class ManualUserCreateResult:
    user: ManualUserRow
    access_token: str
    gitea_login: str


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def slugify_manual_login(memo: str, explicit: str = "") -> str:
    hint = (explicit or "").strip().lower()
    hint = _LOGIN_SAFE.sub("_", hint).strip("_")
    if hint:
        return hint[:40]
    ascii_part = _LOGIN_SAFE.sub("_", (memo or "").strip().lower()).strip("_")
    if len(ascii_part) >= 3:
        return ascii_part[:40]
    digest = hashlib.sha256((memo or "user").encode("utf-8")).hexdigest()[:8]
    return f"manual_{digest}"


def _unique_manual_slug(db: Session, base: str) -> str:
    candidate = base[:40] or "manual_user"
    for suffix in range(0, 51):
        slug = candidate if suffix == 0 else f"{candidate}_{suffix}"[:40]
        ext_id = manual_external_id(slug)
        if not db.get(NoraOpsIdentityRow, ext_id):
            return slug
    return f"manual_{uuid.uuid4().hex[:8]}"


def _identity_row_for_user(db: Session, user: NoraOpsUser) -> NoraOpsIdentityRow | None:
    return db.scalar(
        select(NoraOpsIdentityRow)
        .where(
            NoraOpsIdentityRow.canonical_user_id == user.canonical_user_id,
            NoraOpsIdentityRow.kind == "manual",
        )
        .order_by(NoraOpsIdentityRow.created_at.asc())
        .limit(1)
    )


def _to_row(db: Session, user: NoraOpsUser, alias: NoraOpsIdentityRow) -> ManualUserRow:
    token_count = db.scalar(
        select(func.count())
        .select_from(NoraOpsAccessToken)
        .where(NoraOpsAccessToken.canonical_user_id == user.canonical_user_id)
    )
    return ManualUserRow(
        canonical_user_id=user.canonical_user_id,
        external_id=alias.external_id,
        memo=(alias.email or "").strip(),
        gitea_login=user.gitea_login or "",
        gitea_id=int(user.gitea_id or 0),
        provisioned=is_user_provisioned(user),
        has_access_token=bool(token_count and int(token_count) > 0),
        created_at=user.created_at,
        last_seen_at=user.last_seen_at,
    )


def manual_user_to_dict(row: ManualUserRow) -> dict:
    status = "provisioned" if row.provisioned else ("gitea_incomplete" if row.gitea_login else "pending")
    return {
        "canonicalUserId": row.canonical_user_id,
        "externalId": row.external_id,
        "memo": row.memo,
        "giteaLogin": row.gitea_login or None,
        "giteaId": row.gitea_id or None,
        "status": status,
        "provisioned": row.provisioned,
        "hasAccessToken": row.has_access_token,
        "createdAt": row.created_at.isoformat() if row.created_at else None,
        "lastSeenAt": row.last_seen_at.isoformat() if row.last_seen_at else None,
    }


def list_manual_users(db: Session) -> list[ManualUserRow]:
    aliases = list(
        db.scalars(
            select(NoraOpsIdentityRow)
            .where(NoraOpsIdentityRow.kind == "manual")
            .order_by(NoraOpsIdentityRow.created_at.desc())
        ).all()
    )
    rows: list[ManualUserRow] = []
    for alias in aliases:
        user = db.get(NoraOpsUser, alias.canonical_user_id)
        if user:
            rows.append(_to_row(db, user, alias))
    return rows


def get_manual_user(db: Session, canonical_user_id: str) -> tuple[NoraOpsUser, NoraOpsIdentityRow] | None:
    alias = db.scalar(
        select(NoraOpsIdentityRow)
        .where(
            NoraOpsIdentityRow.canonical_user_id == canonical_user_id,
            NoraOpsIdentityRow.kind == "manual",
        )
        .limit(1)
    )
    if not alias:
        return None
    user = db.get(NoraOpsUser, canonical_user_id)
    if not user:
        return None
    return user, alias


async def create_manual_user(
    db: Session,
    settings: Settings,
    *,
    memo: str,
    gitea_login_hint: str = "",
) -> ManualUserCreateResult:
    note = (memo or "").strip()
    if not note:
        raise ValueError("メモ（識別用ラベル）を入力してください。")
    if len(note) > 200:
        raise ValueError("メモは 200 文字以内にしてください。")

    base_slug = slugify_manual_login(note, gitea_login_hint)
    slug = _unique_manual_slug(db, base_slug)
    ext_id = manual_external_id(slug)
    if identity_kind(ext_id) != "manual":
        raise ValueError("内部 ID の生成に失敗しました。")

    ident = identity_from_external_id(ext_id)
    canonical_id = str(uuid.uuid4())
    user = NoraOpsUser(
        canonical_user_id=canonical_id,
        gitea_login=(gitea_login_hint or "").strip()[:100],
        verified_email="",
    )
    db.add(user)
    db.add(
        NoraOpsIdentityRow(
            external_id=ext_id,
            canonical_user_id=canonical_id,
            kind="manual",
            email=note,
        )
    )
    db.commit()
    db.refresh(user)

    try:
        await provision_gitea_for_canonical(
            db,
            settings,
            user,
            identity=ident,
            email=None,
        )
    except (GiteaProvisionError, GiteaClientError) as e:
        db.refresh(user)
        hint = getattr(e, "hint", None) or "GITEA_TOKEN と接続設定を確認してください。"
        raise ValueError(f"Gitea 登録に失敗しました: {e} {hint}") from e

    db.commit()
    db.refresh(user)
    if not is_user_provisioned(user):
        raise ValueError("Gitea 登録が完了しませんでした。")

    store = get_access_token_store()
    access_token = store.create_token(
        db,
        settings,
        canonical_user_id=user.canonical_user_id,
        label="admin-manual",
    )
    alias = db.get(NoraOpsIdentityRow, ext_id)
    assert alias is not None
    row = _to_row(db, user, alias)
    return ManualUserCreateResult(user=row, access_token=access_token, gitea_login=user.gitea_login or "")


async def retry_manual_gitea(
    db: Session,
    settings: Settings,
    canonical_user_id: str,
) -> ManualUserRow:
    found = get_manual_user(db, canonical_user_id)
    if not found:
        raise ValueError("手動ユーザが見つかりません。")
    user, alias = found
    if is_user_provisioned(user):
        return _to_row(db, user, alias)

    ident = identity_from_external_id(alias.external_id)
    try:
        await provision_gitea_for_canonical(
            db,
            settings,
            user,
            identity=ident,
            email=None,
        )
    except (GiteaProvisionError, GiteaClientError) as e:
        db.refresh(user)
        hint = getattr(e, "hint", None) or ""
        raise ValueError(f"Gitea 再試行に失敗しました: {e} {hint}") from e

    db.commit()
    db.refresh(user)
    if not is_user_provisioned(user):
        raise ValueError("Gitea 登録が完了しませんでした。")
    return _to_row(db, user, alias)


def issue_manual_access_token(
    db: Session,
    settings: Settings,
    canonical_user_id: str,
) -> tuple[ManualUserRow, str]:
    found = get_manual_user(db, canonical_user_id)
    if not found:
        raise ValueError("手動ユーザが見つかりません。")
    user, alias = found
    if not is_user_provisioned(user):
        raise ValueError("Gitea 登録が未完了です。先に Gitea 登録を完了してください。")

    store = get_access_token_store()
    store.revoke_all_for_user(db, user.canonical_user_id)
    token = store.create_token(
        db,
        settings,
        canonical_user_id=user.canonical_user_id,
        label="admin-manual",
    )
    db.refresh(user)
    return _to_row(db, user, alias), token


async def delete_manual_user(
    db: Session,
    settings: Settings,
    canonical_user_id: str,
) -> None:
    found = get_manual_user(db, canonical_user_id)
    if not found:
        raise ValueError("手動ユーザが見つかりません。")
    user, alias = found

    login = (user.gitea_login or "").strip()
    if login:
        cfg = AdminConfigService(db).resolve_runtime_config(settings)
        if cfg.gitea_base_url and cfg.gitea_token:
            client = GiteaClient(cfg)
            try:
                await client.admin_delete_user(login)
            except GiteaClientError as e:
                raise ValueError(f"Gitea ユーザの削除に失敗しました: {e}") from e

    store = get_access_token_store()
    store.revoke_all_for_user(db, user.canonical_user_id)
    db.delete(alias)
    db.delete(user)
    db.commit()
