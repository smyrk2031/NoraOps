"""httpx クライアント生成（社内 HTTP_PROXY による誤経路を防ぐ）。"""

from __future__ import annotations

import httpx

from app.core.config import get_settings


def create_async_client(**kwargs) -> httpx.AsyncClient:
    """
    既定で trust_env=False（環境変数 HTTP_PROXY / HTTPS_PROXY を無視）。

    社内 Gitea (127.0.0.1 / プライベート IP) や Azure OpenAI への呼び出しが
    プロキシに奪われて失敗するのを防ぐ。プロキシ必須の外向きのみ
    NORAOPS_HTTP_TRUST_ENV=1 で有効化可能。
    """
    settings = get_settings()
    if "trust_env" not in kwargs:
        kwargs["trust_env"] = bool(settings.noraops_http_trust_env)
    return httpx.AsyncClient(**kwargs)
