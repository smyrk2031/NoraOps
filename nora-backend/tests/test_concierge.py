"""コンシェルジュ（Gitea なしでもプロンプト生成）。"""

import asyncio
from unittest.mock import MagicMock

from app.core.config import Settings
from app.noraops.services.concierge import analyze_concierge
from app.noraops.services.concierge_prompt_template import assemble_copilot_prompt


def test_analyze_concierge_without_gitea(monkeypatch):
    settings = Settings(SOFTRAIL_HOST="127.0.0.1", SOFTRAIL_PORT=8000, GITEA_BASE_URL="")

    async def _empty(*_a, **_k):
        return []

    monkeypatch.setattr(
        "app.noraops.services.concierge.search_similar_repos",
        _empty,
    )

    db = MagicMock()
    out = asyncio.run(
        analyze_concierge(
            db,
            settings,
            problem="在庫管理したい",
            input_desc="CSV",
            output_desc="一覧画面",
        )
    )
    assert out["recommendExisting"] is False
    assert "在庫管理" in out["copilotPrompt"]
    assert out["matchCount"] == 0
    assert "promptVariables" in out
    assert out["promptVariables"]["problem"] == "在庫管理したい"


def test_assemble_copilot_prompt_with_match():
    prompt, _, vars_map = assemble_copilot_prompt(
        problem="在庫",
        input_desc="",
        output_desc="",
        recommend_existing=True,
        matches=[{"full_name": "org/inv", "description": "inventory"}],
    )
    assert "org/inv" in prompt
    assert "改良" in prompt or "既存" in prompt
    assert "org/inv" in vars_map["repo_guidance"]
