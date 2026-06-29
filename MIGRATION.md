# ver1 → NoraOps 引っ越し手順

**実施者**: 手動（本書のチェックリストに従う）  
**元**: 移行元モノレポ（例: `../ver1/`）  
**先**: このリポジトリ（`NoraOps/`）

---

## 1. コピーするもの

| コピー元 (ver1) | コピー先 (NoraOps) | メモ |
|-----------------|----------------------|------|
| `vscode-extension/` | `vscode-extension/` | **フォルダごと**（`node_modules` は除く） |
| `softrail-server/` | `nora-backend/` | **フォルダごと**（ver1 側名は softrail-server） |
| `NoraOps/` | `NoraOps/` | 仕様 MD 一式（`archive/` 含む） |
| `docs/` | `docs/` | 既に NoraOps 側にある場合は上書き確認 |

### nora-backend で **除く**（コピーしない）

- `data/` 全体（ローカル DB・artifacts・tools バイナリ）
- `.pytest_cache/`
- `.env`（`.env.example` のみコピー）
- `vendor/`（配備時に `sync-vendor-extension.ps1` で再生成）

### vscode-extension で **除く**（コピーしない）

- `node_modules/` ? **消す／移動しない**。移行後に必要なら `npm install`（下記 §2b）
- `*.vsix`

### §2b ? node_modules の扱い

| やること | 理由 |
|----------|------|
| ver1 から **コピーしない** | 再現不能・容量巨大・OS 依存 |
| NoraOps に既にあるなら **削除** | `.gitignore` 対象。Git に載せない |
| 移行後 `npm install`（任意） | devDependencies は `@types/node` のみ。`npm test` は **Node 本体だけ**で動く |

```powershell
# 誤ってコピーしてしまった場合
Remove-Item -Recurse -Force NoraOps\vscode-extension\node_modules -ErrorAction SilentlyContinue
```

**package-lock.json** はコピーして **Git に含めてよい**（依存の固定用）。

---

## 2. コピーしないもの（ver1 に残す）

| パス | 理由 |
|------|------|
| `package.json`, `main.js`, `renderer/` 等 | **PyGarden**（別製品） |
| `node_modules/`（ver1 直下） | PyGarden 用 |
| `portal/` | 凍結済み PySide6 |
| その他 NoraOps 外 | ? |

---

## 3. コピー後の確認

```powershell
cd NoraOps\vscode-extension
npm test

cd ..\nora-backend
copy .env.example .env
# GITEA_* 等を設定
python -m pytest tests/ -q
```

### パス確認

- `nora-backend` の `extension_abs_dir` 既定: 兄弟 `../vscode-extension` ?
- 本番: `scripts/sync-vendor-extension.ps1` → `vendor/vscode-extension`

---

## 4. 移行後に更新するファイル（任意）

| ファイル | 内容 |
|----------|------|
| `NoraOps/実装記録.md` | 「NoraOps へ移行」1 行 |
| `docs/inventory.md` | ver1 参照を NoraOps 基準に |

---

## 5. Git 初期化（移行完了後）

```powershell
cd NoraOps
git init
git add .
git status   # 以下が含まれていないことを確認:
             #   node_modules/, nora-backend/data/, .env, *.vsix, vendor/
git commit -m "Initial NoraOps monorepo (from ver1 migration)"
git tag v0.16.0-baseline
# git remote add origin <URL>
# git push -u origin main
```

---

## 6. クイックコピー（PowerShell 例）

**実行前にパスを確認してください。**

```powershell
$src = "..er1"  # 移行元（環境に合わせて変更）
$dst = "."  # このリポジトリ（NoraOps）

# 拡張
robocopy "$src\vscode-extension" "$dst\vscode-extension" /E /XD node_modules .git /XF *.vsix

# サーバー
robocopy "$src\softrail-server" "$dst\nora-backend" /E /XD data .pytest_cache vendor .git __pycache__ .venv venv /XF .env

# 仕様 MD（未コピー分）
robocopy "$src\NoraOps" "$dst\NoraOps" /E /XD .git

# 開発用 uv（任意・ローカルのみ。Git には載せない）
robocopy "$src\softrail-server\data\tools\uv\0.6.0" "$dst\nora-backend\data\tools\uv\0.6.0" uv.exe .gitkeep
```

---

*PyGarden は ver1 に残すか、別リポ `PyGarden/` へ移動してください。*

---

## 7. 移行後のリネーム（実施済み）

| 旧 (ver1 / 移行直後) | 新 (NoraOps) | 理由 |
|----------------------|--------------|------|
| `softrail-server/` | `nora-backend/` | 製品名に合わせたフォルダ名 |
| `NoraOpsRep/` | `NoraOps/` | リポジトリ名と統一 |

ドキュメント内のパスは `nora-backend` 基準。ver1 からコピーする場合のみ §6 の robocopy 先名に注意。
