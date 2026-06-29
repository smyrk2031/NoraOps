"""Classify GITEA_TOKEN values and surface common misconfiguration."""

from __future__ import annotations

import re

_LEGACY_HEX_RE = re.compile(r"^[0-9a-fA-F]{40}$")


def classify_gitea_token(token: str) -> dict[str, str | bool | None]:
    raw = (token or "").strip()
    if not raw:
        return {
            "configured": False,
            "format": "missing",
            "issue": "missing",
            "hint": "nora-backend/.env に GITEA_TOKEN を設定してください。",
        }
    if raw.startswith("gitea_pat_"):
        return {"configured": True, "format": "scoped_pat", "issue": None, "hint": None}
    if _LEGACY_HEX_RE.fullmatch(raw):
        # Gitea 1.26 でも生成直後のトークンは 40 文字 hex で表示される（正常）
        return {"configured": True, "format": "hex_pat", "issue": None, "hint": None}
    return {
        "configured": True,
        "format": "other",
        "issue": None,
        "hint": None,
    }


def parse_gitea_scope_error(body: str) -> str | None:
    text = (body or "").strip()
    if not text:
        return None
    if "required scope" in text.lower() or "required=[" in text:
        return text
    return None
