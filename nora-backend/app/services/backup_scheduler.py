"""24 時間間隔の自動バックアップスケジューラ。"""

from __future__ import annotations

import asyncio
import logging
import threading

from app.core.config import get_settings
from app.db.session import get_session
from app.services.backup_service import create_backup, should_run_scheduled_backup

logger = logging.getLogger(__name__)

_CHECK_INTERVAL_SEC = 3600
_lock = threading.Lock()
_running = False


def _run_scheduled_backup_sync() -> None:
    global _running
    with _lock:
        if _running:
            return
        _running = True
    try:
        settings = get_settings()
        db = next(get_session())
        try:
            if not should_run_scheduled_backup(settings, db):
                return
            logger.info("Starting scheduled NoraOps backup")
            result = create_backup(settings, db, trigger="scheduled")
            if result.ok:
                logger.info("Scheduled backup completed: %s (%s)", result.backup_id, result.message)
            else:
                logger.error("Scheduled backup failed: %s", result.message)
        finally:
            db.close()
    except Exception:
        logger.exception("Scheduled backup error")
    finally:
        with _lock:
            _running = False


async def backup_scheduler_loop() -> None:
    await asyncio.sleep(30)
    while True:
        try:
            await asyncio.to_thread(_run_scheduled_backup_sync)
        except Exception:
            logger.exception("backup scheduler tick failed")
        await asyncio.sleep(_CHECK_INTERVAL_SEC)
