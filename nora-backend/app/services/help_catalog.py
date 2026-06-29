"""ヘルプ MD カタログ（manifest + Markdown → HTML）。"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import markdown
from markdown.extensions import fenced_code, tables, toc

from app.core.config import Settings, get_settings

_md = markdown.Markdown(
    extensions=["fenced_code", "tables", "toc"],
    extension_configs={"toc": {"permalink": False}},
)


def _load_manifest(settings: Settings | None = None) -> dict[str, Any]:
    settings = settings or get_settings()
    path = settings.help_manifest_path
    if not path.is_file():
        return {"tabs": []}
    return json.loads(path.read_text(encoding="utf-8"))


def list_help_tabs(settings: Settings | None = None) -> list[dict[str, Any]]:
    data = _load_manifest(settings)
    tabs = []
    for t in data.get("tabs") or []:
        tabs.append(
            {
                "id": t["id"],
                "title": t.get("title", t["id"]),
                "icon": t.get("icon", ""),
                "category": t.get("category", "other"),
            }
        )
    return tabs


def _read_md_file(settings: Settings, rel_path: str) -> str:
    rel_path = rel_path.replace("\\", "/")
    docs = settings.docs_abs_dir
    ver1 = docs.parent.resolve()
    if rel_path.startswith("../"):
        target = (ver1 / rel_path[3:]).resolve()
    else:
        target = (docs / rel_path).resolve()
    try:
        target.relative_to(ver1)
    except ValueError as e:
        raise FileNotFoundError(rel_path) from e
    if not target.is_file():
        raise FileNotFoundError(rel_path)
    return target.read_text(encoding="utf-8")


def generate_licenses_markdown(settings: Settings | None = None) -> str:
    settings = settings or get_settings()
    server_root = Path(__file__).resolve().parents[2]
    lines = [
        "# ライセンス表記",
        "",
        "## 本システム（NoraOps）",
        "",
        "社内 DevOps 基盤として提供。利用条件は組織の IT ポリシーに従ってください。",
        "",
        "### サーバー（Python）主要依存",
        "",
        "| パッケージ | 備考 |",
        "|------------|------|",
    ]
    req = server_root / "requirements.txt"
    if req.is_file():
        for raw in req.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            pkg = re.split(r"[<>=!~\[]", line)[0].strip()
            if pkg:
                lines.append(f"| {pkg} | PyPI 各パッケージの LICENSE 参照 |")
    lines.extend(
        [
            "",
            "### VS Code 拡張",
            "",
        ]
    )
    pkg_json = server_root.parent / "vscode-extension" / "package.json"
    if pkg_json.is_file():
        meta = json.loads(pkg_json.read_text(encoding="utf-8"))
        lines.append(f"- **名前**: {meta.get('name', '')}")
        lines.append(f"- **バージョン**: {meta.get('version', '')}")
        lines.append(f"- **Publisher**: {meta.get('publisher', '')}")
        lic = meta.get("license") or "（package.json に license フィールド未設定）"
        lines.append(f"- **拡張自体**: {lic}")
        lines.append("")
        lines.append("拡張の実行時依存（Node / VS Code API）は VS Code および各 npm パッケージのライセンスに従います。")
    lines.extend(
        [
            "",
            "## 配布ツール",
            "",
            "`data/tools/` 配下の Portable Git 等は各ベンダーのライセンスに従います。",
            "",
            "> 完全な SPDX 一覧が必要な場合は CI で `pip-licenses` / `license-checker` を追加してください。",
        ]
    )
    return "\n".join(lines)


def get_help_content(tab_id: str, settings: Settings | None = None) -> dict[str, Any]:
    settings = settings or get_settings()
    data = _load_manifest(settings)
    tab = next((t for t in (data.get("tabs") or []) if t.get("id") == tab_id), None)
    if not tab:
        raise KeyError(tab_id)

    source = tab.get("source") or {}
    stype = source.get("type", "file")
    if stype == "generated" and source.get("generator") == "licenses":
        md_text = generate_licenses_markdown(settings)
    elif stype == "file":
        md_text = _read_md_file(settings, source.get("path", ""))
    else:
        raise ValueError(f"unknown source type: {stype}")

    html = _md.convert(md_text)
    _md.reset()
    return {
        "id": tab_id,
        "title": tab.get("title", tab_id),
        "category": tab.get("category", ""),
        "html": html,
        "markdown_chars": len(md_text),
    }
