"""Lightweight obfuscation for per-user Gitea PAT at rest (set NORAOPS_USER_TOKEN_SECRET in prod)."""

from __future__ import annotations

import base64
import hashlib

from app.core.config import Settings, get_settings


def _key_bytes(settings: Settings) -> bytes:
    secret = (settings.noraops_user_token_secret or "dev-only").encode("utf-8")
    return hashlib.sha256(secret).digest()


def encrypt_token(plain: str, settings: Settings | None = None) -> str:
    if not plain:
        return ""
    settings = settings or get_settings()
    data = plain.encode("utf-8")
    key = _key_bytes(settings)
    xored = bytes(b ^ key[i % len(key)] for i, b in enumerate(data))
    return base64.urlsafe_b64encode(xored).decode("ascii")


def decrypt_token(cipher: str, settings: Settings | None = None) -> str:
    if not cipher:
        return ""
    settings = settings or get_settings()
    key = _key_bytes(settings)
    try:
        data = base64.urlsafe_b64decode(cipher.encode("ascii"))
    except Exception:
        return ""
    plain = bytes(b ^ key[i % len(key)] for i, b in enumerate(data))
    return plain.decode("utf-8", errors="ignore")
