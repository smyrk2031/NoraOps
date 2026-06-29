"""data/ 起動時ブートストラップ。"""

from pathlib import Path

from app.core.config import Settings
from app.services.data_bootstrap import (
    bootstrap_data_on_startup,
    data_needs_bootstrap,
    restore_data_from_seed,
)


def test_data_needs_bootstrap_empty_dir(tmp_path: Path):
    assert data_needs_bootstrap(tmp_path) is True


def test_restore_from_seed_creates_markers(tmp_path: Path):
    seed = Path(__file__).resolve().parents[1] / "app" / "bootstrap_data"
    restored = restore_data_from_seed(tmp_path, seed, overwrite_empty=True)
    assert "tools/windows-x64/manifest.json" in restored
    assert (tmp_path / "noraops/checks/security.rules.json").is_file()
    assert (tmp_path / "noraops/mcp/sources.json").is_file()
    assert data_needs_bootstrap(tmp_path) is False


def test_restore_does_not_overwrite_existing(tmp_path: Path):
    seed = Path(__file__).resolve().parents[1] / "app" / "bootstrap_data"
    target = tmp_path / "noraops/checks/security.rules.json"
    target.parent.mkdir(parents=True)
    target.write_text('{"schema":"custom"}', encoding="utf-8")
    restore_data_from_seed(tmp_path, seed, overwrite_empty=False)
    assert target.read_text(encoding="utf-8") == '{"schema":"custom"}'


def test_bootstrap_disabled(tmp_path: Path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    settings = Settings(
        SOFTRAIL_HOST="127.0.0.1",
        SOFTRAIL_PORT=8000,
        NORAOPS_DATA_BOOTSTRAP=False,
        SOFTRAIL_TOOLS_MANIFEST_PATH=str(tmp_path / "data/tools/windows-x64/manifest.json"),
    )
    assert bootstrap_data_on_startup(settings) == []
