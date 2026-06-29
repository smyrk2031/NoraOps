"""コンシェルジュ用 Copilot プロンプト本文 — data 上のテンプレートを編集可能にする。"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

_SERVER_ROOT = Path(__file__).resolve().parents[3]
_TEMPLATE_REL = Path("data/noraops/concierge/copilot-prompt-template.md")
_PLACEHOLDER_RE = re.compile(r"{{\s*([a-zA-Z0-9_]+)\s*}}")

DEFAULT_TEMPLATE_VERSION = "1"

# 管理者 CMS で保存する際に必須とするプレースホルダー（Analyze 時に埋め込まれる）
REQUIRED_TEMPLATE_KEYS = frozenset({"problem", "input_desc", "output_desc", "repo_guidance"})


def template_path() -> Path:
    return (_SERVER_ROOT / _TEMPLATE_REL).resolve()


def load_prompt_template() -> tuple[str, str]:
    """
    テンプレート本文とバージョンを返す。
    ファイルが無い場合は組み込みデフォルト。
    """
    path = template_path()
    if path.is_file():
        body = path.read_text(encoding="utf-8-sig").strip() + "\n"
        return body, DEFAULT_TEMPLATE_VERSION
    return _default_template_body(), DEFAULT_TEMPLATE_VERSION


def read_template_for_edit() -> str:
    """CMS 表示用。ファイルが無い場合は組み込みデフォルト。"""
    path = template_path()
    if path.is_file():
        return path.read_text(encoding="utf-8-sig")
    return _default_template_body()


def validate_and_write_template(content: str) -> None:
    """
    管理者が編集した Markdown を書き込む。必須プレースホルダーが無いと ValueError。
    """
    normalized = content.replace("\r\n", "\n").strip() + "\n"
    present = set(list_template_placeholders(normalized))
    missing = REQUIRED_TEMPLATE_KEYS - present
    if missing:
        keys = ", ".join(f"{{{{{k}}}}}" for k in sorted(missing))
        raise ValueError(f"コンシェルジュテンプレートに必須の変数が不足しています: {keys}")
    path = template_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(normalized, encoding="utf-8")


def list_template_placeholders(template: str) -> list[str]:
    return sorted(set(_PLACEHOLDER_RE.findall(template)))


def build_repo_guidance_markdown(*, recommend_existing: bool, matches: list[dict[str, Any]]) -> str:
    """{{repo_guidance}} に差し込むブロック（Markdown）。"""
    if recommend_existing and matches:
        top = matches[0]
        fn = top.get("full_name") or top.get("name") or ""
        desc = top.get("description") or "—"
        return "\n".join(
            [
                "## 既存の類似アプリ（Gitea）",
                f"社内に類似候補があります: **{fn}**",
                f"説明: {desc}",
                "可能なら新規ではなく、このリポジトリをベースに改良することを検討してください。",
                "",
            ]
        )
    return "\n".join(
        [
            "## 新規作成",
            "類似する公開アプリは見つかりませんでした。新規アプリとして設計・実装してください。",
            "",
        ]
    )


def build_prompt_variables(
    *,
    problem: str,
    input_desc: str,
    output_desc: str,
    recommend_existing: bool,
    matches: list[dict[str, Any]],
) -> dict[str, str]:
    return {
        "problem": problem.strip(),
        "input_desc": (input_desc.strip() or "（未記入）"),
        "output_desc": (output_desc.strip() or "（未記入）"),
        "repo_guidance": build_repo_guidance_markdown(
            recommend_existing=recommend_existing, matches=matches
        ),
    }


def render_copilot_prompt_from_template(
    template: str, variables: dict[str, str]
) -> str:
    """`{{key}}` を variables で置換。未定義キーは空文字にしない（そのまま残す）。"""

    def repl(m: re.Match[str]) -> str:
        key = m.group(1)
        if key in variables:
            return variables[key]
        return m.group(0)

    return _PLACEHOLDER_RE.sub(repl, template)


def assemble_copilot_prompt(
    *,
    problem: str,
    input_desc: str,
    output_desc: str,
    recommend_existing: bool,
    matches: list[dict[str, Any]],
) -> tuple[str, str, dict[str, str]]:
    """
    最終プロンプト、テンプレートバージョン、クライアント注入用変数。
    """
    template, ver = load_prompt_template()
    vars_map = build_prompt_variables(
        problem=problem,
        input_desc=input_desc,
        output_desc=output_desc,
        recommend_existing=recommend_existing,
        matches=matches,
    )
    prompt = render_copilot_prompt_from_template(template, vars_map)
    return prompt, ver, vars_map


def _default_template_body() -> str:
    """data が未配置の開発環境向けフォールバック。"""
    return (
        """あなたは社内 NoraOps 向けの Python アプリ開発アシスタントです。

## ユーザーが解決したいこと
{{problem}}

## 入出力のイメージ
- 入力: {{input_desc}}
- 処理・ロジック: ユーザーと相談しながら具体化
- 出力: {{output_desc}}

## 技術・リポジトリの要件（NoraOps）
- **Python 3.11** 系をターゲットにする（`requires-python` を明示）
- パッケージ管理は **uv**。**`nora/packages/pyproject.toml` を正本**とする
- ルートの **requirements.txt** は pyproject と整合させる
- リポジトリ構成: `nora/manifest.json`, `nora/packages/pyproject.toml`, `nora/packages/main.py`
- **README.md** は日本語で: 概要 / 前提 / `uv sync --project nora/packages` を含むセットアップ / 実行方法
- **環境**: `nora/packages/.venv` を想定
- **セキュリティ**: IP 直書き禁止。.env・APIキーをソースに書かない

{{repo_guidance}}

## 依頼
上記を満たすアプリを実装してください。
1. `nora/packages/pyproject.toml`（dependencies 含む）
2. `nora/packages/main.py`（エントリ）
3. `nora/manifest.json` の `entry` を main.py に合わせる
4. README.md（日本語・使い方）
5. requirements.txt（uv / pyproject と整合）

GitHub Copilot **Agent モード**でファイルを作成・編集し、最後に動作確認の手順を README に書いてください。
"""
    )
