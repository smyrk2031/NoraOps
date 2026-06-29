"""DB-backed long-lived NoraOps access tokens (email_token auth)."""

from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db.models import NoraOpsAccessToken


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _naive_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt
    return dt.astimezone(timezone.utc).replace(tzinfo=None)


class AccessTokenStore:
    def create_token(
        self,
        db: Session,
        settings: Settings,
        *,
        canonical_user_id: str,
        label: str = "default",
    ) -> str:
        token = secrets.token_urlsafe(32)
        now = _utcnow()
        days = int(settings.noraops_access_token_days or 0)
        expires_at = None
        if days > 0:
            expires_at = _naive_utc(now + timedelta(days=days))
        row = NoraOpsAccessToken(
            token_hash=_hash_token(token),
            canonical_user_id=canonical_user_id,
            label=(label or "default")[:64],
            expires_at=expires_at,
            created_at=_naive_utc(now),
            last_used_at=_naive_utc(now),
        )
        db.add(row)
        db.commit()
        return token

    def resolve_canonical(
        self,
        db: Session,
        settings: Settings,
        token: str,
        *,
        touch: bool = True,
    ) -> str | None:
        raw = (token or "").strip()
        if not raw:
            return None
        row = db.get(NoraOpsAccessToken, _hash_token(raw))
        if not row:
            return None
        now = _utcnow()
        if row.expires_at is not None:
            expires = (
                row.expires_at.replace(tzinfo=timezone.utc)
                if row.expires_at.tzinfo is None
                else row.expires_at
            )
            if now > expires:
                db.delete(row)
                db.commit()
                return None
        if touch:
            row.last_used_at = _naive_utc(now)
            db.commit()
        return row.canonical_user_id

    def revoke_all_for_user(self, db: Session, canonical_user_id: str) -> int:
        result = db.execute(
            delete(NoraOpsAccessToken).where(NoraOpsAccessToken.canonical_user_id == canonical_user_id)
        )
        db.commit()
        return int(result.rowcount or 0)


_access_token_store: AccessTokenStore | None = None


def get_access_token_store() -> AccessTokenStore:
    global _access_token_store
    if _access_token_store is None:
        _access_token_store = AccessTokenStore()
    return _access_token_store
