"""ツール manifest のダウンロード URL を公開ベースに合わせる。

disk 上の manifest が http://127.0.0.1:8000 を参照すると拡張が開発機への誤接続になるため。
"""

from __future__ import annotations

from copy import deepcopy
from urllib.parse import urlparse


def rewrite_tool_download_urls(manifest: dict, public_base: str) -> dict:
    """uv / portableGit の url を ``public_base + パス`` に差し替える。"""
    base = (public_base or "").strip().rstrip("/")
    if not base or not manifest:
        return manifest

    out = deepcopy(manifest)
    for key in ("uv", "portableGit"):
        block = out.get(key)
        if not isinstance(block, dict):
            continue
        u = block.get("url")
        if not u or not isinstance(u, str):
            continue
        try:
            parsed = urlparse(u)
            path = parsed.path or ""
            qs = f"?{parsed.query}" if parsed.query else ""
            block["url"] = f"{base}{path}{qs}"
        except Exception:
            continue
    return out
