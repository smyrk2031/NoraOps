# NoraOps4code モジュール構成（v0.27）

拡張の入口は `src/extension.js` → `noraops/activate.js` のみ。機能はフォルダ単位で改修する。

**シェル UI**: 単一 Webview `noraOpsShell.js` が Setting / Connect / **Prompt** / Creator / Runner を切替（`retainContextWhenHidden` はタブ内のみ。タブ間は AppData で状態復元）。

**ワークスペース改定**: パス解決・AppData 移行の設計は [NoraOps/ワークスペース設計改定.md](../../NoraOps/ワークスペース設計改定.md)。**Phase 1 実装**: `workspaceStore.js`（session / pythonEnv / securityWarn / **creatorPrompts** / **creatorUi** → AppData、`.nora` 読取フォールバック）。改修時は `scaffold.js`, `pathsMeta.js`, `pythonEnv.js`, `repoMeta.js` を中心に互換を維持すること。

## バックアップ（3 層 — 混同注意）

| 層 | 対象 | 保存先 | 用途 |
|----|------|--------|------|
| **① サーバー資産** | NoraOps DB + `data/` + Gitea（repos・DB・app.ini） | `NORAOPS_BACKUP_LOCAL_DIR`（+ 任意で `NORAOPS_BACKUP_REMOTE_DIR`） | **サーバー故障時の復旧** — [バックアップと復元.md](../../NoraOps/バックアップと復元.md) · `/admin/backup` |
| **② アプリのクラウド保存** | ユーザのワークスペース zip | Gitea リポ | PC 故障時に別 PC から再取得 |
| **③ この PC** | 直近のクラウド保存コピー | `noraops.backup.localRoot` 等 | 誤操作の元戻し（2 件） |

① は `nora-backend` の `backup_service.py` + スケジューラ（既定 24h・3 世代）。`.env` は ZIP に含まれないため別途安全に保管すること。

## レイヤ一覧

| 領域 | ファイル | 責務 |
|------|----------|------|
| **シェル** | `noraOpsShell.js`, `setupPanel.js`, `promptPanel.js`, `homePanel.js`, `runner/runnerPanel.js` | 4 タブ切替・メッセージルーティング |
| **Creator UI** | `homePanel.js`, `media/noraops-home.html` | 1 ボタン導線・タイル+モーダル |
| **Prompt** | `creatorPrompts.js`, `builtinPromptCatalog.js`, `promptResolve.js`, `promptSync.js`, `media/noraops-prompt.html` | 基本/マイプロンプト帳・xLLM 連携・サーバー同期 |
| **保存** | `savePipeline.js`, `saveFlow.js` | 保存オーケストレーション（紐づけ済みは push 直行） |
| | `serverSave.js`, `workspaceZip.js` | zip → `POST /repos/save`（`app_id` 付き） |
| | `entryPicker.js`, `appEntry.js` | 起動ファイル指定・解決 |
| **アプリ ID** | `appIdentity.js` | UUID `appId` 発行 |
| **リポ** | `repoMeta.js`, `repoSetup.js`, `repoAccess.js`, `repoIdentityPick.js` | Gitea 紐づけ・初回命名・ACL UI・新規リポ用途選択 |
| | `noraopsApi.js` | FastAPI JSON API |
| **Runner** | `runner/artifactRunner.js` | artifact DL + uv 起動 |
| | `runner/runnerPanel.js`, `catalogClient.js` | UI・カタログ |
| | `artifactDownload.js`, `runnerPaths.js` | キャッシュパス・展開 |
| **Python** | `pythonEnv.js`, `workspaceStore.js`, `projectPaths.js` | uv venv、AppData 状態、pyproject/venv 解決（ルート優先） |
| **チェック** | `checkRunner.js`, `rulesClient.js` | ポリシー・セキュリティ |
| **保存** | `savePipeline.js`, `saveFlow.js`, `serverSave.js`, `workspaceZip.js`, `saveHistory.js`, `saveInventory.js` | ZIP クラウド保存 / ローカルバックアップ2件・復元 |
| **xLLM** | `xllmExport.js`, `xllmPromptModes.js`, `xllmPolicyNotice.js`, `xllmCompress.js`, `xllmFileTree.js`, `xllmResponseParse.js`, `xllmApply.js`, `xllmHistory.js`, `xllmErrorCapture.js`, `xllmDiff.js`, `creatorUiState.js`, `creatorPrompts.js` | 外部 AI 向け export（`promptKey`）/ 圧縮・スコープ / 返答のゆるい解析・適用 / 履歴 |
| **ツール** | `toolInstaller.js` ← `../toolManager.js` | uv 配布 |
| **git（限定的）** | `gitExec.js` | 表示用 origin メタのみ（バックアップ履歴は `saveHistory.js`） |

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
