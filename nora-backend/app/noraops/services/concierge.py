"""Creator コンシェルジュ: 類似リポ検索 + Copilot 用プロンプト生成。"""

from __future__ import annotations

from typing import Any

from fastapi import Request
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.services.gitea_actor import gitea_client_for_request, gitea_login_for_request
from app.noraops.services.concierge_prompt_template import assemble_copilot_prompt
from app.services.admin_analytics import search_similar_repos
from app.services.gitea_client import GiteaClientError


async def analyze_concierge(
    db: Session,
    settings: Settings,
    *,
    problem: str,
    input_desc: str = "",
    output_desc: str = "",
    request: Request | None = None,
) -> dict[str, Any]:
    query = " ".join(x for x in [problem, input_desc, output_desc] if x.strip())
    try:
        client = await gitea_client_for_request(db, settings, request)
        actor = await gitea_login_for_request(db, settings, request)
        matches = await search_similar_repos(
            db,
            settings,
            query,
            limit=8,
            owner_login=actor,
            gitea_client=client,
        )
    except GiteaClientError:
        raise
    except Exception:
        # Gitea 未設定・接続不可でもプロンプト生成は続行
        matches = []
    recommend = len(matches) > 0
    prompt, template_version, prompt_variables = assemble_copilot_prompt(
        problem=problem,
        input_desc=input_desc,
        output_desc=output_desc,
        recommend_existing=recommend,
        matches=matches,
    )
    summary = (
        f"類似アプリを {len(matches)} 件見つけました。改良をおすすめします。"
        if recommend
        else "類似アプリは見つかりませんでした。新規作成をおすすめします。"
    )
    return {
        "recommendExisting": recommend,
        "matchCount": len(matches),
        "matches": matches,
        "summary": summary,
        "copilotPrompt": prompt,
        "promptTemplateVersion": template_version,
        "promptVariables": prompt_variables,
    }
