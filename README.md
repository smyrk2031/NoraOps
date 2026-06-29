# NoraOps

**安心な開発環境のガードレール** — VS Code 拡張 + FastAPI バックエンド + Gitea。

- **主機能**: 静的チェック（IP 直書き等）・パッケージ許可リスト（warn + 監査）
- **副機能**: Creator（0→1 開発）・Gitea 簡単保存・Runner（公開アプリ起動）

製品像: [NoraOps/製品像とロードマップ.md](./NoraOps/製品像とロードマップ.md) · ライセンス: [LICENSE](./LICENSE) · [docs/LICENSE.md](./docs/LICENSE.md)

## 構成

```
NoraOps/
├── README.md                 … 本ファイル
├── MIGRATION.md              … ver1 からの引っ越し手順
├── .gitignore
├── docs/                     … リポ入口・メンテ・棚卸
├── NoraOps/                  … **プロダクト仕様**（思想・アーキ・手順。archive/ のみ凍結）
├── nora-backend/          … FastAPI バックエンド
└── vscode-extension/         … NoraOps4code 拡張
```

## まず読む

| 資料 | 内容 |
|------|------|
| [NoraOps/製品像とロードマップ.md](./NoraOps/製品像とロードマップ.md) | 製品の一言・主副機能・ロードマップ |
| [docs/README.md](./docs/README.md) | ドキュメント入口 |
| [docs/MONOREPO.md](./docs/MONOREPO.md) | 構成・vendor 同梱 |
| [docs/MAINTENANCE.md](./docs/MAINTENANCE.md) | リリース・同期ルール |
| [MIGRATION.md](./MIGRATION.md) | ver1 からの移行 |

## 開発（移行後）

```powershell
# 拡張
cd vscode-extension
npm test

# サーバー（同梱 uv 推奨）
cd nora-backend
.\data\tools\uv\0.6.0\uv.exe venv .venv
.\data\tools\uv\0.6.0\uv.exe pip install -e ".[dev]" --python .venv\Scripts\python.exe
# .env を .env.example からコピーして設定
.\.venv\Scripts\python.exe -m pytest tests/
```

## Git

移行完了後に `git init` → 初回コミット → remote 連携。  
手順: [MIGRATION.md](./MIGRATION.md) §5
