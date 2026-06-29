from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class PushSessionInfo:
    token: str
    subject: str
    expires_at: datetime
    scope: str = "write"


class PushAuthProvider(ABC):
    """Issue short-lived NoraOps session tokens (Phase3: bind to Windows user / OIDC)."""

    @abstractmethod
    def create_push_session(
        self,
        *,
        subject: str | None = None,
        scope: str = "write",
    ) -> PushSessionInfo:
        raise NotImplementedError
