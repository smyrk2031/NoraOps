"""Admin CRUD for all NoraOps users (email, manual, windows, etc.)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db.models import AppRegistryEntry, NoraOpsAccessToken, NoraOpsIdentityRow, NoraOpsUser
from app.noraops.auth.access_token_store import get_access_token_store
from app.noraops.auth.email_activation_service import is_user_provisioned
from app.noraops.auth.email_util import normalize_email
from app.noraops.auth.identity import identity_from_external_id
from app.services.admin_config_service import AdminConfigService
from app.services.gitea_client import GiteaClient, GiteaClientError
from app.services.gitea_user_provision import GiteaProvisionError, provision_gitea_for_canonical


@dataclass
class AdminUserIdentity:
    external_id: str
    kind: str
    label: str


@dataclass
class AdminUserRow:
    canonical_user_id: str
    verified_email: str
    gitea_login: str
    gitea_id: int
    provisioned: bool
    has_access_token: bool
    identity_kinds: list[str]
    identities: list[AdminUserIdentity]
    owned_app_count: int
    created_at: datetime
    last_seen_at: datetime


def _identity_label(alias: NoraOpsIdentityRow) -> str:
    if alias.kind == "manual":
        return (alias.email or "").strip() or alias.external_id
    if alias.email:
        return alias.email
    return alias.external_id


def _status(row: AdminUserRow) -> str:
    if row.provisioned:
        return "provisioned"
    if row.gitea_login:
        return "gitea_incomplete"
    if row.verified_email or any(i.kind != "manual" for i in row.identities):
        return "pending"
    return "pending"


def admin_user_to_dict(row: AdminUserRow) -> dict:
    kinds = sorted(set(row.identity_kinds))
    primary_kind = kinds[0] if len(kinds) == 1 else ("mixed" if kinds else "unknown")
    return {
        "canonicalUserId": row.canonical_user_id,
        "verifiedEmail": row.verified_email or None,
        "giteaLogin": row.gitea_login or None,
        "giteaId": row.gitea_id or None,
        "status": _status(row),
        "provisioned": row.provisioned,
        "hasAccessToken": row.has_access_token,
        "identityKind": primary_kind,
        "identityKinds": kinds,
        "identities": [
            {"externalId": i.external_id, "kind": i.kind, "label": i.label}
            for i in row.identities
        ],
        "ownedAppCount": row.owned_app_count,
        "createdAt": row.created_at.isoformat() if row.created_at else None,
        "lastSeenAt": row.last_seen_at.isoformat() if row.last_seen_at else None,
    }


def _owned_app_counts(db: Session, logins: list[str]) -> dict[str, int]:
    clean = [l.strip() for l in logins if l and l.strip()]
    if not clean:
        return {}
    rows = db.execute(
        select(AppRegistryEntry.created_by_gitea_login, func.count())
        .where(AppRegistryEntry.created_by_gitea_login.in_(clean))
        .group_by(AppRegistryEntry.created_by_gitea_login)
    ).all()
    return {str(login): int(count) for login, count in rows}


def _to_row(
    db: Session,
    user: NoraOpsUser,
    aliases: list[NoraOpsIdentityRow],
    *,
    owned_app_count: int = 0,
) -> AdminUserRow:
    token_count = db.scalar(
        select(func.count())
        .select_from(NoraOpsAccessToken)
        .where(NoraOpsAccessToken.canonical_user_id == user.canonical_user_id)
    )
    identities = [
        AdminUserIdentity(
            external_id=a.external_id,
            kind=a.kind,
            label=_identity_label(a),
        )
        for a in aliases
    ]
    kinds = [a.kind for a in aliases]
    return AdminUserRow(
        canonical_user_id=user.canonical_user_id,
        verified_email=(user.verified_email or "").strip(),
        gitea_login=user.gitea_login or "",
        gitea_id=int(user.gitea_id or 0),
        provisioned=is_user_provisioned(user),
        has_access_token=bool(token_count and int(token_count) > 0),
        identity_kinds=kinds,
        identities=identities,
        owned_app_count=owned_app_count,
        created_at=user.created_at,
        last_seen_at=user.last_seen_at,
    )


def list_admin_users(db: Session, *, query: str = "", limit: int = 500) -> list[AdminUserRow]:
    q = (query or "").strip().lower()
    cap = max(1, min(limit, 2000))

    if q:
        like = f"%{q}%"
        user_ids: set[str] = set(
            db.scalars(
                select(NoraOpsUser.canonical_user_id).where(
                    or_(
                        func.lower(NoraOpsUser.verified_email).like(like),
                        func.lower(NoraOpsUser.gitea_login).like(like),
                        NoraOpsUser.canonical_user_id.like(like),
                    )
                )
            ).all()
        )
        user_ids.update(
            db.scalars(
                select(NoraOpsIdentityRow.canonical_user_id).where(
                    or_(
                        func.lower(NoraOpsIdentityRow.email).like(like),
                        func.lower(NoraOpsIdentityRow.external_id).like(like),
                    )
                )
            ).all()
        )
        if not user_ids:
            return []
        users = list(
            db.scalars(
                select(NoraOpsUser)
                .where(NoraOpsUser.canonical_user_id.in_(user_ids))
                .order_by(NoraOpsUser.created_at.desc())
                .limit(cap)
            ).all()
        )
    else:
        users = list(
            db.scalars(select(NoraOpsUser).order_by(NoraOpsUser.created_at.desc()).limit(cap)).all()
        )

    if not users:
        return []

    ids = [u.canonical_user_id for u in users]
    alias_rows = list(
        db.scalars(
            select(NoraOpsIdentityRow)
            .where(NoraOpsIdentityRow.canonical_user_id.in_(ids))
            .order_by(NoraOpsIdentityRow.created_at.asc())
        ).all()
    )
    aliases_by_user: dict[str, list[NoraOpsIdentityRow]] = {}
    for alias in alias_rows:
        aliases_by_user.setdefault(alias.canonical_user_id, []).append(alias)

    owned_counts = _owned_app_counts(db, [u.gitea_login for u in users])
    rows: list[AdminUserRow] = []
    for user in users:
        login = (user.gitea_login or "").strip()
        rows.append(
            _to_row(
                db,
                user,
                aliases_by_user.get(user.canonical_user_id, []),
                owned_app_count=owned_counts.get(login, 0),
            )
        )
    return rows


def get_admin_user(db: Session, canonical_user_id: str) -> AdminUserRow | None:
    user = db.get(NoraOpsUser, canonical_user_id.strip())
    if not user:
        return None
    aliases = list(
        db.scalars(
            select(NoraOpsIdentityRow)
            .where(NoraOpsIdentityRow.canonical_user_id == user.canonical_user_id)
            .order_by(NoraOpsIdentityRow.created_at.asc())
        ).all()
    )
    owned = _owned_app_counts(db, [user.gitea_login or ""])
    login = (user.gitea_login or "").strip()
    return _to_row(db, user, aliases, owned_app_count=owned.get(login, 0))


def _primary_identity(aliases: list[NoraOpsIdentityRow]) -> NoraOpsIdentityRow:
    if not aliases:
        raise ValueError("identity が見つかりません。")
    return aliases[0]


async def retry_admin_user_gitea(
    db: Session,
    settings: Settings,
    canonical_user_id: str,
) -> AdminUserRow:
    row = get_admin_user(db, canonical_user_id)
    if not row:
        raise ValueError("ユーザが見つかりません。")
    user = db.get(NoraOpsUser, canonical_user_id)
    assert user is not None
    if is_user_provisioned(user):
        return row

    aliases = list(
        db.scalars(
            select(NoraOpsIdentityRow)
            .where(NoraOpsIdentityRow.canonical_user_id == canonical_user_id)
            .order_by(NoraOpsIdentityRow.created_at.asc())
        ).all()
    )
    alias = _primary_identity(aliases)
    ident = identity_from_external_id(alias.external_id)
    email = (user.verified_email or alias.email or "").strip() or None
    try:
        await provision_gitea_for_canonical(
            db,
            settings,
            user,
            identity=ident,
            email=email,
        )
    except (GiteaProvisionError, GiteaClientError) as e:
        db.refresh(user)
        hint = getattr(e, "hint", None) or ""
        raise ValueError(f"Gitea 再試行に失敗しました: {e} {hint}") from e

    db.commit()
    db.refresh(user)
    if not is_user_provisioned(user):
        raise ValueError("Gitea 登録が完了しませんでした。")
    updated = get_admin_user(db, canonical_user_id)
    assert updated is not None
    return updated


def issue_admin_access_token(
    db: Session,
    settings: Settings,
    canonical_user_id: str,
) -> tuple[AdminUserRow, str]:
    row = get_admin_user(db, canonical_user_id)
    if not row:
        raise ValueError("ユーザが見つかりません。")
    user = db.get(NoraOpsUser, canonical_user_id)
    assert user is not None
    if not is_user_provisioned(user):
        raise ValueError("Gitea 登録が未完了です。先に Gitea 登録を完了してください。")

    store = get_access_token_store()
    store.revoke_all_for_user(db, user.canonical_user_id)
    token = store.create_token(
        db,
        settings,
        canonical_user_id=user.canonical_user_id,
        label="admin-issue",
    )
    updated = get_admin_user(db, canonical_user_id)
    assert updated is not None
    return updated, token


def update_admin_user_email(
    db: Session,
    canonical_user_id: str,
    *,
    verified_email: str,
) -> AdminUserRow:
    user = db.get(NoraOpsUser, canonical_user_id.strip())
    if not user:
        raise ValueError("ユーザが見つかりません。")
    norm = normalize_email(verified_email)
    if not norm:
        raise ValueError("メールアドレスを入力してください。")
    user.verified_email = norm
    db.commit()
    db.refresh(user)
    updated = get_admin_user(db, canonical_user_id)
    assert updated is not None
    return updated


async def delete_admin_user(
    db: Session,
    settings: Settings,
    canonical_user_id: str,
) -> None:
    user = db.get(NoraOpsUser, canonical_user_id.strip())
    if not user:
        raise ValueError("ユーザが見つかりません。")

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
    db.delete(user)
    db.commit()
