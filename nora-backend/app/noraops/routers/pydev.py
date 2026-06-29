"""Internal PyPI mirror (pydev) — future."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api/v1/pydev", tags=["noraops-pydev"])


@router.get("/status")
async def pydev_status() -> dict:
    return {"enabled": False, "phase": "future"}
