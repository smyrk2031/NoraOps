from __future__ import annotations

from fastapi import Header, HTTPException

from app.core.config import Settings, get_settings
from app.noraops.auth.store import PushSessionStore

_store: PushSessionStore | None = None


def get_push_session_store(settings: Settings = None) -> PushSessionStore:
    global _store
    if _store is None:
        s = settings or get_settings()
        _store = PushSessionStore(ttl_minutes=s.noraops_push_session_ttl_minutes)
    return _store


def _extract_push_token(
    authorization: str | None,
    x_noraops_push_token: str | None,
) -> str | None:
    if x_noraops_push_token and x_noraops_push_token.strip():
        return x_noraops_push_token.strip()
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return None


async def require_push_session(
    authorization: str | None = Header(None),
    x_noraops_push_token: str | None = Header(None, alias="X-NoraOps-Push-Token"),
) -> str:
    """Write scope: save zip / git bundle push."""
    return await _require_session(scope="write", authorization=authorization, x_noraops_push_token=x_noraops_push_token)


async def require_read_session(
    authorization: str | None = Header(None),
    x_noraops_push_token: str | None = Header(None, alias="X-NoraOps-Push-Token"),
) -> str:
    """Read scope: artifact download."""
    return await _require_session(scope="read", authorization=authorization, x_noraops_push_token=x_noraops_push_token)


async def _require_session(
    *,
    scope: str,
    authorization: str | None,
    x_noraops_push_token: str | None,
) -> str:
    token = _extract_push_token(authorization, x_noraops_push_token)
    if not token:
        raise HTTPException(status_code=401, detail="NoraOps session token required.")
    store = get_push_session_store(get_settings())
    row = store.validate(token, scope=scope)  # type: ignore[arg-type]
    if not row and scope == "read":
        row = store.validate(token, scope="write")
    if not row:
        raise HTTPException(status_code=401, detail="Session expired, invalid, or wrong scope.")
    return token
