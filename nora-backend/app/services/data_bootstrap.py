"""起動時に data/ が空なら同梱シードから初期レイアウトを復元する。"""

from __future__ import annotations

import logging
import shutil
from pathlib import Path

from app.core.config import Settings

logger = logging.getLogger(__name__)

_SERVER_ROOT = Path(__file__).resolve().parents[2]
_SEED_ROOT = Path(__file__).resolve().parents[1] / "bootstrap_data"
_DEFAULT_DATA_ROOT = _SERVER_ROOT / "data"

# いずれかが無ければ「未初期化」とみなす
_MARKER_FILES = (
    "tools/windows-x64/manifest.json",
    "noraops/checks/security.rules.json",
    "noraops/client-latest.json",
)

_RUNTIME_DIRS = (
    "noraops/artifacts",
    "noraops/mcp",
    "noraops/packages/mirror",
    "noraops/packages/mirror-archive",
    "tools/uv/0.6.0",
    "tools/git/2.54.0",
    "tools/node/22.12.0",
)


def resolve_data_root(settings: Settings | None = None) -> Path:
    """設定から data ルートを推定（manifest / sqlite と同じ ./data 基準）。"""
    if settings is None:
        return _DEFAULT_DATA_ROOT.resolve()
    manifest = Path(settings.tools_manifest_path)
    if manifest.is_absolute():
        return manifest.parents[2].resolve()
    return (_SERVER_ROOT / manifest).resolve().parents[2]


def data_needs_bootstrap(data_root: Path) -> bool:
    if not data_root.is_dir():
        return True
    return not any((data_root / rel).is_file() for rel in _MARKER_FILES)


def _copy_seed_file(src: Path, dest: Path, *, overwrite_empty: bool) -> bool:
    if dest.exists():
        if not overwrite_empty:
            return False
        if dest.is_file() and dest.stat().st_size > 0:
            return False
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dest)
    return True


def restore_data_from_seed(
    data_root: Path,
    seed_root: Path | None = None,
    *,
    overwrite_empty: bool = False,
) -> list[str]:
    """
    シードから欠けているファイルをコピーする。
    戻り値: 復元した相対パスのリスト。
    """
    seed = (seed_root or _SEED_ROOT).resolve()
    if not seed.is_dir():
        logger.warning("data bootstrap seed not found: %s", seed)
        return []

    restored: list[str] = []
    for src in sorted(seed.rglob("*")):
        if not src.is_file():
            continue
        rel = src.relative_to(seed)
        dest = data_root / rel
        if _copy_seed_file(src, dest, overwrite_empty=overwrite_empty):
            restored.append(rel.as_posix())

    for rel in _RUNTIME_DIRS:
        (data_root / rel).mkdir(parents=True, exist_ok=True)

    example = data_root / "noraops/mcp/sources.example.json"
    sources = data_root / "noraops/mcp/sources.json"
    if example.is_file() and not sources.is_file():
        shutil.copy2(example, sources)
        restored.append("noraops/mcp/sources.json")

    return restored


def bootstrap_data_on_startup(settings: Settings) -> list[str]:
    """起動時フック。NORAOPS_DATA_BOOTSTRAP=0 で無効化。"""
    if not getattr(settings, "noraops_data_bootstrap", True):
        return []

    data_root = resolve_data_root(settings)
    empty = data_needs_bootstrap(data_root)
    if not empty:
        for rel in _RUNTIME_DIRS:
            (data_root / rel).mkdir(parents=True, exist_ok=True)
        return []

    restored = restore_data_from_seed(data_root, overwrite_empty=empty)
    if restored:
        logger.info(
            "data directory bootstrapped (%d files) at %s",
            len(restored),
            data_root,
        )
    return restored
