"""Check rules distribution for NoraOps4code (FastAPI-17)."""

from __future__ import annotations

from fastapi import APIRouter, Header, Response

from app.noraops.services.rules_loader import load_rules_bundle

router = APIRouter(prefix="/api/v1/checks", tags=["noraops-checks"])


@router.get("/rules", response_model=None)
async def get_check_rules(
    response: Response,
    if_none_match: str | None = Header(default=None, alias="If-None-Match"),
):
    bundle = load_rules_bundle()
    etag = bundle["etag"]
    response.headers["ETag"] = f'"{etag}"'
    if if_none_match and if_none_match.strip('"') == etag:
        return Response(status_code=304)
    return bundle
