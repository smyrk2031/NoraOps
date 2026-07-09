"""Parse trusted identity headers (IIS Windows Authentication)."""

from __future__ import annotations

import re
from dataclasses import dataclass

from starlette.requests import Request

from app.core.config import Settings, get_settings

_LOGIN_SAFE = re.compile(r"[^a-zA-Z0-9._-]+")


@dataclass(frozen=True)
class NoraOpsIdentity:
    external_id: str
    domain: str
    username: str
    raw: str

    @property
    def gitea_login_candidate(self) -> str:
        base = (self.username or "user").strip().lower()
        base = _LOGIN_SAFE.sub("_", base).strip("_") or "user"
        return base[:40]


def _header_candidates(settings: Settings) -> list[str]:
    primary = (settings.noraops_trusted_user_header or "X-Remote-User").strip()
    names = []
    if primary:
        names.append(primary)
    for h in ("X-Remote-User", "Remote-User", "X-Forwarded-User"):
        if h not in names:
            names.append(h)
    return names


def parse_identity_from_request(request: Request, settings: Settings | None = None) -> NoraOpsIdentity | None:
    settings = settings or get_settings()
    raw = ""
    for name in _header_candidates(settings):
        val = request.headers.get(name) or request.headers.get(name.lower())
        if val and val.strip():
            raw = val.strip()
            break
    if not raw:
        return None
    domain, user = "", raw
    if "\\" in raw:
        domain, user = raw.split("\\", 1)
    elif "@" in raw and not raw.startswith("@"):
        user, domain = raw.split("@", 1)
    domain = domain.strip()
    user = user.strip()
    if not user:
        return None
    ext = f"{domain}\\{user}" if domain else user
    return NoraOpsIdentity(external_id=ext, domain=domain, username=user, raw=raw)


def identity_from_external_id(external_id: str) -> NoraOpsIdentity:
    ext = (external_id or "").strip()
    if ext.startswith("email:"):
        email = ext.removeprefix("email:")
        local = email.split("@", 1)[0] if "@" in email else email
        return NoraOpsIdentity(external_id=ext, domain="", username=local, raw=email)
    if ext.startswith("manual:"):
        slug = ext.removeprefix("manual:").strip() or "user"
        return NoraOpsIdentity(external_id=ext, domain="", username=slug, raw=ext)
    domain, user = "", ext
    if "\\" in ext:
        domain, user = ext.split("\\", 1)
    domain = domain.strip()
    user = user.strip()
    return NoraOpsIdentity(external_id=ext, domain=domain, username=user, raw=ext)


def parse_verified_email_from_request(request: Request, settings: Settings | None = None) -> str | None:
    """AD mail or IIS-forwarded email header (Windows auto-link)."""
    settings = settings or get_settings()
    primary = (settings.noraops_trusted_email_header or "X-Remote-Email").strip()
    names = []
    if primary:
        names.append(primary)
    for h in ("X-Remote-Email", "Remote-Email", "X-Forwarded-Email"):
        if h not in names:
            names.append(h)
    for name in names:
        val = request.headers.get(name) or request.headers.get(name.lower())
        if val and val.strip():
            return val.strip()
    return None
