from __future__ import annotations

import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Literal

from app.noraops.auth.providers import PushAuthProvider, PushSessionInfo

SessionScope = Literal["read", "write"]


@dataclass
class _StoredSession:
    subject: str
    scope: SessionScope
    expires_at: datetime


class PushSessionStore(PushAuthProvider):
    """In-memory short-lived NoraOps tokens (read=artifact download, write=save/push)."""

    def __init__(self, ttl_minutes: int = 15) -> None:
        self._ttl = max(1, ttl_minutes)
        self._sessions: dict[str, _StoredSession] = {}

    def create_push_session(
        self,
        *,
        subject: str | None = None,
        scope: SessionScope = "write",
    ) -> PushSessionInfo:
        self._purge_expired()
        token = secrets.token_urlsafe(32)
        now = datetime.now(timezone.utc)
        expires = now + timedelta(minutes=self._ttl)
        sub = (subject or "").strip() or "noraops-client"
        sc: SessionScope = "read" if scope == "read" else "write"
        self._sessions[token] = _StoredSession(subject=sub, scope=sc, expires_at=expires)
        return PushSessionInfo(token=token, subject=sub, expires_at=expires, scope=sc)

    def validate(self, token: str, *, scope: SessionScope | None = None) -> _StoredSession | None:
        self._purge_expired()
        raw = (token or "").strip()
        if not raw:
            return None
        row = self._sessions.get(raw)
        if not row:
            return None
        if row.expires_at <= datetime.now(timezone.utc):
            self._sessions.pop(raw, None)
            return None
        if scope and row.scope != scope:
            return None
        return row

    def _purge_expired(self) -> None:
        now = datetime.now(timezone.utc)
        dead = [k for k, v in self._sessions.items() if v.expires_at <= now]
        for k in dead:
            self._sessions.pop(k, None)
