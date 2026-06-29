"""Node.js 実行ファイルの解決（PATH 非依存・拡張と同一バージョン）。"""

from __future__ import annotations

import logging
import re
import shutil
import subprocess
import sys
from pathlib import Path

from app.core.config import Settings

logger = logging.getLogger(__name__)

# vscode-extension/package.json engines.node および .node-version と同期
DEFAULT_NODE_VERSION = "22.12.0"


class NodeRuntimeError(Exception):
    pass


def _node_binary_rel() -> Path:
    if sys.platform == "win32":
        return Path("node.exe")
    return Path("bin/node")


def _parse_version(raw: str) -> tuple[int, int, int] | None:
    s = raw.strip().lstrip("v")
    m = re.match(r"^(\d+)\.(\d+)\.(\d+)", s)
    if not m:
        return None
    return int(m.group(1)), int(m.group(2)), int(m.group(3))


def _version_compatible(actual: str, expected: str) -> bool:
    a = _parse_version(actual)
    e = _parse_version(expected)
    if a is None or e is None:
        return False
    # major は一致必須。minor 以降は同系（actual >= expected の patch まで許容）
    if a[0] != e[0]:
        return False
    if a[1] > e[1]:
        return True
    if a[1] < e[1]:
        return False
    return a[2] >= e[2]


def probe_node_version(node_exe: Path) -> str:
    proc = subprocess.run(
        [str(node_exe), "--version"],
        capture_output=True,
        text=True,
        timeout=15,
    )
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "").strip()
        raise NodeRuntimeError(f"node --version failed: {err[:200]}")
    return (proc.stdout or proc.stderr or "").strip()


def resolve_node_exe(settings: Settings, *, allow_path_fallback: bool = True) -> Path:
    """
    優先順:
    1. NORAOPS_NODE_EXE（.env で明示）
    2. NORAOPS_NODE_DIR または data/tools/node/<version>/ 内の node
    3. allow_path_fallback 時のみ PATH の node（開発用・警告ログ）
    """
    explicit = (settings.noraops_node_exe or "").strip()
    if explicit:
        p = Path(explicit).expanduser().resolve()
        if not p.is_file():
            raise NodeRuntimeError(
                f"NORAOPS_NODE_EXE が見つかりません: {p}\n"
                "Portable Node を data/tools/node/<version>/ に置くか、node.exe のフルパスを指定してください。"
            )
        return p

    bundled_dir = settings.node_bundled_abs_dir
    rel = _node_binary_rel()
    bundled = (bundled_dir / rel).resolve()
    if bundled.is_file():
        return bundled

    if allow_path_fallback:
        found = shutil.which("node")
        if found:
            logger.warning(
                "Node.js を PATH から使用しています（本番では NORAOPS_NODE_EXE を設定してください）"
            )
            return Path(found).resolve()

    ver = settings.noraops_node_version or DEFAULT_NODE_VERSION
    raise NodeRuntimeError(
        "Node.js が見つかりません。"
        f" data/tools/node/{ver}/ に公式 win-x64 zip を展開するか、"
        " .env に NORAOPS_NODE_EXE=... を設定してください。"
    )


def ensure_node_runtime(settings: Settings) -> Path:
    """解決 + バージョン検証。監査 CLI 実行前に呼ぶ。"""
    node = resolve_node_exe(settings)
    expected = (settings.noraops_node_version or DEFAULT_NODE_VERSION).strip()
    actual = probe_node_version(node)
    if not _version_compatible(actual, expected):
        raise NodeRuntimeError(
            f"Node.js バージョン不一致: 実行中={actual} 期待>={expected} "
            f"(NORAOPS_NODE_VERSION / vscode-extension/.node-version と揃えてください)"
        )
    return node
