"""NoraOps プロンプト配布 API（環境セットアップ等）。"""

from __future__ import annotations

from fastapi import APIRouter, Query

from app.noraops.services.env_prompt_template import (
    load_env_prompt_template,
    render_env_prompt,
)

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
