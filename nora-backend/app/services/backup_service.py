"""NoraOps バックアップ・切り戻し・部分復元。"""

from __future__ import annotations

import json
import logging
import shutil
import sqlite3
import subprocess
import tempfile
import zipfile
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

import pyzipper

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.services.admin_config_service import AdminConfigService
from app.services.data_bootstrap import resolve_data_root
from app.services.gitea_paths import GiteaLayout, resolve_gitea_layout
from app.services.system_dashboard import format_bytes

logger = logging.getLogger(__name__)

BACKUP_SCHEMA = "nora.backup/1"
BACKUP_PREFIX = "noraops-backup-"

# manifest / API で使うコンポーネント ID
COMPONENT_BACKEND_DB = "backend.db"
COMPONENT_BACKEND_NORAOPS = "backend.noraops_core"
COMPONENT_BACKEND_ARTIFACTS = "backend.artifacts"
COMPONENT_BACKEND_TOOLS = "backend.tools"
COMPONENT_GITEA_CONFIG = "gitea.config"
COMPONENT_GITEA_DB = "gitea.db"
COMPONENT_GITEA_REPOS = "gitea.repos"

COMPONENT_LABELS: dict[str, str] = {
    COMPONENT_BACKEND_DB: "バックエンド DB (SQLite: softrail.db / Postgres: softrail.sql)",
    COMPONENT_BACKEND_NORAOPS: "NoraOps 設定 (checks / MCP / prompts 等)",
    COMPONENT_BACKEND_ARTIFACTS: "Runner 成果物 (artifacts)",
    COMPONENT_BACKEND_TOOLS: "配布ツール (tools)",
    COMPONENT_GITEA_CONFIG: "Gitea 設定 (app.ini)",
    COMPONENT_GITEA_DB: "Gitea DB",
    COMPONENT_GITEA_REPOS: "Gitea リポジトリ実体",
}

DEFAULT_BACKUP_COMPONENTS = [
    COMPONENT_BACKEND_DB,
    COMPONENT_BACKEND_NORAOPS,
    COMPONENT_GITEA_CONFIG,
    COMPONENT_GITEA_DB,
    COMPONENT_GITEA_REPOS,
]

NORAOPS_CORE_REL_PATHS = (
    "noraops/checks",
    "noraops/mcp",
    "noraops/prompts",
    "noraops/concierge",
    "noraops/client-latest.json",
    "noraops/ai-usage.json",
)


@dataclass
class BackupSettings:
    enabled: bool
    interval_hours: int
    retention: int
    local_dir: Path
    remote_dir: Path | None
    include_artifacts: bool
    include_tools: bool


@dataclass
class BackupRunResult:
    ok: bool
    backup_id: str | None
    zip_path: Path | None
    remote_path: Path | None
    size_bytes: int
    message: str
    warnings: list[str]
    components: list[str]


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _backup_id_from_dt(dt: datetime | None = None) -> str:
    dt = dt or datetime.now(timezone.utc)
    # 秒精度だと連続バックアップ（テスト・pre-restore）が同一 ID で上書きされる
    return dt.strftime("%Y%m%d-%H%M%S") + f"-{dt.microsecond:06d}"


def _manifest_sidecar_path(zip_path: Path) -> Path:
    return zip_path.with_suffix(".manifest.json")


def _zip_password_bytes(settings: Settings) -> bytes | None:
    pwd = (settings.noraops_backup_zip_password or "").strip()
    return pwd.encode("utf-8") if pwd else None


def _sidecar_encrypted(zip_path: Path) -> bool:
    sidecar = _manifest_sidecar_path(zip_path)
    if not sidecar.is_file():
        return False
    try:
        return bool(json.loads(sidecar.read_text(encoding="utf-8")).get("zip_encrypted"))
    except (json.JSONDecodeError, OSError):
        return False


@contextmanager
def _open_backup_zip_write(path: Path, settings: Settings) -> Iterator[zipfile.ZipFile | pyzipper.AESZipFile]:
    pwd = _zip_password_bytes(settings)
    if pwd:
        with pyzipper.AESZipFile(
            path,
            "w",
            compression=pyzipper.ZIP_DEFLATED,
            encryption=pyzipper.WZ_AES,
        ) as zf:
            zf.setpassword(pwd)
            yield zf
    else:
        with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            yield zf


@contextmanager
def _open_backup_zip_read(path: Path, settings: Settings) -> Iterator[zipfile.ZipFile | pyzipper.AESZipFile]:
    if _sidecar_encrypted(path):
        pwd = _zip_password_bytes(settings)
        if not pwd:
            raise ValueError(
                "このバックアップは ZIP パスワードで暗号化されています。"
                "NORAOPS_BACKUP_ZIP_PASSWORD を設定してください。"
            )
        with pyzipper.AESZipFile(path, "r") as zf:
            zf.setpassword(pwd)
            yield zf
    else:
        with zipfile.ZipFile(path, "r") as zf:
            yield zf


def resolve_backup_settings(settings: Settings, db: Session | None = None) -> BackupSettings:
    values: dict[str, str] = {}
    if db is not None:
        values = AdminConfigService(db).list_all()

    def _bool(key: str, env_default: bool) -> bool:
        raw = values.get(key)
        if raw is not None and str(raw).strip():
            return str(raw).strip().lower() in ("1", "true", "yes", "on")
        return env_default

    def _int(key: str, env_default: int) -> int:
        raw = values.get(key)
        if raw is not None and str(raw).strip():
            try:
                return max(1, int(str(raw).strip()))
            except ValueError:
                pass
        return env_default

    def _path(key: str, env_default: str) -> Path:
        raw = values.get(key)
        if raw is not None and str(raw).strip():
            return Path(str(raw).strip()).resolve()
        return Path(env_default).resolve()

    remote_raw = values.get("backup_remote_dir")
    if remote_raw is None or not str(remote_raw).strip():
        remote_raw = settings.noraops_backup_remote_dir
    remote_dir = Path(str(remote_raw).strip()).resolve() if str(remote_raw or "").strip() else None

    return BackupSettings(
        enabled=_bool("backup_enabled", settings.noraops_backup_enabled),
        interval_hours=_int("backup_interval_hours", settings.noraops_backup_interval_hours),
        retention=_int("backup_retention", settings.noraops_backup_retention),
        local_dir=_path("backup_local_dir", settings.noraops_backup_local_dir),
        remote_dir=remote_dir,
        include_artifacts=_bool("backup_include_artifacts", settings.noraops_backup_include_artifacts),
        include_tools=_bool("backup_include_tools", settings.noraops_backup_include_tools),
    )


def _resolve_gitea_layout_from_db(db: Session) -> GiteaLayout | None:
    svc = AdminConfigService(db)
    exe_path = svc.get("gitea_exe_path")
    if not exe_path or not str(exe_path).strip():
        return None
    try:
        return resolve_gitea_layout(str(exe_path).strip())
    except (FileNotFoundError, ValueError) as e:
        logger.warning("Gitea layout resolve failed: %s", e)
        return None


def _backend_uses_postgres(settings: Settings) -> bool:
    if settings.db_url.strip():
        return "postgres" in settings.db_url.lower()
    return settings.db_backend.lower() == "postgres"


def _backend_db_url(settings: Settings) -> str:
    from app.db.session import resolve_database_url

    return resolve_database_url(settings)


def _normalize_pg_cli_url(db_url: str) -> str:
    url = db_url.strip()
    for prefix in ("postgresql+psycopg://", "postgresql+psycopg2://"):
        if url.startswith(prefix):
            return "postgresql://" + url[len(prefix) :]
    return url


def _sqlite_backup(src_path: Path, dest_path: Path) -> None:
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    if not src_path.is_file():
        raise FileNotFoundError(f"sqlite db not found: {src_path}")
    src = sqlite3.connect(str(src_path))
    try:
        dest = sqlite3.connect(str(dest_path))
        try:
            src.backup(dest)
        finally:
            dest.close()
    finally:
        src.close()


def _add_tree_to_zip(
    zf: zipfile.ZipFile,
    src: Path,
    arc_prefix: str,
    component_id: str,
    manifest: dict[str, Any],
) -> None:
    if not src.exists():
        return
    total = 0
    file_count = 0
    if src.is_file():
        arc = f"{arc_prefix}/{src.name}".replace("\\", "/")
        zf.write(src, arcname=arc)
        total = src.stat().st_size
        file_count = 1
    else:
        for fp in sorted(src.rglob("*")):
            if fp.is_symlink() or not fp.is_file():
                continue
            rel = fp.relative_to(src)
            arc = f"{arc_prefix}/{rel.as_posix()}"
            zf.write(fp, arcname=arc)
            try:
                total += fp.stat().st_size
                file_count += 1
            except OSError:
                pass
    manifest["components"][component_id] = {
        "path": arc_prefix,
        "bytes": total,
        "file_count": file_count,
        "source": str(src),
    }


def _dump_postgres(db_url: str, dest_sql: Path) -> None:
    """Postgres を pg_dump で SQL 化（--clean 付き・復元用）。"""
    url = _normalize_pg_cli_url(db_url)
    dest_sql.parent.mkdir(parents=True, exist_ok=True)
    proc = subprocess.run(
        [
            "pg_dump",
            url,
            "-f",
            str(dest_sql),
            "--clean",
            "--if-exists",
            "--no-owner",
            "--no-acl",
        ],
        capture_output=True,
        text=True,
        timeout=600,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or "pg_dump failed")


def _restore_postgres(db_url: str, sql_path: Path) -> None:
    """pg_dump 出力 SQL を psql で適用。"""
    url = _normalize_pg_cli_url(db_url)
    if not sql_path.is_file():
        raise FileNotFoundError(f"sql dump not found: {sql_path}")
    proc = subprocess.run(
        ["psql", url, "-v", "ON_ERROR_STOP=1", "-f", str(sql_path)],
        capture_output=True,
        text=True,
        timeout=600,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or "psql restore failed")


def _components_for_run(cfg: BackupSettings) -> list[str]:
    comps = list(DEFAULT_BACKUP_COMPONENTS)
    if cfg.include_artifacts:
        comps.append(COMPONENT_BACKEND_ARTIFACTS)
    if cfg.include_tools:
        comps.append(COMPONENT_BACKEND_TOOLS)
    return comps


def create_backup(
    settings: Settings,
    db: Session,
    *,
    trigger: str = "manual",
    components: list[str] | None = None,
) -> BackupRunResult:
    cfg = resolve_backup_settings(settings, db)
    cfg.local_dir.mkdir(parents=True, exist_ok=True)

    backup_id = _backup_id_from_dt()
    zip_path = cfg.local_dir / f"{BACKUP_PREFIX}{backup_id}.zip"
    warnings: list[str] = []
    manifest: dict[str, Any] = {
        "schema": BACKUP_SCHEMA,
        "backup_id": backup_id,
        "created_at": _utc_now_iso(),
        "trigger": trigger,
        "components": {},
        "warnings": warnings,
    }

    data_root = resolve_data_root(settings)
    manifest["backend_data_root"] = str(data_root)
    gitea_layout = _resolve_gitea_layout_from_db(db)
    if gitea_layout:
        manifest["gitea"] = {
            "exe_path": str(gitea_layout.exe_path),
            "ini_path": str(gitea_layout.ini_path),
            "work_path": str(gitea_layout.work_path),
            "repo_root": str(gitea_layout.repo_root) if gitea_layout.repo_root else None,
            "db_type": gitea_layout.db_type,
        }
    else:
        manifest["gitea"] = {"detected": False}
        warnings.append("Gitea パス未検出 — 接続設定で gitea.exe を登録してください。")

    use_components = components or _components_for_run(cfg)
    manifest["zip_encrypted"] = bool(_zip_password_bytes(settings))

    with tempfile.TemporaryDirectory(prefix="noraops-backup-") as tmp:
        tmp_path = Path(tmp)
        with _open_backup_zip_write(zip_path, settings) as zf:
            if COMPONENT_BACKEND_DB in use_components:
                if _backend_uses_postgres(settings):
                    tmp_sql = tmp_path / "backend" / "softrail.sql"
                    try:
                        _dump_postgres(_backend_db_url(settings), tmp_sql)
                        zf.write(tmp_sql, arcname="backend/softrail.sql")
                        manifest["backend_db_format"] = "postgres"
                        manifest["components"][COMPONENT_BACKEND_DB] = {
                            "path": "backend/softrail.sql",
                            "format": "postgres",
                            "bytes": tmp_sql.stat().st_size,
                            "source": "pg_dump",
                        }
                    except (RuntimeError, FileNotFoundError, subprocess.TimeoutExpired) as e:
                        warnings.append(f"バックエンド Postgres dump 失敗: {e}")
                else:
                    db_src = settings.sqlite_abs_path
                    if db_src.is_file():
                        tmp_db = tmp_path / "softrail.db"
                        _sqlite_backup(db_src, tmp_db)
                        zf.write(tmp_db, arcname="backend/softrail.db")
                        manifest["backend_db_format"] = "sqlite"
                        manifest["components"][COMPONENT_BACKEND_DB] = {
                            "path": "backend/softrail.db",
                            "format": "sqlite",
                            "bytes": tmp_db.stat().st_size,
                            "source": str(db_src),
                        }
                    else:
                        warnings.append(f"softrail.db が見つかりません: {db_src}")

            if COMPONENT_BACKEND_NORAOPS in use_components:
                for rel in NORAOPS_CORE_REL_PATHS:
                    src = data_root / rel
                    if src.is_file():
                        arc = f"backend/{rel}"
                        zf.write(src, arcname=arc)
                    elif src.is_dir():
                        for fp in sorted(src.rglob("*")):
                            if fp.is_symlink() or not fp.is_file():
                                continue
                            arc = f"backend/{rel}/{fp.relative_to(src).as_posix()}"
                            zf.write(fp, arcname=arc)
                manifest["components"][COMPONENT_BACKEND_NORAOPS] = {
                    "path": "backend/noraops_core/",
                    "source": str(data_root),
                    "items": list(NORAOPS_CORE_REL_PATHS),
                }

            if COMPONENT_BACKEND_ARTIFACTS in use_components:
                art = settings.artifacts_abs_dir
                if art.is_dir():
                    _add_tree_to_zip(zf, art, "backend/artifacts", COMPONENT_BACKEND_ARTIFACTS, manifest)
                else:
                    warnings.append("artifacts ディレクトリがありません。")

            if COMPONENT_BACKEND_TOOLS in use_components:
                tools = data_root / "tools"
                if tools.is_dir():
                    _add_tree_to_zip(zf, tools, "backend/tools", COMPONENT_BACKEND_TOOLS, manifest)

            if gitea_layout:
                if COMPONENT_GITEA_CONFIG in use_components and gitea_layout.ini_path.is_file():
                    zf.write(gitea_layout.ini_path, arcname="gitea/custom/conf/app.ini")
                    manifest["components"][COMPONENT_GITEA_CONFIG] = {
                        "path": "gitea/custom/conf/app.ini",
                        "bytes": gitea_layout.ini_path.stat().st_size,
                        "source": str(gitea_layout.ini_path),
                    }

                if COMPONENT_GITEA_DB in use_components:
                    if gitea_layout.db_type == "sqlite3" and gitea_layout.db_sqlite_path:
                        tmp_gitea_db = tmp_path / "gitea" / "gitea.db"
                        try:
                            _sqlite_backup(gitea_layout.db_sqlite_path, tmp_gitea_db)
                            zf.write(tmp_gitea_db, arcname="gitea/data/gitea.db")
                            manifest["components"][COMPONENT_GITEA_DB] = {
                                "path": "gitea/data/gitea.db",
                                "bytes": tmp_gitea_db.stat().st_size,
                                "source": str(gitea_layout.db_sqlite_path),
                            }
                        except OSError as e:
                            warnings.append(f"Gitea DB バックアップ失敗: {e}")
                    elif gitea_layout.db_type == "postgres" and gitea_layout.db_url:
                        tmp_sql = tmp_path / "gitea" / "gitea.sql"
                        try:
                            _dump_postgres(gitea_layout.db_url, tmp_sql)
                            zf.write(tmp_sql, arcname="gitea/data/gitea.sql")
                            manifest["components"][COMPONENT_GITEA_DB] = {
                                "path": "gitea/data/gitea.sql",
                                "bytes": tmp_sql.stat().st_size,
                                "source": "postgres dump",
                            }
                        except (RuntimeError, FileNotFoundError, subprocess.TimeoutExpired) as e:
                            warnings.append(f"Gitea Postgres dump 失敗: {e}")

                if COMPONENT_GITEA_REPOS in use_components and gitea_layout.repo_root:
                    if gitea_layout.repo_root.is_dir():
                        _add_tree_to_zip(
                            zf,
                            gitea_layout.repo_root,
                            "gitea/repositories",
                            COMPONENT_GITEA_REPOS,
                            manifest,
                        )
                    else:
                        warnings.append(f"Gitea リポジトリ ROOT が見つかりません: {gitea_layout.repo_root}")
            else:
                for comp in (COMPONENT_GITEA_CONFIG, COMPONENT_GITEA_DB, COMPONENT_GITEA_REPOS):
                    if comp in use_components:
                        warnings.append(f"{COMPONENT_LABELS.get(comp, comp)} は Gitea 未検出のためスキップ。")

            manifest["warnings"] = warnings
            zf.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))

    size_bytes = zip_path.stat().st_size if zip_path.is_file() else 0
    _manifest_sidecar_path(zip_path).write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    remote_path: Path | None = None
    if cfg.remote_dir:
        try:
            cfg.remote_dir.mkdir(parents=True, exist_ok=True)
            remote_path = cfg.remote_dir / zip_path.name
            shutil.copy2(zip_path, remote_path)
            shutil.copy2(_manifest_sidecar_path(zip_path), _manifest_sidecar_path(remote_path))
        except OSError as e:
            warnings.append(f"リモートコピー失敗 ({cfg.remote_dir}): {e}")

    _apply_retention(cfg)
    _record_backup_state(db, backup_id, ok=True, message="backup completed", warnings=warnings)

    return BackupRunResult(
        ok=True,
        backup_id=backup_id,
        zip_path=zip_path,
        remote_path=remote_path,
        size_bytes=size_bytes,
        message=f"バックアップ完了 ({format_bytes(size_bytes)})",
        warnings=warnings,
        components=use_components,
    )


def _apply_retention(cfg: BackupSettings) -> None:
    for directory in _unique_dirs(cfg.local_dir, cfg.remote_dir):
        zips = sorted(directory.glob(f"{BACKUP_PREFIX}*.zip"), key=lambda p: p.name, reverse=True)
        for old in zips[cfg.retention :]:
            try:
                old.unlink(missing_ok=True)
                _manifest_sidecar_path(old).unlink(missing_ok=True)
                logger.info("Deleted old backup: %s", old)
            except OSError as e:
                logger.warning("Failed to delete old backup %s: %s", old, e)


def _unique_dirs(*paths: Path | None) -> list[Path]:
    seen: set[str] = set()
    out: list[Path] = []
    for p in paths:
        if p is None:
            continue
        key = str(p.resolve())
        if key not in seen:
            seen.add(key)
            out.append(p.resolve())
    return out


def _record_backup_state(
    db: Session,
    backup_id: str,
    *,
    ok: bool,
    message: str,
    warnings: list[str] | None = None,
) -> None:
    svc = AdminConfigService(db)
    svc.set("backup_last_run_at", _utc_now_iso())
    svc.set("backup_last_backup_id", backup_id if ok else "")
    svc.set("backup_last_status", "ok" if ok else "error")
    svc.set("backup_last_message", message[:500])
    if warnings is not None:
        svc.set("backup_last_warnings", json.dumps(warnings[:20], ensure_ascii=False))


def list_backups(settings: Settings, db: Session | None = None) -> list[dict[str, Any]]:
    cfg = resolve_backup_settings(settings, db)
    rows: dict[str, dict[str, Any]] = {}
    for directory in _unique_dirs(cfg.local_dir, cfg.remote_dir):
        for zp in directory.glob(f"{BACKUP_PREFIX}*.zip"):
            bid = zp.stem.replace(BACKUP_PREFIX, "", 1)
            sidecar = _manifest_sidecar_path(zp)
            manifest: dict[str, Any] = {}
            if sidecar.is_file():
                try:
                    manifest = json.loads(sidecar.read_text(encoding="utf-8"))
                except json.JSONDecodeError:
                    pass
            loc = "remote" if cfg.remote_dir and directory.resolve() == cfg.remote_dir.resolve() else "local"
            key = bid
            if key not in rows:
                rows[key] = {
                    "backup_id": bid,
                    "filename": zp.name,
                    "size_bytes": zp.stat().st_size,
                    "size_human": format_bytes(zp.stat().st_size),
                    "created_at": manifest.get("created_at"),
                    "components": list((manifest.get("components") or {}).keys()),
                    "warnings": manifest.get("warnings") or [],
                    "zip_encrypted": bool(manifest.get("zip_encrypted")),
                    "locations": [],
                }
            rows[key]["locations"].append({"type": loc, "path": str(zp)})
    return sorted(rows.values(), key=lambda r: r["backup_id"], reverse=True)


def _resolve_backup_zip(settings: Settings, db: Session, backup_id: str) -> Path:
    cfg = resolve_backup_settings(settings, db)
    name = f"{BACKUP_PREFIX}{backup_id}.zip"
    for directory in _unique_dirs(cfg.local_dir, cfg.remote_dir):
        candidate = directory / name
        if candidate.is_file():
            return candidate
    raise FileNotFoundError(f"backup not found: {backup_id}")


def read_backup_manifest(settings: Settings, db: Session, backup_id: str) -> dict[str, Any]:
    zp = _resolve_backup_zip(settings, db, backup_id)
    sidecar = _manifest_sidecar_path(zp)
    if sidecar.is_file():
        return json.loads(sidecar.read_text(encoding="utf-8"))
    with _open_backup_zip_read(zp, settings) as zf:
        raw = zf.read("manifest.json")
        return json.loads(raw.decode("utf-8"))


def _extract_zip_members(zf: zipfile.ZipFile, prefix: str, dest: Path) -> list[str]:
    restored: list[str] = []
    prefix = prefix.rstrip("/") + "/"
    for info in zf.infolist():
        if info.is_dir():
            continue
        if not info.filename.startswith(prefix):
            continue
        rel = info.filename[len(prefix) :]
        if not rel or ".." in rel.split("/"):
            continue
        out = dest / rel
        out.parent.mkdir(parents=True, exist_ok=True)
        with zf.open(info) as src, open(out, "wb") as dst:
            shutil.copyfileobj(src, dst)
        restored.append(rel)
    return restored


def restore_from_backup(
    settings: Settings,
    db: Session,
    backup_id: str,
    *,
    components: list[str] | None = None,
    pre_backup: bool = True,
) -> dict[str, Any]:
    """切り戻し（指定コンポーネントまたは全件）。"""
    use_components = components or list(COMPONENT_LABELS.keys())
    pre_id: str | None = None
    if pre_backup:
        pre = create_backup(settings, db, trigger="pre-restore", components=_components_for_run(resolve_backup_settings(settings, db)))
        pre_id = pre.backup_id

    zp = _resolve_backup_zip(settings, db, backup_id)
    data_root = resolve_data_root(settings)
    gitea_layout = _resolve_gitea_layout_from_db(db)
    restored: dict[str, list[str]] = {}
    warnings: list[str] = []

    with _open_backup_zip_read(zp, settings) as zf:
        if COMPONENT_BACKEND_DB in use_components:
            backend_sql = next((i for i in zf.infolist() if i.filename == "backend/softrail.sql"), None)
            backend_sqlite = next((i for i in zf.infolist() if i.filename == "backend/softrail.db"), None)

            if backend_sql is not None:
                if _backend_uses_postgres(settings):
                    with tempfile.NamedTemporaryFile(suffix=".sql", delete=False) as tmp:
                        tmp_path = Path(tmp.name)
                    try:
                        with zf.open(backend_sql) as src, open(tmp_path, "wb") as dst:
                            shutil.copyfileobj(src, dst)
                        _restore_postgres(_backend_db_url(settings), tmp_path)
                        restored[COMPONENT_BACKEND_DB] = ["backend/softrail.sql → postgres"]
                        warnings.append("Postgres DB 復元後は NoraOps サーバー再起動を推奨します。")
                    except (RuntimeError, FileNotFoundError, subprocess.TimeoutExpired) as e:
                        warnings.append(f"バックエンド Postgres 復元失敗: {e}")
                    finally:
                        tmp_path.unlink(missing_ok=True)
                else:
                    warnings.append(
                        "バックアップは Postgres (softrail.sql) ですが、現在のバックエンドは SQLite です。"
                        "手動で DB を移行してください。"
                    )
            elif backend_sqlite is not None:
                if _backend_uses_postgres(settings):
                    warnings.append(
                        "バックアップは SQLite (softrail.db) ですが、現在のバックエンドは Postgres です。"
                        "手動で DB を移行してください。"
                    )
                else:
                    db_dest = settings.sqlite_abs_path
                    db_dest.parent.mkdir(parents=True, exist_ok=True)
                    if db_dest.is_file():
                        shutil.copy2(db_dest, db_dest.with_suffix(".db.pre-restore"))
                    with zf.open(backend_sqlite) as src, open(db_dest, "wb") as dst:
                        shutil.copyfileobj(src, dst)
                    restored[COMPONENT_BACKEND_DB] = [str(db_dest)]
                    warnings.append("SQLite DB 復元後はサーバー再起動を推奨します。")

        if COMPONENT_BACKEND_NORAOPS in use_components:
            items: list[str] = []
            with tempfile.TemporaryDirectory() as tmp:
                tmp_path = Path(tmp)
                for rel in NORAOPS_CORE_REL_PATHS:
                    prefix = f"backend/{rel}"
                    if rel.endswith(".json"):
                        for info in zf.infolist():
                            if info.filename == prefix:
                                dest = data_root / rel
                                dest.parent.mkdir(parents=True, exist_ok=True)
                                with zf.open(info) as src, open(dest, "wb") as dst:
                                    shutil.copyfileobj(src, dst)
                                items.append(rel)
                    else:
                        extracted = _extract_zip_members(zf, prefix, tmp_path / rel)
                        for e in extracted:
                            src = tmp_path / rel / e
                            dest = data_root / rel / e
                            dest.parent.mkdir(parents=True, exist_ok=True)
                            shutil.copy2(src, dest)
                            items.append(f"{rel}/{e}")
            restored[COMPONENT_BACKEND_NORAOPS] = items

        if COMPONENT_BACKEND_ARTIFACTS in use_components:
            art = settings.artifacts_abs_dir
            with tempfile.TemporaryDirectory() as tmp:
                items = _extract_zip_members(zf, "backend/artifacts", Path(tmp))
                for e in items:
                    src = Path(tmp) / e
                    dest = art / e
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(src, dest)
                restored[COMPONENT_BACKEND_ARTIFACTS] = items

        if COMPONENT_BACKEND_TOOLS in use_components:
            tools = data_root / "tools"
            with tempfile.TemporaryDirectory() as tmp:
                items = _extract_zip_members(zf, "backend/tools", Path(tmp))
                for e in items:
                    src = Path(tmp) / e
                    dest = tools / e
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(src, dest)
                restored[COMPONENT_BACKEND_TOOLS] = items

        if gitea_layout:
            if COMPONENT_GITEA_CONFIG in use_components:
                for info in zf.infolist():
                    if info.filename == "gitea/custom/conf/app.ini":
                        gitea_layout.ini_path.parent.mkdir(parents=True, exist_ok=True)
                        with zf.open(info) as src, open(gitea_layout.ini_path, "wb") as dst:
                            shutil.copyfileobj(src, dst)
                        restored[COMPONENT_GITEA_CONFIG] = [str(gitea_layout.ini_path)]

            if COMPONENT_GITEA_DB in use_components:
                gitea_sql = next((i for i in zf.infolist() if i.filename == "gitea/data/gitea.sql"), None)
                gitea_sqlite = next((i for i in zf.infolist() if i.filename == "gitea/data/gitea.db"), None)

                if gitea_sql is not None and gitea_layout.db_type == "postgres" and gitea_layout.db_url:
                    with tempfile.NamedTemporaryFile(suffix=".sql", delete=False) as tmp:
                        tmp_path = Path(tmp.name)
                    try:
                        with zf.open(gitea_sql) as src, open(tmp_path, "wb") as dst:
                            shutil.copyfileobj(src, dst)
                        _restore_postgres(gitea_layout.db_url, tmp_path)
                        restored[COMPONENT_GITEA_DB] = ["gitea/data/gitea.sql → postgres"]
                        warnings.append("Gitea Postgres DB 復元後は Gitea 再起動を推奨します。")
                    except (RuntimeError, FileNotFoundError, subprocess.TimeoutExpired) as e:
                        warnings.append(f"Gitea Postgres 復元失敗: {e}")
                    finally:
                        tmp_path.unlink(missing_ok=True)
                elif gitea_sql is not None:
                    warnings.append(
                        "バックアップに Gitea Postgres SQL がありますが、現在の Gitea は SQLite です。"
                        "手動復元が必要です。"
                    )
                elif gitea_sqlite is not None and gitea_layout.db_sqlite_path:
                    gitea_layout.db_sqlite_path.parent.mkdir(parents=True, exist_ok=True)
                    with zf.open(gitea_sqlite) as src, open(gitea_layout.db_sqlite_path, "wb") as dst:
                        shutil.copyfileobj(src, dst)
                    restored[COMPONENT_GITEA_DB] = [str(gitea_layout.db_sqlite_path)]
                    warnings.append("Gitea SQLite DB 復元後は Gitea 再起動を推奨します。")

            if COMPONENT_GITEA_REPOS in use_components and gitea_layout.repo_root:
                gitea_layout.repo_root.mkdir(parents=True, exist_ok=True)
                with tempfile.TemporaryDirectory() as tmp:
                    items = _extract_zip_members(zf, "gitea/repositories", Path(tmp))
                    for e in items:
                        src = Path(tmp) / e
                        dest = gitea_layout.repo_root / e
                        dest.parent.mkdir(parents=True, exist_ok=True)
                        shutil.copy2(src, dest)
                    restored[COMPONENT_GITEA_REPOS] = items[:50]
                    if len(items) > 50:
                        restored[COMPONENT_GITEA_REPOS].append(f"... and {len(items) - 50} more")
        else:
            for comp in (COMPONENT_GITEA_CONFIG, COMPONENT_GITEA_DB, COMPONENT_GITEA_REPOS):
                if comp in use_components:
                    warnings.append(f"{COMPONENT_LABELS[comp]}: Gitea 未検出のためスキップ")

    return {
        "ok": True,
        "backup_id": backup_id,
        "pre_restore_backup_id": pre_id,
        "restored": restored,
        "warnings": warnings,
        "message": "復元が完了しました。",
    }


def extract_from_backup(
    settings: Settings,
    db: Session,
    backup_id: str,
    components: list[str],
) -> dict[str, Any]:
    """部分復元 — restore と同じ実装だが components 必須・pre_backup なし。"""
    if not components:
        raise ValueError("components is required")
    invalid = [c for c in components if c not in COMPONENT_LABELS]
    if invalid:
        raise ValueError(f"unknown components: {invalid}")
    return restore_from_backup(
        settings,
        db,
        backup_id,
        components=components,
        pre_backup=False,
    )


def build_backup_status(settings: Settings, db: Session) -> dict[str, Any]:
    cfg = resolve_backup_settings(settings, db)
    svc = AdminConfigService(db)
    last_run = svc.get("backup_last_run_at") or ""
    backups = list_backups(settings, db)
    return {
        "schema": "nora.backup-status/1",
        "settings": {
            "enabled": cfg.enabled,
            "interval_hours": cfg.interval_hours,
            "retention": cfg.retention,
            "local_dir": str(cfg.local_dir),
            "remote_dir": str(cfg.remote_dir) if cfg.remote_dir else None,
            "include_artifacts": cfg.include_artifacts,
            "include_tools": cfg.include_tools,
            "zip_password_configured": bool(_zip_password_bytes(settings)),
        },
        "last_run_at": last_run,
        "last_backup_id": svc.get("backup_last_backup_id") or "",
        "last_status": svc.get("backup_last_status") or "",
        "last_message": svc.get("backup_last_message") or "",
        "last_warnings": json.loads(svc.get("backup_last_warnings") or "[]"),
        "backups": backups,
        "component_catalog": [
            {"id": k, "label": v} for k, v in COMPONENT_LABELS.items()
        ],
    }


def should_run_scheduled_backup(settings: Settings, db: Session) -> bool:
    cfg = resolve_backup_settings(settings, db)
    if not cfg.enabled:
        return False
    svc = AdminConfigService(db)
    last_raw = svc.get("backup_last_run_at") or ""
    if not last_raw:
        return True
    try:
        last = datetime.fromisoformat(last_raw.replace("Z", "+00:00"))
    except ValueError:
        return True
    now = datetime.now(timezone.utc)
    if last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    elapsed_hours = (now - last).total_seconds() / 3600
    return elapsed_hours >= cfg.interval_hours


def write_backup_settings(
    db: Session,
    settings: Settings,
    *,
    enabled: bool | None = None,
    interval_hours: int | None = None,
    retention: int | None = None,
    local_dir: str | None = None,
    remote_dir: str | None = None,
    include_artifacts: bool | None = None,
    include_tools: bool | None = None,
) -> BackupSettings:
    svc = AdminConfigService(db)
    if enabled is not None:
        svc.set("backup_enabled", "1" if enabled else "0")
    if interval_hours is not None:
        svc.set("backup_interval_hours", str(max(1, interval_hours)))
    if retention is not None:
        svc.set("backup_retention", str(max(1, retention)))
    if local_dir is not None:
        svc.set("backup_local_dir", local_dir.strip())
    if remote_dir is not None:
        svc.set("backup_remote_dir", remote_dir.strip())
    if include_artifacts is not None:
        svc.set("backup_include_artifacts", "1" if include_artifacts else "0")
    if include_tools is not None:
        svc.set("backup_include_tools", "1" if include_tools else "0")
    return resolve_backup_settings(settings, db)
