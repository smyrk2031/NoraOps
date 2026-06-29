"""Email normalization for identity linking."""

from __future__ import annotations


def normalize_email(email: str) -> str:
    return (email or "").strip().lower()


def email_external_id(email: str) -> str:
    return f"email:{normalize_email(email)}"


def identity_kind(external_id: str) -> str:
    if (external_id or "").startswith("email:"):
        return "email"
    return "windows"
