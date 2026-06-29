"""Device registration codes and long-lived device tokens for VS Code extension."""

from __future__ import annotations

import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone


@dataclass
class _DeviceCode:
    external_id: str
    expires_at: datetime


@dataclass
class _DeviceToken:
    external_id: str
    expires_at: datetime


class DeviceAuthStore:
    def __init__(self) -> None:
        self._codes: dict[str, _DeviceCode] = {}
        self._tokens: dict[str, _DeviceToken] = {}

    def issue_code(self, external_id: str, *, ttl_minutes: int = 5) -> str:
        self._purge()
        code = f"{secrets.randbelow(900000) + 100000:06d}"
        self._codes[code] = _DeviceCode(
            external_id=external_id,
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=ttl_minutes),
        )
        return code

    def exchange_code(self, code: str, *, token_days: int = 30) -> str | None:
        self._purge()
        row = self._codes.pop((code or "").strip(), None)
        if not row or row.expires_at <= datetime.now(timezone.utc):
            return None
        token = secrets.token_urlsafe(32)
        self._tokens[token] = _DeviceToken(
            external_id=row.external_id,
            expires_at=datetime.now(timezone.utc) + timedelta(days=token_days),
        )
        return token

    def resolve_token(self, token: str) -> str | None:
        self._purge()
        row = self._tokens.get((token or "").strip())
        if not row or row.expires_at <= datetime.now(timezone.utc):
            return None
        return row.external_id

    def _purge(self) -> None:
        now = datetime.now(timezone.utc)
        self._codes = {k: v for k, v in self._codes.items() if v.expires_at > now}
        self._tokens = {k: v for k, v in self._tokens.items() if v.expires_at > now}


_device_store: DeviceAuthStore | None = None


def get_device_store() -> DeviceAuthStore:
    global _device_store
    if _device_store is None:
        _device_store = DeviceAuthStore()
    return _device_store
