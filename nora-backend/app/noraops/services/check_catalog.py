"""Implemented check rules — CMS metadata (runtime defs live in *.rules.json + checkRunner.js)."""

from __future__ import annotations

from typing import TypedDict


class CheckMeta(TypedDict):
    id: str
    category: str
    title: str
    description: str
    severity: str
    auto_fix: str | None
    required: bool


# 拡張側で runChecks() が走るタイミング（全チェック共通）
EXTENSION_CHECK_TRIGGERS: list[str] = [
    "拡張起動後（約3秒）— ルール bundle 取得後に自動走査",
    "NoraOps Save 保存前 — Gitea アップロード直前",
    "F5 / デバッグ開始 — セキュリティ gate（重大違反でブロック）",
    "手動: 「セキュリティチェック」「フォルダ構成確認」コマンド",
    "公開リリースモーダル — リリース可否判定前",
    "ポリシー自動修正適用後 — 修正結果の再検証",
]

# NoraOps 運用に必須 — CMS で OFF にできない
REQUIRED_CHECK_IDS: frozenset[str] = frozenset(
    {
        "pol.nora_manifest",
        "pol.readme_exists",
        "pol.pyproject_exists",
        "pol.gitignore_exists",
        "pol.gitignore_covers_env",
        "pol.app_entry",
    }
)

# 新規チェック追加: 1) *.rules.json 2) checkRunner.js 3) ここ 4) docs/CHECKS.md
CHECK_CATALOG: list[CheckMeta] = [
    {
        "id": "sec.ip_literal",
        "category": "security",
        "title": "IP アドレス直書き禁止",
        "description": "ソース・設定ファイルへの IP 直書きを検出。公衆 IP・172.*・168系（192.168.*）は NG。10.*・allowlist は除外。",
        "severity": "error",
        "auto_fix": None,
        "required": False,
    },
    {
        "id": "sec.password_assignment",
        "category": "security",
        "title": "パスワード直書き（警告）",
        "description": "password / passwd の代入。確認 UI・Runner 公開前に要確認。",
        "severity": "warn",
        "auto_fix": None,
        "required": False,
    },
    {
        "id": "sec.secret_credential",
        "category": "security",
        "title": "API キー・シークレット直書き（警告）",
        "description": "api_key / client_secret 等の代入。",
        "severity": "warn",
        "auto_fix": None,
        "required": False,
    },
    {
        "id": "sec.token_assignment",
        "category": "security",
        "title": "トークン直書き（警告）",
        "description": "access_token / Bearer 等。",
        "severity": "warn",
        "auto_fix": None,
        "required": False,
    },
    {
        "id": "sec.account_literal",
        "category": "security",
        "title": "アカウント名直書き（警告）",
        "description": "username / account 等への固定文字列。",
        "severity": "warn",
        "auto_fix": None,
        "required": False,
    },
    {
        "id": "sec.email_literal",
        "category": "security",
        "title": "メールアドレス直書き（警告）",
        "description": "メール形式の文字列。",
        "severity": "warn",
        "auto_fix": None,
        "required": False,
    },
    {
        "id": "sec.digit7_id",
        "category": "security",
        "title": "7桁個人 ID（警告）",
        "description": "employee_id 等のキー名付き 7 桁数字。",
        "severity": "warn",
        "auto_fix": None,
        "required": False,
    },
    {
        "id": "sec.gitea_pat_prefix",
        "category": "security",
        "title": "Gitea PAT（警告）",
        "description": "gitea_pat_ 形式の文字列。",
        "severity": "warn",
        "auto_fix": None,
        "required": False,
    },
    {
        "id": "pol.readme_exists",
        "category": "policy",
        "title": "README 必須",
        "description": "リポジトリ直下に README.md または README.html があるか。",
        "severity": "error",
        "auto_fix": "template_readme",
        "required": True,
    },
    {
        "id": "pol.nora_manifest",
        "category": "policy",
        "title": "nora/manifest.json 必須",
        "description": "NoraOps がアプリ ID・起動設定を識別するための manifest。",
        "severity": "error",
        "auto_fix": "scaffold_nora",
        "required": True,
    },
    {
        "id": "pol.pyproject_exists",
        "category": "policy",
        "title": "pyproject.toml 必須",
        "description": "Python 依存管理（ルートまたは nora/packages/）。",
        "severity": "error",
        "auto_fix": "template_pyproject",
        "required": True,
    },
    {
        "id": "pol.gitignore_exists",
        "category": "policy",
        "title": ".gitignore 必須",
        "description": "Git 管理対象外ファイルの定義。",
        "severity": "error",
        "auto_fix": "auto_gitignore",
        "required": True,
    },
    {
        "id": "pol.gitignore_covers_env",
        "category": "policy",
        "title": ".gitignore が .env をカバー",
        "description": ".env / 秘密鍵がコミットされないようパターンを確認。",
        "severity": "error",
        "auto_fix": "auto_gitignore",
        "required": True,
    },
    {
        "id": "pol.app_entry",
        "category": "policy",
        "title": "起動用 .py の存在",
        "description": "manifest の entry に対応する Python 起動ファイルがあるか。",
        "severity": "error",
        "auto_fix": "scaffold_nora",
        "required": True,
    },
]


def catalog_by_id() -> dict[str, CheckMeta]:
    return {c["id"]: c for c in CHECK_CATALOG}


def format_rule_spec(rule: dict | None) -> str:
    """*.rules.json の1エントリから CMS 用の具体的ルール説明を生成。"""
    if not rule:
        return ""
    lines: list[str] = []
    if rule.get("message"):
        lines.append(str(rule["message"]))
    kind = rule.get("kind") or ""
    custom = rule.get("custom")
    if kind or custom:
        impl = kind + (f" / {custom}" if custom and custom != kind else "")
        lines.append(f"実装 kind: {impl}")
    if rule.get("paths"):
        lines.append("対象パス: " + ", ".join(rule["paths"]))
    if rule.get("globs"):
        globs = rule["globs"]
        shown = ", ".join(globs[:4])
        if len(globs) > 4:
            shown += f" …他 {len(globs) - 4} 件"
        lines.append(f"走査 glob: {shown}")
    if rule.get("excludeGlobs"):
        lines.append("除外: " + ", ".join(rule["excludeGlobs"][:3]))
    if rule.get("patterns"):
        lines.append("必須パターン: " + ", ".join(rule["patterns"]))
    if rule.get("blocksPublish"):
        lines.append("Runner 公開: 未確認のままではブロック")
    return "\n".join(lines)
