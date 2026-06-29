"""バージョン文字列。

- **pyproject.toml** … Python パッケージ（ビルド・アーティファクト用）
- **実装記録.md** … ヘルプ「リリースノート」タブの正本。`##` 見出し内の `（v1.2.3）` / `(v1.2.3)` をポータル表示の優先ソースにする。
"""

from __future__ import annotations

import re
import tomllib
from functools import lru_cache
from pathlib import Path

from app.core.config import Settings, get_settings

_PYPROJECT = Path(__file__).resolve().parents[2] / "pyproject.toml"

# リリースノート（実装記録）の H2 などに付く表記: （v0.8.1） または (v0.8.1)
_HEADING_VERSION_RE = re.compile(r"[（(]\s*v(\d+\.\d+(?:\.\d+)?)\s*[）)]")

_RELEASE_NOTES_FILENAME = "実装記録.md"


@lru_cache
def get_app_version() -> str:
    """pyproject [project.version]。"""
    try:
        with _PYPROJECT.open("rb") as f:
            data = tomllib.load(f)
        ver = data.get("project", {}).get("version")
        if isinstance(ver, str) and ver.strip():
            return ver.strip()
    except OSError:
        pass
    return "0.0.0"


def get_release_notes_latest_version(settings: Settings | None = None) -> str | None:
    """
    `NORAOPS_DOCS_DIR/実装記録.md` を上から読み、最初に現れる `##` 見出しに含まれる vX.Y.Z を返す。
    見つからなければ None。
    """
    settings = settings or get_settings()
    path = settings.docs_abs_dir / _RELEASE_NOTES_FILENAME
    if not path.is_file():
        return None
    try:
        text = path.read_text(encoding="utf-8-sig")
    except OSError:
        return None

    for raw in text.splitlines():
        stripped = raw.strip()
        if stripped.startswith("###"):
            continue
        if not stripped.startswith("##"):
            continue
        m = _HEADING_VERSION_RE.search(stripped)
        if m:
            return m.group(1)
    return None


def get_portal_display_version(settings: Settings | None = None) -> str:
    """
    ポータル／OpenAPI に出す「製品」版。リリースノート（実装記録）が取れればそれ、なければ pyproject。
    """
    vn = get_release_notes_latest_version(settings)
    if vn:
        return vn
    return get_app_version()

