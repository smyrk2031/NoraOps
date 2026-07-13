# nora-backend

NoraOps 管理バックエンド（FastAPI + Gitea 連携）。

ver1 では `softrail-server/` というフォルダ名でした。移行: [../MIGRATION.md](../MIGRATION.md)

## 初回セットアップ（推奨: 同梱 uv）

```powershell
cd nora-backend
$uv = ".\data\tools\uv\0.6.0\uv.exe"
& $uv venv .venv
& $uv pip install -e ".[dev]" --python .venv\Scripts\python.exe
copy .env.example .env
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

`uv.exe` が無い場合: ver1 の `softrail-server\data\tools\uv\0.6.0\uv.exe` をコピー。

## テスト

```powershell
.\.venv\Scripts\python.exe -m pytest tests/ -q
```

## CMS・配布データ

| ドキュメント | 内容 |
|--------------|------|
| [docs/prompts-catalog.md](./docs/prompts-catalog.md) | 基本プロンプトカタログの CMS 編集・本番反映 |
| [docs/CHECKS.md](./docs/CHECKS.md) | ポリシーチェックルール |

## 管理画面（ブラウザ）

| パス | 内容 |
|------|------|
| `/admin` | 利用ダッシュボード |
| `/admin/users` | 登録ユーザ一覧・検索・トークン再発行 |
| `/admin/manual-users` | 手動ユーザ作成（`NORAOPS_ADMIN_MANUAL_PROVISION=1`） |
| `/admin/help` | 運用 Q&A（FAQ + ヘルプ横断検索） |
| `/admin/backup` | サーバー資産バックアップ |

DB は SQLite（既定）と PostgreSQL（`SOFTRAIL_DB_BACKEND=postgres`）のどちらでも同じ UI/API です。

## ライセンス

[LICENSE](./LICENSE) — MIT。[docs/LICENSE.md](../docs/LICENSE.md) 参照。
