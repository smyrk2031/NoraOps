# NoraOps チェックルール — 開発者向け

## 概要

| レイヤ | 役割 |
|--------|------|
| **拡張 `checkRunner.js`** | ルール `kind` の実行エンジン（regex, file_exists, app_entry 等） |
| **`data/noraops/checks/*.rules.json`** | ルール定義（パラメータ・メッセージ・severity） |
| **`check_catalog.py`** | CMS 表示用メタデータ（タイトル・必須フラグ・説明・実行タイミング） |
| **`check-toggles.json`** | 管理者 CMS が ON/OFF する設定（**このファイルだけ CMS が書く**） |
| **`GET /api/v1/checks/rules`** | 拡張へ配信（無効ルールは除外済み bundle） |

## 新しいチェックを追加する手順

1. **拡張** `vscode-extension/src/noraops/checkRunner.js` に `kind` ハンドラを実装
2. **ルール JSON** にエントリを追加  
   - `data/noraops/checks/security.rules.json` または `repo-policy.rules.json`  
   - `app/bootstrap_data/noraops/checks/` にも同内容をコピー（初回 bootstrap 用）
3. **`check_catalog.py`** の `CHECK_CATALOG` に同じ `id` のメタデータを追加
4. **`check-toggles.json`** に `"your.rule.id": true` を追加（bootstrap 両方）
5. 拡張同梱 `vscode-extension/resources/checks/*.rules.json` を同期（オフライン用）
6. 必要なら `policyFix.js` に UI ヒント / 自動修正を追加

## CMS でできること · できないこと

| 操作 | CMS | コード |
|------|-----|--------|
| 実装済みチェックの ON/OFF | ○ `/admin/cms` | — |
| **NoraOps 必須チェック** | 表示のみ（OFF 不可） | `check_catalog.py` の `required: True` |
| 正規表現・glob・メッセージ変更 | —（CMS は JSON から自動表示） | `*.rules.json` を PR |
| 新しい `kind`（例: AST 解析） | — | 拡張 + JSON + catalog |
| 閾値・allowlist 変更 | — | `security.rules.json` を PR |

## ルール ID 一覧（現行）

| ID | 種別 | kind |
|----|------|------|
| `sec.ip_literal` | security | custom / ip_literal | error · F5 ブロック |
| `sec.password_assignment` | security | regex | warn · 確認 UI |
| `sec.secret_credential` | security | regex | warn |
| `sec.token_assignment` | security | regex | warn |
| `sec.account_literal` | security | regex | warn |
| `sec.email_literal` | security | regex | warn |
| `sec.digit7_id` | security | regex | warn |
| `sec.gitea_pat_prefix` | security | regex | warn |
| `pol.readme_exists` | policy | file_exists_any |
| `pol.nora_manifest` | policy | file_exists |
| `pol.pyproject_exists` | policy | file_exists_any |
| `pol.gitignore_exists` | policy | file_exists |
| `pol.gitignore_covers_env` | policy | gitignore_covers |
| `pol.app_entry` | policy | app_entry |

## MCP ソース定義

`data/noraops/mcp/sources.example.json` は AI 連携の**設計メモ**です。  
現時点では拡張に配信されず、CMS も参照表示のみです。  
ランタイム接続時は別 API + `when` フィルタを追加する予定です。
