"""Migrate legacy noraops_users (external_id PK) to canonical + identities schema."""

from __future__ import annotations

import logging
import uuid

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

logger = logging.getLogger(__name__)


def migrate_identity_schema(engine: Engine) -> None:
    insp = inspect(engine)
    tables = set(insp.get_table_names())
    if "noraops_users" not in tables:
        return

    cols = {c["name"] for c in insp.get_columns("noraops_users")}
    if "canonical_user_id" in cols:
        return

    logger.info("Migrating noraops_users from external_id PK to canonical_user_id schema")
    is_sqlite = engine.dialect.name == "sqlite"

    with engine.begin() as conn:
        if is_sqlite:
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS noraops_users_new (
                        canonical_user_id VARCHAR(36) PRIMARY KEY,
                        gitea_login VARCHAR(100) NOT NULL,
                        gitea_id INTEGER NOT NULL DEFAULT 0,
                        verified_email VARCHAR(256) NOT NULL DEFAULT '',
                        gitea_token_encrypted TEXT NOT NULL DEFAULT '',
                        created_at DATETIME NOT NULL,
                        last_seen_at DATETIME NOT NULL
                    )
                    """
                )
            )
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS noraops_identities (
                        external_id VARCHAR(256) PRIMARY KEY,
                        canonical_user_id VARCHAR(36) NOT NULL,
                        kind VARCHAR(32) NOT NULL,
                        email VARCHAR(256) NOT NULL DEFAULT '',
                        created_at DATETIME NOT NULL,
                        FOREIGN KEY(canonical_user_id) REFERENCES noraops_users_new(canonical_user_id) ON DELETE CASCADE
                    )
                    """
                )
            )
            rows = conn.execute(
                text(
                    "SELECT external_id, gitea_login, gitea_id, email, gitea_token_encrypted, created_at, last_seen_at "
                    "FROM noraops_users"
                )
            ).fetchall()
            for row in rows:
                cid = str(uuid.uuid4())
                conn.execute(
                    text(
                        """
                        INSERT INTO noraops_users_new
                        (canonical_user_id, gitea_login, gitea_id, verified_email, gitea_token_encrypted, created_at, last_seen_at)
                        VALUES (:cid, :login, :gid, :email, :tok, :created, :seen)
                        """
                    ),
                    {
                        "cid": cid,
                        "login": row.gitea_login,
                        "gid": row.gitea_id,
                        "email": row.email or "",
                        "tok": row.gitea_token_encrypted or "",
                        "created": row.created_at,
                        "seen": row.last_seen_at,
                    },
                )
                kind = "email" if str(row.external_id).startswith("email:") else "windows"
                conn.execute(
                    text(
                        """
                        INSERT INTO noraops_identities (external_id, canonical_user_id, kind, email, created_at)
                        VALUES (:ext, :cid, :kind, :email, :created)
                        """
                    ),
                    {
                        "ext": row.external_id,
                        "cid": cid,
                        "kind": kind,
                        "email": row.email or "",
                        "created": row.created_at,
                    },
                )
            conn.execute(text("DROP TABLE noraops_users"))
            conn.execute(text("ALTER TABLE noraops_users_new RENAME TO noraops_users"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_noraops_users_gitea_login ON noraops_users (gitea_login)"))
            conn.execute(
                text("CREATE INDEX IF NOT EXISTS ix_noraops_users_verified_email ON noraops_users (verified_email)")
            )
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_noraops_identities_canonical_user_id "
                    "ON noraops_identities (canonical_user_id)"
                )
            )
        else:
            conn.execute(text("ALTER TABLE noraops_users ADD COLUMN canonical_user_id VARCHAR(36)"))
            conn.execute(text("ALTER TABLE noraops_users ADD COLUMN verified_email VARCHAR(256) DEFAULT ''"))
            rows = conn.execute(
                text(
                    "SELECT external_id, gitea_login, gitea_id, email, gitea_token_encrypted, created_at, last_seen_at "
                    "FROM noraops_users"
                )
            ).fetchall()
            for row in rows:
                cid = str(uuid.uuid4())
                conn.execute(
                    text("UPDATE noraops_users SET canonical_user_id = :cid, verified_email = :email WHERE external_id = :ext"),
                    {"cid": cid, "email": row.email or "", "ext": row.external_id},
                )
                kind = "email" if str(row.external_id).startswith("email:") else "windows"
                conn.execute(
                    text(
                        """
                        INSERT INTO noraops_identities (external_id, canonical_user_id, kind, email, created_at)
                        VALUES (:ext, :cid, :kind, :email, :created)
                        ON CONFLICT (external_id) DO NOTHING
                        """
                    ),
                    {
                        "ext": row.external_id,
                        "cid": cid,
                        "kind": kind,
                        "email": row.email or "",
                        "created": row.created_at,
                    },
                )
            conn.execute(text("ALTER TABLE noraops_users DROP CONSTRAINT noraops_users_pkey"))
            conn.execute(text("ALTER TABLE noraops_users DROP COLUMN external_id"))
            conn.execute(text("ALTER TABLE noraops_users ADD PRIMARY KEY (canonical_user_id)"))

    logger.info("noraops_users identity migration complete")
