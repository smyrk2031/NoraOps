# FastAPIサーバ 開発者向け仕様

## 1. 目的
- VS Code拡張向けに、ツール導入manifestとartifact配布を提供する。
- Gitea連携により、リポジトリ横断分析/可視化ダッシュボードを提供する。

## 2. 技術スタック
- FastAPI + Uvicorn
- httpx（Gitea REST API呼び出し）
- Jinja2（Webページ表示）

## 3. API/ページ構成
- `GET /`:
  - ポータルトップページ（拡張DLリンク）
- `GET /dashboard`:
  - 横断分析ダッシュボード
- `GET /api/health`:
  - ヘルスチェック
- `GET /api/tools/windows-x64/manifest.json`:
  - 拡張が参照するツールmanifest
- `GET /api/gitea/repos`:
  - Gitea リポジトリ一覧（`GITEA_LIST_MODE` に依存。既定 `instance` はインスタンス横断検索）
- `GET /api/gitea/apps`:
  - アプリカタログ形式
- `GET /api/analytics/knowledge`
- `GET /api/analytics/workflows`
- `GET /api/analytics/policy-violations`
- `GET /admin/settings`:
  - 管理者設定ページ
- `GET /api/admin/settings`
- `POST /api/admin/settings`
- `POST /api/admin/detect-gitea-db`
- `GET /admin/logs`:
  - API access / tool download / telemetry 閲覧
- `GET /api/catalog/apps`:
  - Org横断のリポジトリ要約（VS Code 拡張のカタログ用）
- `GET /api/catalog/recommend`:
  - ルールベースの簡易レコメンド
- `POST /api/telemetry/events`:
  - VS Code 等からのテレメトリ格納（`TelemetryEvent`）
- `GET /api/mcp/tools`:
  - HTTP MCP エントリ（ツール一覧）
- `POST /api/mcp/invoke`:
  - 監査ログ `McpAuditLog` 付きツール実行。`mcp_bridge_api_key` 設定時のみ `X-SoftRail-Api-Key` 必須（後方互換 HTTP ヘッダ名。値は `mcp_bridge_api_key` 設定）

## 4. アプリ配布契約
- Gitea の zip / `manifest.softrail.json` は [app-manifest-contract.md](app-manifest-contract.md) に従う（tools manifest とは別）。

## 5. artifact配布（ツールチェーン）
- ツール実体は `data/tools` 配下に配置し、manifest と同じ領域で管理する。
- 配布URLは `GET /api/tools/files/{relative_path}` を使う。
- 配置例:
  - `data/tools/uv/0.6.0/uv.exe`
  - `data/tools/git/2.54.0/PortableGit-2.54.0-64-bit.7z.exe`
  - `data/tools/windows-x64/manifest.json`
- URL例:
  - `http://127.0.0.1:8000/api/tools/files/uv/0.6.0/uv.exe`
  - `http://127.0.0.1:8000/api/tools/files/git/2.54.0/PortableGit-2.54.0-64-bit.7z.exe`

## 6. 設定値（.env）
- `SOFTRAIL_CLIENT_DOWNLOAD_URL`:
  - トップページの拡張配布URL
- `SOFTRAIL_TOOLS_MANIFEST_PATH`:
  - tools manifest JSONパス
- `GITEA_BASE_URL`:
  - Gitea URL（例 `https://gitea.example.local`）
- `GITEA_TOKEN`:
  - API token
- `GITEA_LIST_MODE`:
  - `instance`（既定）… `GET /api/v1/repos/search` で横断。サイト管理者 PAT なら可視範囲が最大
  - `all_orgs` … `GET /api/v1/admin/orgs` で全 Organization を列挙し各 org のリポを取得（サイト管理者 PAT 必須）
  - `scoped` … `GITEA_ORGS` のみ。空かつトークンありなら `/user/repos` のみ
- `GITEA_ORGS`:
  - `scoped` モード時の解析対象 org（カンマ区切り）。`instance` / `all_orgs` では未使用
- `SOFTRAIL_DB_BACKEND`:
  - `sqlite` or `postgres`
- `SOFTRAIL_SQLITE_PATH`:
  - SQLiteファイルパス（開発向け）
- `SOFTRAIL_DB_URL`:
  - PostgreSQL接続URL（本番向け）

## 7. manifest運用ルール
- **tools manifest**（`windows-x64/manifest.json`）: `uv`/`PortableGit` の配布 → `sha256` / `size` を必ず検証
- **アプリ manifest** (`manifest.softrail.json`): アプリ本体の `uv run` 規約 → [app-manifest-contract.md](app-manifest-contract.md)
- 公開後にダウンロードURLを先に更新しない（404防止）
- `channel` と複数manifestで段階配信

## 8. セキュリティ・運用
- 本番はHTTPS必須
- API認証・監査ログは今後追加推奨（現状は最小実装）
- ポリシー違反判定ロジックは `app/services/analyzer.py` で拡張可能
- アクセスログ/ダウンロードログ/テレメトリ/MCP監査はそれぞれ `api_access_logs`, `download_logs`, `telemetry_events`, `mcp_audit_logs` に保存
