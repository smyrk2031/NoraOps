"""NoraOps プロンプト配布 API（環境セットアップ等）。"""

from __future__ import annotations

from fastapi import APIRouter, Query

from app.noraops.services.env_prompt_template import (
    load_env_prompt_template,
    render_env_prompt,
)
from app.noraops.services.builtin_prompt_catalog import load_builtin_catalog

router = APIRouter(prefix="/api/v1/noraops/prompts", tags=["noraops-prompts"])


@router.get("/env-deps")
async def env_deps_prompt(display_name: str = Query(default="このアプリ", max_length=200)) -> dict:
    """Creator 環境モーダル向け — pyproject 未整備時の AI プロンプト。"""
    body, ver = render_env_prompt(display_name)
    template, _ = load_env_prompt_template()
    return {
        "version": ver,
        "prompt": body,
        "template": template,
        "variables": {"display_name": display_name},
    }


@router.get("/builtin-catalog")
async def builtin_prompt_catalog(
    local_version: str = Query(default="", max_length=40),
) -> dict:
    """拡張 Prompt タブ — 基本プロンプトの差分配布。"""
    catalog, ver = load_builtin_catalog()
    out = dict(catalog)
    out["version"] = ver
    out["clientLocalVersion"] = local_version or None
    out["hasUpdate"] = bool(local_version and local_version != ver)
    return out
