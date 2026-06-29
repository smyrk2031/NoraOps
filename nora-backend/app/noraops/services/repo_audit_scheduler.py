"""23:30 夜間リポジトリ監査スケジューラ（Gitea updated_at 差分）。"""

from __future__ import annotations

import asyncio
import logging
import threading
from datetime import date, datetime

from app.core.config import get_settings
from app.noraops.services.repo_audit_service import run_nightly_delta_sync

logger = logging.getLogger(__name__)

_CHECK_INTERVAL_SEC = 60
_lock = threading.Lock()
_running = False
_last_nightly_date: date | None = None


def should_run_nightly_audit(now: datetime | None = None) -> bool:
    settings = get_settings()
    if not settings.noraops_repo_audit_enabled or not settings.noraops_repo_audit_nightly:
        return False
    ref = now or datetime.now()
    if ref.hour != int(settings.noraops_repo_audit_hour):
        return False
    if ref.minute != int(settings.noraops_repo_audit_minute):
        return False
    global _last_nightly_date
    if _last_nightly_date == ref.date():
        return False
    return True


def _run_nightly_sync() -> None:
    global _running, _last_nightly_date
    with _lock:
        if _running:
            return
        _running = True
    try:
        if not should_run_nightly_audit():
            return
        _last_nightly_date = date.today()
        run_nightly_delta_sync()
    except Exception:
        logger.exception("Nightly repo audit scheduler error")
    finally:
        with _lock:
            _running = False


async def repo_audit_scheduler_loop() -> None:
    await asyncio.sleep(45)
    while True:
        try:
            await asyncio.to_thread(_run_nightly_sync)
        except Exception:
            logger.exception("repo audit scheduler tick failed")
        await asyncio.sleep(_CHECK_INTERVAL_SEC)
