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

## ライセンス

[LICENSE](./LICENSE) — MIT。[docs/LICENSE.md](../docs/LICENSE.md) 参照。
