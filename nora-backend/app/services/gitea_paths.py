"""Gitea インストールパスを gitea.exe / app.ini から解決する。"""

from __future__ import annotations

from configparser import ConfigParser
from dataclasses import dataclass
from pathlib import Path


@dataclass
class GiteaLayout:
    exe_path: Path
    ini_path: Path
    work_path: Path
    repo_root: Path | None
    db_type: str
    db_sqlite_path: Path | None
    db_url: str
    custom_dir: Path


def _find_app_ini(exe: Path) -> Path:
    candidates = [
        exe.parent / "custom" / "conf" / "app.ini",
        exe.parent / "data" / "gitea" / "conf" / "app.ini",
        exe.parent.parent / "custom" / "conf" / "app.ini",
        exe.parent.parent / "data" / "gitea" / "conf" / "app.ini",
    ]
    ini_path = next((p for p in candidates if p.exists()), None)
    if ini_path is None:
        raise FileNotFoundError("app.ini was not found near gitea.exe")
    return ini_path.resolve()


def _resolve_relative(base: Path, raw: str) -> Path:
    p = Path(raw.strip())
    if not raw.strip():
        raise ValueError("empty path")
    if p.is_absolute():
        return p.resolve()
    return (base / p).resolve()


def resolve_gitea_layout(gitea_exe_path: str) -> GiteaLayout:
    exe = Path(gitea_exe_path).resolve()
    if not exe.exists():
        raise FileNotFoundError(f"gitea.exe not found: {exe}")

    ini_path = _find_app_ini(exe)
    work_path = ini_path.parent.parent.parent
    custom_dir = ini_path.parent.parent

    parser = ConfigParser()
    parser.read(ini_path, encoding="utf-8")
    db = parser["database"] if parser.has_section("database") else {}
    db_type = str(db.get("DB_TYPE", "")).lower()
    host = db.get("HOST", "")
    name = db.get("NAME", "")
    user = db.get("USER", "")
    passwd = db.get("PASSWD", "")
    db_path_raw = db.get("PATH", "")

    db_url = ""
    db_sqlite_path: Path | None = None
    if db_type == "postgres":
        db_url = f"postgresql+psycopg://{user}:{passwd}@{host}/{name}"
    elif db_type == "sqlite3":
        if not db_path_raw:
            raise ValueError("sqlite3 PATH is empty in app.ini")
        db_sqlite_path = _resolve_relative(work_path, db_path_raw)

    repo_root: Path | None = None
    if parser.has_section("repository"):
        root_raw = str(parser["repository"].get("ROOT", "")).strip()
        if root_raw:
            repo_root = _resolve_relative(work_path, root_raw)

    return GiteaLayout(
        exe_path=exe,
        ini_path=ini_path,
        work_path=work_path,
        repo_root=repo_root,
        db_type=db_type,
        db_sqlite_path=db_sqlite_path,
        db_url=db_url,
        custom_dir=custom_dir,
    )
