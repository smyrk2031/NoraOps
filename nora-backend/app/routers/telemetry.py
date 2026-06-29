"""Extension and client telemetry ingest."""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db.models import TelemetryEvent
from app.db.session import get_session

router = APIRouter(prefix="/api/telemetry", tags=["telemetry"])


class TelemetryItem(BaseModel):
    event_type: str = Field(min_length=1, max_length=128)
    source: str = Field(default="extension", max_length=64)
    payload: dict = Field(default_factory=dict)


class TelemetryBatch(BaseModel):
    events: list[TelemetryItem]


async def ingest_core(request: Request, db: Session, events: list[TelemetryItem]) -> dict:
    if not events:
        raise HTTPException(status_code=400, detail="events required")
    ip = request.client.host if request.client else ""
    ua = request.headers.get("user-agent", "")
    for ev in events:
        db.add(
            TelemetryEvent(
                event_type=ev.event_type,
                source=ev.source,
                payload_json=json.dumps(ev.payload or {}, ensure_ascii=False),
                ip=ip,
                user_agent=ua,
            )
        )
    db.commit()
    return {"ingested": len(events)}


@router.post("/events")
async def telemetry_events(envelope: TelemetryBatch, request: Request, db: Session = Depends(get_session)) -> dict:
    return await ingest_core(request, db, envelope.events)


@router.post("/event")
async def telemetry_single(item: TelemetryItem, request: Request, db: Session = Depends(get_session)) -> dict:
    return await ingest_core(request, db, [item])
