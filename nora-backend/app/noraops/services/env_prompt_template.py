"""環境（uv / pyproject）向け AI プロンプト — CMS 編集可能。"""

from __future__ import annotations

import re
from pathlib import Path

_SERVER_ROOT = Path(__file__).resolve().parents[3]
_TEMPLATE_REL = Path("data/noraops/prompts/env-deps-prompt-template.md")
_PLACEHOLDER_RE = re.compile(r"{{\s*([a-zA-Z0-9_]+)\s*}}")
DEFAULT_VERSION = "1"
REQUIRED_KEYS = frozenset({"display_name"})


def template_path() -> Path:
    return (_SERVER_ROOT / _TEMPLATE_REL).resolve()


def load_env_prompt_template() -> tuple[str, str]:
    path = template_path()
    if path.is_file():
        return path.read_text(encoding="utf-8-sig").strip() + "\n", DEFAULT_VERSION
    return _default_body(), DEFAULT_VERSION


def read_template_for_edit() -> str:
    path = template_path()
    if path.is_file():
        return path.read_text(encoding="utf-8-sig")
    return _default_body()


def validate_and_write_template(content: str) -> None:
    normalized = content.replace("\r\n", "\n").strip() + "\n"
    present = set(_PLACEHOLDER_RE.findall(normalized))
    missing = REQUIRED_KEYS - present
    if missing:
        keys = ", ".join(f"{{{{{k}}}}}" for k in sorted(missing))
        raise ValueError(f"環境プロンプトに必須の変数が不足しています: {keys}")
    path = template_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(normalized, encoding="utf-8")


def render_env_prompt(display_name: str = "このアプリ") -> tuple[str, str]:
    template, ver = load_env_prompt_template()
    body = _PLACEHOLDER_RE.sub(lambda m: display_name if m.group(1) == "display_name" else m.group(0), template)
    return body, ver


def _default_body() -> str:
    return (
        """あなたは NoraOps 向け Python 環境セットアップのアシスタントです。

アプリ名: {{display_name}}

## 依頼
uv で動く Python 環境を整えてください。次を作成・更新してください。

1. ルート `pyproject.toml` — `[project]` と `dependencies`（使うライブラリを列挙）
2. （任意）ルート `requirements.txt` — pyproject と整合
3. `nora/manifest.json` — エントリ `main.py` 等
4. ルート `main.py` — 既存があれば維持、無ければ最小の起動用

## ルール
- Python 3.11 系
- パスワードや API キーをソースに書かない
- 日本語 README に `uv sync`（ルートで実行）を書く

ファイルを作成したら、Creator の「環境 → 用意する」で venv を作れる状態にしてください。
"""
    )
