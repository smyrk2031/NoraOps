# NoraOps4code モジュール構成（v0.13）

拡張の入口は `src/extension.js` → `noraops/activate.js` のみ。機能はフォルダ単位で改修する。

**ワークスペース改定**: パス解決・AppData 移行の設計は [NoraOps/ワークスペース設計改定.md](../../NoraOps/ワークスペース設計改定.md)。**Phase 1 実装**: `workspaceStore.js`（session / pythonEnv / securityWarn → AppData、`.nora` 読取フォールバック）。改修時は `scaffold.js`, `pathsMeta.js`, `pythonEnv.js`, `repoMeta.js` を中心に互換を維持すること。

## レイヤ一覧

| 領域 | ファイル | 責務 |
|------|----------|------|
| **Creator UI** | `homePanel.js`, `media/noraops-home.html` | 1 ボタン導線・タイル+モーダル |
| **保存** | `savePipeline.js`, `saveFlow.js` | 保存オーケストレーション（紐づけ済みは push 直行） |
| | `serverSave.js`, `workspaceZip.js` | zip → `POST /repos/save`（`app_id` 付き） |
| | `entryPicker.js`, `appEntry.js` | 起動ファイル指定・解決 |
| **アプリ ID** | `appIdentity.js` | UUID `appId` 発行 |
| **リポ** | `repoMeta.js`, `repoSetup.js` | Gitea 紐づけ・初回命名モーダル |
| | `noraopsApi.js` | FastAPI JSON API |
| **Runner** | `runner/artifactRunner.js` | artifact DL + uv 起動 |
| | `runner/runnerPanel.js`, `catalogClient.js` | UI・カタログ |
| | `artifactDownload.js`, `runnerPaths.js` | キャッシュパス・展開 |
| **Python** | `pythonEnv.js`, `workspaceStore.js`, `projectPaths.js` | uv venv、AppData 状態、pyproject/venv 解決（ルート優先） |
| **チェック** | `checkRunner.js`, `rulesClient.js` | ポリシー・セキュリティ |
| **xLLM** | `xllmExport.js`, `xllmPromptModes.js`, `xllmPolicyNotice.js`, `xllmApply.js`, `xllmHistory.js`, `xllmErrorCapture.js`, `xllmDiff.js` | 外部 AI 向け export（通常/エラー調査/ドキュメント一式）/ 送信前チェック要約 / 適用前プレビュー / 履歴切り戻し |
| **ツール** | `toolInstaller.js` ← `../toolManager.js` | uv 配布 |
| **git（限定的）** | `gitExec.js` | 履歴表示・表示用 origin のみ |

## サーバー（app レジストリ）

| ファイル | 責務 |
|----------|------|
| `app/db/models.py` → `AppRegistryEntry` | appId ↔ owner/name |
| `app/noraops/services/app_registry_service.py` | 登録・save 時検証 |
| `repo_provision.py` | 作成時に register |
| `repo_save.py` | zip 内 manifest.appId を検証 |

## 削除済み遺産（v0.6）

- `gitBundle.js`, `serverPush.js` — bundle 保存
- `src/appRunner.js`, `giteaApi.js` — 旧 PyGarden 直結 Gitea

## 動作確認・テスト

→ **[NoraOps/テストと動作確認.md](../../NoraOps/テストと動作確認.md)**（正）

| 種類 | モジュール / コマンド |
|------|----------------------|
| GUI スモーク | `healthCheck.js`, `healthCheckUi.js`, `noraops.runHealthCheck` |
| ユニット | `npm test` → `test/*.test.js` |

```powershell
cd vscode-extension
npm test
```
