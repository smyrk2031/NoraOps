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
    with engine.begin() as conn:
        if "gitea_repo_id" not in cols:
            logger.info("Adding nora_app_registry.gitea_repo_id column")
            conn.execute(text("ALTER TABLE nora_app_registry ADD COLUMN gitea_repo_id INTEGER"))
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_nora_app_registry_gitea_repo_id "
                    "ON nora_app_registry (gitea_repo_id)"
                )
            )
        cols = {c["name"] for c in inspect(engine).get_columns("nora_app_registry")}
        if "created_by_gitea_login" not in cols:
            logger.info("Adding nora_app_registry.created_by_gitea_login column")
            conn.execute(
                text(
                    "ALTER TABLE nora_app_registry ADD COLUMN created_by_gitea_login VARCHAR(100) DEFAULT ''"
                )
            )
    logger.info("nora_app_registry schema migration complete")
