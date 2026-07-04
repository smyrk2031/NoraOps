# ver1 棚卸し一覧

実施日: 2026-06-20（初版）· **docs メンテ**: 2026-07（v0.23 反映）  
Git: リポ root の状態は [MIGRATION.md](../MIGRATION.md) を参照

---

## 0.1 ver1 直下

| パス | 分類 | メモ |
|------|------|------|
| `vscode-extension/` | NoraOps 現行 | 拡張正本。監査 CLI 含む |
| `nora-backend/` | NoraOps 現行 | FastAPI 正本 |
| `NoraOps/` | NoraOps 現行 | 仕様 MD（入口は `docs/README.md` へ移行中） |
| `docs/` | NoraOps 現行 | **新設** — ドキュメント入口・棚卸 |
| `portal/` | NoraOps 凍結 | PySide6。Runner は拡張に統合済 |
| `package.json`, `main.js`, `renderer/` 等 | **別製品** | PyGarden（Electron）。NoraOps と無関係 |
| `node_modules/`（ver1 直下） | 別製品 | PyGarden 用 |
| `nora-backend/data/` | 生成・ローカル | DB / tools / artifacts。`.gitignore` 要確認 |
| `.gitignore` | NoraOps 現行 | 拡張予定（monorepo 用） |

---

## 0.2 NoraOps ドキュメント（直下）

| MD | 主分類 | タグ | 正本? | メモ |
|----|--------|------|-------|------|
| README.md | 実装あり | 要更新 | 入口→`docs/README` | リダイレクト化 |
| 現状とアーキテクチャ.md | 実装あり | 現行 | **yes** | 実装判断 |
| 機能一覧とAPI.md | 実装あり | 現行 | **yes** | router 差分は随時 |
| 実装記録.md | 実装あり | 現行 | **yes** | リリース正本 |
| 開発時用の動作手順書.md | 実装あり | 要更新 | yes | 524 行・PyGarden 断片要整理 |
| テストと動作確認.md | 実装あり | 現行 | yes | |
| NoraOpsの導入.md | 実装あり | 現行 | yes | |
| 認証モードとGitea運用.md | 実装あり | 現行 | yes | |
| IIS-ARR配備.md | 実装あり | 現行 | yes | |
| 開発者向けガイド.md | 実装あり | 現行 | 補助 | |
| ワークスペース設計改定.md | 実装あり | 現行 | yes | 設計正本 |
| ワークスペース改定_確認手順.md | 実装あり | 現行 | 補助 | 改定の QA |
| 互換方針.md | 実装あり | 現行 | yes | pyprojectResolve 等 |
| workspaces-schema.md | 実装あり | 現行 | yes | AppData |
| Giteaリポジトリ要件.md | 実装あり | 現行 | yes | 監査・zip 含む |
| ポリシーチェックルール.md | 実装あり | 現行 | yes | CMS rules |
| Runner利用ガイド.md | 実装あり | 現行 | 補助 | |
| 縦通し体験手順.md | 実装あり | 現行 | 補助 | 手動 E2E |
| PyPIミラー運用.md | ドキュメントのみ | 重複 | no | 正本は nora-backend/docs 連携設定書 |
| サーバー接続設定.md | 実装あり | 要更新 | 補助 | |
| 接続の堅牢性チェック.md | 実装あり | 要更新 | 補助 | |
| Copilot-BYOK連携.md | 実装あり | 要更新 | 補助 | AI 一部実装 |
| 生成AI連携構想.md | ドキュメントのみ | 要更新 | no | 構想 + 一部実装 |
| 今後のUX改善.md | ドキュメントのみ | 現行 | バックログ | 実装判断に使わない |
| manifest-v2-草案.md | ドキュメントのみ | 現行 | 草案 | |
| リポジトリ整理プラン.md | 実装あり | 現行 | 計画 | Phase 0 完了 |
| 棚卸プラン.md | 実装あり | 現行 | 手順 | 本 inventory が成果物 |
| 260607_メモ.md | ドキュメントのみ | archive済 | no | → archive へ移動 |

---

## 0.2b NoraOps/archive

| 扱い | メモ |
|------|------|
| 全 17 ファイル | **archive済** — 実装判断・PR レビューに使わない |
| README.md | archive 入口 |

---

## 0.3 拡張モジュール（要約）

| 領域 | 正本モジュール | メモ |
|------|----------------|------|
| 保存 | `serverSave.js`, `savePipeline.js`, `saveFlow.js` | zip → POST /repos/save |
| ポリシー | `checkRunner.js`, `securityGate.js` | サーバー監査も同一 CLI |
| パス | `pyprojectResolve.js`, `projectPaths.js`, `workspaceStore.js` | Python 側と同期 |
| Runner | `runner/artifactRunner.js`, `runnerZipImport.js`, `runnerDesktopShortcut.js` | artifact / ZIP / SC |
| 認証 | `noraopsApi.js`, `setupConnection.js` | push session |

詳細: `vscode-extension/docs/MODULES.md`

---

## 0.4 API 差分（要 follow-up）

### コードにあり一覧要確認

| API | 分類 | メモ |
|-----|------|------|
| `POST /api/v1/repos/push` | **廃止候補** | bundle push。拡張から未参照 |
| `POST /api/admin/repo-audit/*` | 要 MD 追記 | 監査 API（新規） |

### 一覧にあるが deprecated 扱い

- git bundle 保存 → zip save が正本（機能一覧に記載済み想定）

---

## 0.5 廃止・凍結候補

| # | 対象 | 結果 | メモ |
|---|------|------|------|
| 1 | `POST /repos/push` | **廃止候補** | 拡張 grep: `/repos/push` なし |
| 2 | `portal/` | **凍結** | 削除は Phase 3 |
| 3 | PyGarden ルート | **別製品** | Phase 2 で分離 |
| 4 | ver1 直下 `.git` なし | **要対応** | 1 リポ化の前提 |
| 5 | ルール JSON 3 箇所 | **要同期** | bootstrap / data / extension resources |

---

## サマリ

- **実装あり（正本）**: 5 本 + MODULES + .env.example
- **要更新 MD**: 開発手順書、AI 系、接続系
- **廃止候補**: bundle push API、portal/
- **Phase 1 優先**: `docs/README` 入口、`flows/07` モードマップ、`MAINTENANCE` uv 同梱手順
- **v0.23 追加機能**: Runner ZIP 取込 · デスクトップ SC · プロンプト帳 · uv VSIX 同梱
