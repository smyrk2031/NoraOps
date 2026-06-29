"""IP セキュリティチェック用 allowlist（sec.ip_literal）。"""

from __future__ import annotations

DEFAULT_IP_ALLOWLIST: tuple[str, ...] = ("127.0.0.1", "0.0.0.0", "::1", "8.8.8.8")
DEFAULT_IPV6_ALLOWLIST: tuple[str, ...] = ("::1",)


def _dedupe_preserve(items: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for item in items:
        key = str(item).lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(str(item))
    return out


def merge_security_allowlist(doc: dict | None) -> dict:
    """サーバー配信 JSON に既定 allowlist を必ず含める（8.8.8.8 等）。"""
    base = dict(doc or {})
    allow = dict(base.get("allowlist") or {})
    ips = _dedupe_preserve([*(allow.get("ips") or []), *DEFAULT_IP_ALLOWLIST])
    ipv6 = _dedupe_preserve([*(allow.get("ipv6") or []), *DEFAULT_IPV6_ALLOWLIST])
    return {**base, "allowlist": {"ips": ips, "ipv6": ipv6}}
