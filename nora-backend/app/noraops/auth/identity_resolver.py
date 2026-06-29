"""Resolve external identities to canonical NoraOps users with auto-linking."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db.models import NoraOpsIdentityRow, NoraOpsUser
from app.noraops.auth.email_util import email_external_id, identity_kind, normalize_email
from app.noraops.auth.identity import NoraOpsIdentity
from app.noraops.auth.identity_errors import IdentityCollisionError
from app.services.gitea_user_provision import provision_gitea_for_canonical


@dataclass
class ResolveResult:
    user: NoraOpsUser
    external_id: str
    created: bool
    linked: bool


def get_identity_row(db: Session, external_id: str) -> NoraOpsIdentityRow | None:
    return db.get(NoraOpsIdentityRow, external_id)


def get_user_by_canonical(db: Session, canonical_user_id: str) -> NoraOpsUser | None:
    return db.get(NoraOpsUser, canonical_user_id)


def primary_external_id(db: Session, user: NoraOpsUser) -> str:
    row = db.scalar(
        select(NoraOpsIdentityRow)
        .where(NoraOpsIdentityRow.canonical_user_id == user.canonical_user_id)
        .order_by(NoraOpsIdentityRow.created_at.asc())
        .limit(1)
    )
    return row.external_id if row else user.canonical_user_id


def _find_users_by_verified_email(db: Session, email: str) -> list[NoraOpsUser]:
    norm = normalize_email(email)
    if not norm:
        return []
    return list(db.scalars(select(NoraOpsUser).where(NoraOpsUser.verified_email == norm)).all())


def _check_email_collision(db: Session, email: str) -> None:
    users = _find_users_by_verified_email(db, email)
    logins = sorted({u.gitea_login for u in users if u.gitea_login})
    if len(logins) > 1:
        raise IdentityCollisionError(email, logins)


def _add_alias(
    db: Session,
    *,
    external_id: str,
    canonical_user_id: str,
    kind: str,
    email: str = "",
) -> NoraOpsIdentityRow:
    row = NoraOpsIdentityRow(
        external_id=external_id,
        canonical_user_id=canonical_user_id,
        kind=kind,
        email=email,
    )
    db.add(row)
    return row


async def resolve_identity(
    db: Session,
    settings: Settings,
    identity: NoraOpsIdentity,
    *,
    verified_email: str | None = None,
    auto_provision: bool | None = None,
    create_stub_if_missing: bool = False,
) -> ResolveResult | None:
    if not identity or not identity.external_id:
        return None

    ext_id = identity.external_id.strip()
    kind = identity_kind(ext_id)
    email_norm = normalize_email(verified_email or "")
    if kind == "email" and not email_norm:
        email_norm = normalize_email(ext_id.removeprefix("email:"))

    existing_alias = get_identity_row(db, ext_id)
    if existing_alias:
        user = get_user_by_canonical(db, existing_alias.canonical_user_id)
        if user:
            user.last_seen_at = datetime.now(timezone.utc)
            if email_norm and not user.verified_email:
                _check_email_collision(db, email_norm)
                user.verified_email = email_norm
            db.commit()
            return ResolveResult(user=user, external_id=ext_id, created=False, linked=False)

    if email_norm:
        _check_email_collision(db, email_norm)
        matches = _find_users_by_verified_email(db, email_norm)
        if len(matches) == 1:
            user = matches[0]
            _add_alias(db, external_id=ext_id, canonical_user_id=user.canonical_user_id, kind=kind, email=email_norm)
            user.last_seen_at = datetime.now(timezone.utc)
            db.commit()
            db.refresh(user)
            return ResolveResult(user=user, external_id=ext_id, created=False, linked=True)

    if auto_provision is None:
        auto_provision = settings.noraops_gitea_auto_provision
    if settings.is_windows_trust_auth and settings.noraops_require_email_activation:
        auto_provision = False
    if settings.is_email_token_auth:
        auto_provision = False
    if not auto_provision:
        if create_stub_if_missing:
            canonical_id = str(uuid.uuid4())
            user = NoraOpsUser(
                canonical_user_id=canonical_id,
                gitea_login="",
                verified_email=email_norm,
            )
            db.add(user)
            _add_alias(db, external_id=ext_id, canonical_user_id=canonical_id, kind=kind, email=email_norm)
            db.commit()
            db.refresh(user)
            return ResolveResult(user=user, external_id=ext_id, created=True, linked=False)
        return None

    canonical_id = str(uuid.uuid4())
    user = NoraOpsUser(
        canonical_user_id=canonical_id,
        gitea_login="",
        verified_email=email_norm,
    )
    db.add(user)
    _add_alias(db, external_id=ext_id, canonical_user_id=canonical_id, kind=kind, email=email_norm)

    provisioned = await provision_gitea_for_canonical(
        db,
        settings,
        user,
        identity=identity,
        email=email_norm or None,
    )
    if not provisioned:
        db.rollback()
        return None

    db.commit()
    db.refresh(user)
    return ResolveResult(user=user, external_id=ext_id, created=True, linked=False)


async def resolve_identity_by_external_id(
    db: Session,
    settings: Settings,
    external_id: str,
    *,
    verified_email: str | None = None,
    auto_provision: bool | None = None,
    create_stub_if_missing: bool = False,
) -> ResolveResult | None:
    from app.noraops.auth.identity import identity_from_external_id

    ident = identity_from_external_id(external_id)
    return await resolve_identity(
        db,
        settings,
        ident,
        verified_email=verified_email,
        auto_provision=auto_provision,
        create_stub_if_missing=create_stub_if_missing,
    )


async def ensure_stub_user(
    db: Session,
    settings: Settings,
    identity: NoraOpsIdentity,
) -> NoraOpsUser | None:
    """windows_trust: identity 行と stub ユーザを用意（Gitea はメール有効化後）。"""
    result = await resolve_identity(
        db,
        settings,
        identity,
        auto_provision=False,
        create_stub_if_missing=True,
    )
    return result.user if result else None
