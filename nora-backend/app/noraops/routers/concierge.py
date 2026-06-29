"""Creator コンシェルジュ API。"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.db.session import get_session
from app.noraops.services.concierge import analyze_concierge
from app.noraops.services.concierge_prompt_template import (
    list_template_placeholders,
    load_prompt_template,
)
from app.services.gitea_client import GiteaClientError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/noraops/concierge", tags=["noraops-concierge"])


@router.get("/prompt-template")
async def concierge_prompt_template() -> dict:
    """
    Copilot プロンプトの本文テンプレート（`data/noraops/concierge/copilot-prompt-template.md`）。
    拡張が `promptVariables` と合成して最新フォーマットを反映するために利用。
    """
    body, ver = load_prompt_template()
    return {
        "version": ver,
        "template": body,
        "placeholders": list_template_placeholders(body),
    }


class ConciergeRequest(BaseModel):
    problem: str = Field(min_length=3, max_length=2000)
    input_desc: str = Field(default="", max_length=2000)
    output_desc: str = Field(default="", max_length=2000)


@router.post("/analyze")
async def concierge_analyze(
    body: ConciergeRequest,
    request: Request,
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> dict:
    try:
        return await analyze_concierge(
            db,
            settings,
            problem=body.problem,
            input_desc=body.input_desc,
            output_desc=body.output_desc,
            request=request,
        )
    except GiteaClientError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:
        logger.exception("concierge analyze failed")
        raise HTTPException(status_code=500, detail=f"concierge failed: {e}") from e
