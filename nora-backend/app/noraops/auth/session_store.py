"""DB-backed sliding session store for email_otp auth."""

from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db.models import NoraOpsSession


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _naive_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt
    return dt.astimezone(timezone.utc).replace(tzinfo=None)


class SessionStore:
    def create_session(
        self,
        db: Session,
        settings: Settings,
        *,
        canonical_user_id: str,
    ) -> str:
        token = secrets.token_urlsafe(32)
        now = _utcnow()
        idle_days = max(1, int(settings.noraops_session_idle_days))
        abs_days = max(idle_days, int(settings.noraops_session_absolute_days))
        expires = now + timedelta(days=idle_days)
        absolute = now + timedelta(days=abs_days)
        row = NoraOpsSession(
            token_hash=_hash_token(token),
            canonical_user_id=canonical_user_id,
            last_seen_at=_naive_utc(now),
            expires_at=_naive_utc(expires),
            absolute_expires_at=_naive_utc(absolute),
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
        row = db.get(NoraOpsSession, _hash_token(raw))
        if not row:
            return None
        now = _utcnow()
        absolute = (
            row.absolute_expires_at.replace(tzinfo=timezone.utc)
            if row.absolute_expires_at.tzinfo is None
            else row.absolute_expires_at
        )
        if now > absolute:
            db.delete(row)
            db.commit()
            return None
        if touch:
            idle_days = max(1, int(settings.noraops_session_idle_days))
            row.last_seen_at = _naive_utc(now)
            row.expires_at = _naive_utc(now + timedelta(days=idle_days))
            db.commit()
            return row.canonical_user_id
        expires = row.expires_at.replace(tzinfo=timezone.utc) if row.expires_at.tzinfo is None else row.expires_at
        if now > expires:
            db.delete(row)
            db.commit()
            return None
        return row.canonical_user_id

    def revoke(self, db: Session, token: str) -> bool:
        raw = (token or "").strip()
        if not raw:
            return False
        row = db.get(NoraOpsSession, _hash_token(raw))
        if not row:
            return False
        db.delete(row)
        db.commit()
        return True

    def revoke_all_for_user(self, db: Session, canonical_user_id: str) -> int:
        result = db.execute(delete(NoraOpsSession).where(NoraOpsSession.canonical_user_id == canonical_user_id))
        db.commit()
        return int(result.rowcount or 0)


_session_store: SessionStore | None = None


def get_session_store() -> SessionStore:
    global _session_store
    if _session_store is None:
        _session_store = SessionStore()
    return _session_store
