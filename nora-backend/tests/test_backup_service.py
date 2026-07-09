"""バックアップ・復元サービスのテスト。"""

from __future__ import annotations

import json
import sqlite3
import zipfile
from configparser import ConfigParser
from pathlib import Path

import pytest
from sqlalchemy.orm import sessionmaker

from app.core.config import Settings
from app.db.models import Base
from app.services.backup_service import (
    COMPONENT_BACKEND_NORAOPS,
    _open_backup_zip_read,
    create_backup,
    extract_from_backup,
    list_backups,
    read_backup_manifest,
    resolve_backup_settings,
    restore_from_backup,
    should_run_scheduled_backup,
)
from app.services.gitea_paths import resolve_gitea_layout


def _make_db():
    from sqlalchemy import create_engine

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, autoflush=False, autocommit=False)()


def _make_settings(tmp_path: Path, *, backup_zip_password: str = "") -> Settings:
    data = tmp_path / "data"
    data.mkdir()
    (data / "noraops" / "checks").mkdir(parents=True)
    (data / "noraops" / "checks" / "security.rules.json").write_text('{"schema":"test"}', encoding="utf-8")
    db_file = data / "softrail.db"
    sqlite3.connect(str(db_file)).close()
    backup_dir = data / "backups"
    backup_dir.mkdir()
    return Settings(
        SOFTRAIL_HOST="127.0.0.1",
        SOFTRAIL_PORT=8000,
        SOFTRAIL_SQLITE_PATH=str(db_file),
        SOFTRAIL_TOOLS_MANIFEST_PATH=str(data / "tools/windows-x64/manifest.json"),
        NORAOPS_BACKUP_LOCAL_DIR=str(backup_dir),
        NORAOPS_BACKUP_RETENTION=3,
        NORAOPS_BACKUP_INTERVAL_HOURS=24,
        NORAOPS_BACKUP_ZIP_PASSWORD=backup_zip_password,
    )


def _make_gitea_tree(tmp_path: Path) -> Path:
    root = tmp_path / "gitea"
    (root / "custom" / "conf").mkdir(parents=True)
    (root / "data").mkdir()
    ini = root / "custom" / "conf" / "app.ini"
    parser = ConfigParser()
    parser["database"] = {"DB_TYPE": "sqlite3", "PATH": "data/gitea.db"}
    parser["repository"] = {"ROOT": "data/gitea-repositories"}
    with ini.open("w", encoding="utf-8") as f:
        parser.write(f)
    sqlite3.connect(str(root / "data" / "gitea.db")).close()
    (root / "data" / "gitea-repositories" / "org" / "repo.git").mkdir(parents=True)
    (root / "data" / "gitea-repositories" / "org" / "repo.git" / "HEAD").write_text("ref: refs/heads/main\n")
    exe = root / "gitea.exe"
    exe.write_text("", encoding="utf-8")
    return exe


def test_create_backup_includes_backend_and_manifest(tmp_path: Path):
    settings = _make_settings(tmp_path)
    db = _make_db()
    result = create_backup(settings, db, trigger="test")
    assert result.ok
    assert result.backup_id
    assert result.zip_path and result.zip_path.is_file()
    with zipfile.ZipFile(result.zip_path, "r") as zf:
        names = zf.namelist()
        assert "manifest.json" in names
        assert "backend/softrail.db" in names
        assert "backend/noraops/checks/security.rules.json" in names
    manifest = read_backup_manifest(settings, db, result.backup_id)
    assert manifest["schema"] == "nora.backup/1"


def test_create_backup_zip_password(tmp_path: Path):
    settings = _make_settings(tmp_path, backup_zip_password="test-zip-secret")
    db = _make_db()
    result = create_backup(settings, db, trigger="test")
    assert result.ok
    manifest = read_backup_manifest(settings, db, result.backup_id)
    assert manifest.get("zip_encrypted") is True
    import pyzipper

    with pyzipper.AESZipFile(result.zip_path, "r") as zf:
        zf.setpassword(b"wrong-password")
        with pytest.raises(RuntimeError):
            zf.read("manifest.json")
    with pyzipper.AESZipFile(result.zip_path, "r") as zf:
        zf.setpassword(b"test-zip-secret")
        assert "backend/softrail.db" in zf.namelist()


def test_create_backup_backend_postgres(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    settings = Settings(
        SOFTRAIL_HOST="127.0.0.1",
        SOFTRAIL_PORT=8000,
        SOFTRAIL_DB_BACKEND="postgres",
        SOFTRAIL_DB_URL="postgresql+psycopg://nora:nora@127.0.0.1:5432/noraops",
        SOFTRAIL_SQLITE_PATH=str(tmp_path / "data" / "softrail.db"),
        SOFTRAIL_TOOLS_MANIFEST_PATH=str(tmp_path / "data" / "tools" / "manifest.json"),
        NORAOPS_BACKUP_LOCAL_DIR=str(tmp_path / "data" / "backups"),
    )
    data = tmp_path / "data"
    (data / "noraops" / "checks").mkdir(parents=True)
    (data / "noraops" / "checks" / "security.rules.json").write_text('{"schema":"test"}', encoding="utf-8")
    (data / "backups").mkdir(parents=True)

    def _fake_dump(db_url: str, dest_sql: Path) -> None:
        dest_sql.parent.mkdir(parents=True, exist_ok=True)
        dest_sql.write_text(f"-- dump from {db_url}\n", encoding="utf-8")

    monkeypatch.setattr("app.services.backup_service._dump_postgres", _fake_dump)
    db = _make_db()
    result = create_backup(settings, db, trigger="test")
    assert result.ok
    manifest = read_backup_manifest(settings, db, result.backup_id)
    assert manifest.get("backend_db_format") == "postgres"
    with _open_backup_zip_read(result.zip_path, settings) as zf:
        assert "backend/softrail.sql" in zf.namelist()
        assert "backend/softrail.db" not in zf.namelist()


def test_create_backup_with_gitea(tmp_path: Path):
    settings = _make_settings(tmp_path)
    db = _make_db()
    exe = _make_gitea_tree(tmp_path)
    from app.services.admin_config_service import AdminConfigService

    AdminConfigService(db).set("gitea_exe_path", str(exe))
    result = create_backup(settings, db, trigger="test")
    assert result.ok
    with zipfile.ZipFile(result.zip_path, "r") as zf:
        names = zf.namelist()
        assert "gitea/custom/conf/app.ini" in names
        assert "gitea/data/gitea.db" in names
        assert any(n.startswith("gitea/repositories/") for n in names)


def test_retention_keeps_latest_three(tmp_path: Path):
    settings = _make_settings(tmp_path)
    db = _make_db()
    ids = []
    for _ in range(5):
        r = create_backup(settings, db, trigger="test")
        ids.append(r.backup_id)
    backups = list_backups(settings, db)
    assert len(backups) == 3
    kept = {b["backup_id"] for b in backups}
    assert ids[-1] in kept
    assert ids[-2] in kept
    assert ids[-3] in kept
    assert ids[0] not in kept


def test_extract_noraops_core(tmp_path: Path):
    settings = _make_settings(tmp_path)
    db = _make_db()
    result = create_backup(settings, db, trigger="test")
    target = settings.sqlite_abs_path.parent / "noraops" / "checks" / "security.rules.json"
    target.write_text('{"schema":"changed"}', encoding="utf-8")
    out = extract_from_backup(
        settings,
        db,
        result.backup_id,
        [COMPONENT_BACKEND_NORAOPS],
    )
    assert out["ok"]
    assert json.loads(target.read_text(encoding="utf-8"))["schema"] == "test"


def test_restore_creates_pre_backup(tmp_path: Path):
    settings = _make_settings(tmp_path)
    db = _make_db()
    first = create_backup(settings, db, trigger="test")
    target = settings.sqlite_abs_path.parent / "noraops" / "checks" / "security.rules.json"
    target.write_text('{"schema":"broken"}', encoding="utf-8")
    out = restore_from_backup(settings, db, first.backup_id)
    assert out["ok"]
    assert out["pre_restore_backup_id"]
    assert json.loads(target.read_text(encoding="utf-8"))["schema"] == "test"


def test_restore_full_roundtrip_with_gitea(tmp_path: Path):
    """バックアップ → データ破壊 → 切り戻しで Gitea リポまで復元できること。"""
    settings = _make_settings(tmp_path)
    db = _make_db()
    exe = _make_gitea_tree(tmp_path)
    from app.services.admin_config_service import AdminConfigService

    AdminConfigService(db).set("gitea_exe_path", str(exe))
    layout = resolve_gitea_layout(str(exe))
    head_path = layout.repo_root / "org" / "repo.git" / "HEAD"
    assert head_path.is_file()

    first = create_backup(settings, db, trigger="test")
    assert first.ok

    # 意図的に破壊
    target = settings.sqlite_abs_path.parent / "noraops" / "checks" / "security.rules.json"
    target.write_text('{"schema":"broken"}', encoding="utf-8")
    head_path.write_text("ref: refs/heads/disaster\n", encoding="utf-8")

    out = restore_from_backup(settings, db, first.backup_id)
    assert out["ok"] is True
    assert out["pre_restore_backup_id"]
    assert json.loads(target.read_text(encoding="utf-8"))["schema"] == "test"
    assert head_path.read_text(encoding="utf-8") == "ref: refs/heads/main\n"

    # pre-restore 世代も残っている
    backups = list_backups(settings, db)
    assert len(backups) >= 2
    assert any(b["backup_id"] == out["pre_restore_backup_id"] for b in backups)


def test_should_run_scheduled_when_never_run(tmp_path: Path):
    settings = _make_settings(tmp_path)
    db = _make_db()
    assert should_run_scheduled_backup(settings, db) is True


def test_resolve_gitea_layout(tmp_path: Path):
    exe = _make_gitea_tree(tmp_path)
    layout = resolve_gitea_layout(str(exe))
    assert layout.db_type == "sqlite3"
    assert layout.repo_root and layout.repo_root.is_dir()
    assert layout.ini_path.is_file()


def test_resolve_backup_settings_db_override(tmp_path: Path):
    settings = _make_settings(tmp_path)
    db = _make_db()
    from app.services.admin_config_service import AdminConfigService

    AdminConfigService(db).set("backup_retention", "5")
    cfg = resolve_backup_settings(settings, db)
    assert cfg.retention == 5
