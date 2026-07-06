# NoraOps メンテナンス — プロダクトを守るルール

引き継ぎ・リリース時に **必ず確認**するチェックリストです。

**現行拡張バージョン**: v0.26.0

---

## リリースチェックリスト（拡張）

| # | 項目 | パス / コマンド |
|---|------|-----------------|
| 1 | 拡張バージョン | `vscode-extension/package.json` → `version` |
| 2 | クライアント更新 JSON | `nora-backend/app/bootstrap_data/noraops/client-latest.json`（`data/` 側も） |
| 3 | 実装記録 | `NoraOps/実装記録.md` 先頭ブロック |
| 4 | API / コマンド差分 | `NoraOps/機能一覧とAPI.md` |
| 5 | テスト | `cd vscode-extension && npm test` · `cd nora-backend && pytest tests/` |
| 6 | 本番配備前 | `nora-backend/scripts/sync-vendor-extension.ps1` → `vendor/` 更新 |
| 7 | ライセンス | `docs/LICENSE.md` · `pip-licenses`（第三者変更時） |
| 8 | ドキュメント | `docs/README.md` · `docs/flows/07-*`（機能追加時） |

---

## VSIX ビルド（uv 同梱版）

オフライン向けに `uv.exe` を VSIX に入れる手順:

```powershell
# 1. uv.exe を resources に配置（約 65MB）
.\vscode-extension\scripts\stage-bundled-uv.ps1
# または明示パス:
# .\vscode-extension\scripts\stage-bundled-uv.ps1 -Source "nora-backend\data\tools\uv\0.6.0\uv.exe"

# 2. VSIX 生成
cd vscode-extension
npm run package
# → noraops4code-0.23.0.vsix

# 3. サーバー static へ（配布時）
Copy-Item noraops4code-*.vsix ..\nora-backend\app\static\noraops4code.vsix -Force
```

| 項目 | 内容 |
|------|------|
| 同梱パス | `vscode-extension/resources/tools/windows-x64/uv.exe` |
| 設定 | `noraops.tools.useBundledUv`（既定 ON） |
| 初回利用時 | `%LOCALAPPDATA%\NoraOps\runtime\tools\uv\uv.exe` へコピー |
| Git | `uv.exe` は通常 **Git 未追跡**（サイズ大）。CI/配布時のみ stage |

`.vscodeignore` は `resources/tools` を除外していない → **ファイルがあれば VSIX に入る**。

---

## ルール JSON（3 箇所同期）

変更時は **すべて** 更新:

| # | パス |
|---|------|
| 1 | `nora-backend/app/bootstrap_data/noraops/checks/` |
| 2 | `nora-backend/data/noraops/checks/` |
| 3 | `vscode-extension/resources/checks/` |

---

## pyproject 探索（JS / Python 同期）

| 言語 | ファイル |
|------|----------|
| JS | `vscode-extension/src/noraops/pyprojectResolve.js` |
| Py | `nora-backend/app/noraops/services/pyproject_resolve.py` |

**片方だけ直さない。**

---

## プロンプト帳（builtin catalog）

| 層 | パス |
|----|------|
| サーバー正本 | `nora-backend/app/bootstrap_data/noraops/prompts/builtin-catalog.json` |
| 拡張 | `builtinPromptCatalog.js` · `promptPanel.js` |
| ドキュメント | `nora-backend/docs/prompts-catalog.md` |

---

## リポジトリ監査

| 役割 | 場所 |
|------|------|
| エンジン | 拡張 `checkRunner.js`（Python 書き直し禁止） |
| CLI | `vscode-extension/scripts/repo-audit-cli.js` |
| サーバー | subprocess + `NORAOPS_NODE_*` + `NORAOPS_EXTENSION_DIR` |

---

## Runner 関連のローカルデータ

| パス | 内容 |
|------|------|
| `runner-apps/` | artifact / ZIP 展開キャッシュ |
| `runner-envs/` | Runner 用 venv |
| `runner-dotenv/` | `.env` ストア（ZIP に含めない秘密の退避） |
| `runner-thumbs/` | サムネ PNG キャッシュ |
| `launchers/` | デスクトップ SC 用 `.cmd` / `runner-launch.js` |
| `local-runner-apps.json` | 手動 ZIP 取込レジストリ |

詳細: [flows/06-データのつながりと保管.md](./flows/06-データのつながりと保管.md)

---

## ドキュメント更新タイミング

| 変更内容 | 更新する doc |
|----------|--------------|
| 新 UI タブ / モード | `flows/07-モードと機能マップ.md` |
| 新 API | `NoraOps/機能一覧とAPI.md` + `flows/05` |
| データ保管先変更 | `flows/06` |
| セットアップ手順 | `flows/01` + `NoraOpsの導入.md` |

**入口**: `docs/README.md`

**archive/**: PR レビュー・設計判断に使わない

---

## やってはいけない

- archive 内 MD を根拠に実装する
- ルール JSON を 1 箇所だけ更新する
- 本番で PATH の Node に依存する（`NORAOPS_NODE_EXE` を設定）
- PyGarden（ver1 直下 Electron）を NoraOps リリースに含める
- `uv.exe` 無しで閉域向け VSIX を配布してから「オフラインで動かない」と驚く（先に stage）
