"""Email normalization for identity linking."""

from __future__ import annotations


def normalize_email(email: str) -> str:
    return (email or "").strip().lower()


def email_external_id(email: str) -> str:
    return f"email:{normalize_email(email)}"


def identity_kind(external_id: str) -> str:
    ext = external_id or ""
    if ext.startswith("email:"):
        return "email"
    if ext.startswith("manual:"):
        return "manual"
    return "windows"


def manual_external_id(slug: str) -> str:
    return f"manual:{(slug or '').strip()}"
