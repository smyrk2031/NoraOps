"""Add gitea_repo_id to nora_app_registry (Phase 4)."""

from __future__ import annotations

import logging

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

logger = logging.getLogger(__name__)


def migrate_registry_schema(engine: Engine) -> None:
    insp = inspect(engine)
    if "nora_app_registry" not in set(insp.get_table_names()):
        return

    cols = {c["name"] for c in insp.get_columns("nora_app_registry")}
    if "gitea_repo_id" in cols:
        return

    logger.info("Adding nora_app_registry.gitea_repo_id column")
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE nora_app_registry ADD COLUMN gitea_repo_id INTEGER"))
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_nora_app_registry_gitea_repo_id "
                "ON nora_app_registry (gitea_repo_id)"
            )
        )
    logger.info("nora_app_registry gitea_repo_id migration complete")
