from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from configparser import ConfigParser

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db.models import AppConfig


@dataclass
class RuntimeIntegrationConfig:
    gitea_base_url: str
    gitea_token: str
    gitea_orgs: list[str]
    gitea_list_mode: str
    gitea_default_per_page: int


def _nonempty_db(values: dict[str, str], key: str) -> str | None:
    """Return DB value only if set and non-blank; otherwise caller should use env default."""
    if key not in values:
        return None
    v = values.get(key)
    if v is None or not str(v).strip():
        return None
    return str(v).strip()


class AdminConfigService:
    def __init__(self, db: Session):
        self.db = db

    def get(self, key: str) -> str | None:
        row = self.db.get(AppConfig, key)
        return row.value if row else None

    def set(self, key: str, value: str) -> None:
        row = self.db.get(AppConfig, key)
        if row:
            row.value = value
            row.updated_at = datetime.utcnow()
        else:
            row = AppConfig(key=key, value=value, updated_at=datetime.utcnow())
            self.db.add(row)
        self.db.commit()

    def list_all(self) -> dict[str, str]:
        rows = self.db.query(AppConfig).all()
        return {row.key: row.value for row in rows}

    def resolve_runtime_config(self, settings: Settings) -> RuntimeIntegrationConfig:
        values = self.list_all()
        gitea_orgs_raw = _nonempty_db(values, "gitea_orgs")
        if gitea_orgs_raw is None:
            gitea_orgs_raw = settings.gitea_orgs or ""
        gitea_base = _nonempty_db(values, "gitea_base_url")
        if gitea_base is None:
            gitea_base = settings.gitea_base_url or ""
        gitea_tok = _nonempty_db(values, "gitea_token")
        if gitea_tok is None:
            gitea_tok = settings.gitea_token or ""
        gitea_mode = _nonempty_db(values, "gitea_list_mode")
        if gitea_mode is None:
            gitea_mode = (settings.gitea_list_mode or "instance").strip()
        raw_page = _nonempty_db(values, "gitea_default_per_page")
        if raw_page is None:
            gitea_default_per_page = settings.gitea_default_per_page
        else:
            gitea_default_per_page = int(raw_page)
        return RuntimeIntegrationConfig(
            gitea_base_url=gitea_base,
            gitea_token=gitea_tok,
            gitea_orgs=[x.strip() for x in gitea_orgs_raw.split(",") if x.strip()],
            gitea_list_mode=gitea_mode or "instance",
            gitea_default_per_page=gitea_default_per_page,
        )

    def detect_gitea_db_from_exe(self, gitea_exe_path: str) -> dict[str, str]:
        exe = Path(gitea_exe_path).resolve()
        if not exe.exists():
            raise FileNotFoundError(f"gitea.exe not found: {exe}")
        candidates = [
            exe.parent / "custom" / "conf" / "app.ini",
            exe.parent / "data" / "gitea" / "conf" / "app.ini",
            exe.parent.parent / "custom" / "conf" / "app.ini",
            exe.parent.parent / "data" / "gitea" / "conf" / "app.ini",
        ]
        ini_path = next((p for p in candidates if p.exists()), None)
        if ini_path is None:
            raise FileNotFoundError("app.ini was not found near gitea.exe")

        parser = ConfigParser()
        parser.read(ini_path, encoding="utf-8")
        db = parser["database"] if parser.has_section("database") else {}
        db_type = str(db.get("DB_TYPE", "")).lower()
        host = db.get("HOST", "")
        name = db.get("NAME", "")
        user = db.get("USER", "")
        passwd = db.get("PASSWD", "")
        path = db.get("PATH", "")

        detected = {"db_type": db_type, "ini_path": str(ini_path)}
        if db_type == "postgres":
            detected["db_url"] = f"postgresql+psycopg://{user}:{passwd}@{host}/{name}"
        elif db_type == "sqlite3":
            if not path:
                raise ValueError("sqlite3 PATH is empty in app.ini")
            sqlite_path = Path(path)
            if not sqlite_path.is_absolute():
                sqlite_path = (ini_path.parent / sqlite_path).resolve()
            detected["db_url"] = f"sqlite:///{sqlite_path.as_posix()}"
        else:
            detected["db_url"] = ""
        return detected
