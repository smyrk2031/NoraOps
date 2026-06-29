# NoraOps モノレポ構成（To-Be）

**方針**: Git 上は `ver1/` を **1 リポジトリの root** にする。開発中は兄弟フォルダのままでも、**配備物は nora-backend 1 パッケージ**にまとめる。

---

## 推奨レイアウト

```
ver1/                          ← git root（要 init / 移行）
├── README.md                  ← プロダクト入口
├── docs/                      ← ドキュメント入口（正本索引）
├── vscode-extension/          ← 拡張ソース（開発正本）
├── nora-backend/           ← バックエンド
│   ├── vendor/
│   │   └── vscode-extension/  ← 配備同梱（sync スクリプトで生成）
│   ├── data/tools/node/       ← Portable Node（監査 CLI 用）
│   └── scripts/
│       └── sync-vendor-extension.ps1
├── NoraOps/                   ← 仕様 MD 実体（help manifest はここ参照）
│   └── archive/               ← 旧構想（実装判断禁止）
└── pygarden/                  ← 【Phase 2】別製品をここへ移動（現状は ver1 直下）
```

---

## なぜ拡張を server 内 `vendor/` に同梱するか

| 課題 | vendor 同梱 |
|------|-------------|
| 拡張だけ更新してサーバー忘れ | 配備 zip は常にセット |
| checkRunner 監査のパス | `NORAOPS_EXTENSION_DIR=./vendor/vscode-extension` |
| Node バージョン | `data/tools/node/` + `NORAOPS_NODE_EXE` |

**Git 上のソース正本**は当面 `vscode-extension/` のまま（F5 / vsix 開発が楽）。  
**本番サーバー**は `sync-vendor-extension.ps1` 実行後の `vendor/` を参照。

---

## 配備手順（サーバー）

```powershell
cd nora-backend
powershell -ExecutionPolicy Bypass -File .\scripts\sync-vendor-extension.ps1
```

`.env`:

```env
NORAOPS_EXTENSION_DIR=./vendor/vscode-extension
NORAOPS_NODE_VERSION=22.12.0
NORAOPS_NODE_DIR=./data/tools/node/22.12.0
```

---

## Git 化（未実施 — 急ぎ推奨）

現状 `ver1/` に `.git` がありません。1 リポ化の第一歩:

1. `ver1/` で `git init`
2. 本 `.gitignore` を適用（`node_modules/`, `data/`, `.env` 除外）
3. tag `v0.16.0-baseline` を打つ
4. PyGarden は別 commit / 別ブランチ or 別リポへ（Phase 2）

---

## 同期が必要なコード（触ったらセット）

| 変更内容 | 同期先 |
|----------|--------|
| `pyprojectResolve.js` | `nora-backend/.../pyproject_resolve.py` |
| `repo-policy.rules.json` | bootstrap_data + data + extension resources |
| checkRunner ルール | CMS `data/noraops/checks/` |
| 拡張 version | `package.json` + `client-latest.json` + 実装記録 |

詳細: [MAINTENANCE.md](./MAINTENANCE.md)
