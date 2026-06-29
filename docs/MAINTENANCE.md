# NoraOps メンテナンス — プロダクトを守るルール

## リリースチェックリスト（拡張 v0.x）

1. `vscode-extension/package.json` の `version`
2. `nora-backend/app/bootstrap_data/noraops/client-latest.json`（および `data/` 側）
3. `NoraOps/実装記録.md` 先頭ブロック
4. `NoraOps/機能一覧とAPI.md` に API / コマンド差分
5. `npm test`（拡張）+ `pytest tests/`（サーバー）
6. 本番前: `sync-vendor-extension.ps1` → `vendor/` 更新
7. 第三者ライセンス変更時: `docs/LICENSE.md` と `pip-licenses` 再実行

---

## ルール JSON（3 箇所同期）

変更時は **すべて** 更新する:

- `nora-backend/app/bootstrap_data/noraops/checks/`
- `nora-backend/data/noraops/checks/`
- `vscode-extension/resources/checks/`

---

## pyproject 探索

- JS: `vscode-extension/src/noraops/pyprojectResolve.js`
- Py: `nora-backend/app/noraops/services/pyproject_resolve.py`

片方だけ直さない。

---

## リポジトリ監査

- エンジン: 拡張 `checkRunner.js`（Python 書き直し禁止）
- CLI: `vscode-extension/scripts/repo-audit-cli.js`
- サーバー: subprocess + `NORAOPS_NODE_*` + `NORAOPS_EXTENSION_DIR`

---

## ドキュメント

- **入口**: `docs/README.md`
- **実装判断**: 現状とアーキテクチャ / 機能一覧 / 実装記録
- **archive/**: PR レビュー・設計判断に使わない

---

## やってはいけない

- archive 内 MD を根拠に実装する
- ルール JSON を 1 箇所だけ更新する
- 本番で PATH の Node に依存する（`NORAOPS_NODE_EXE` を設定）
- PyGarden（ver1 直下 Electron）を NoraOps リリースに含める
