# VS Code拡張 開発者向け仕様

## 1. 目的
- 拡張導入時に、Windows実行に必要な `uv.exe` と `portable-git` を自動導入する。
- 取得元は自前サーバ（manifest + artifacts）を前提にする。

## 2. 初回導入フロー
1. 拡張起動 (`onStartupFinished`)
2. `pygarden.tools.manifestUrl` から manifest を取得
3. `uv` / `portableGit` のバージョン差分判定
4. 必要なartifactをダウンロード
5. SHA256検証
6. `.staging` に展開
7. 既存ディレクトリを `.bak` 退避し、renameで切り替え
8. `tool-state.json` を保存

## 3. 設定値 (`package.json` contributes.configuration)
- `pygarden.tools.manifestUrl`
  - 例: `http://127.0.0.1:8000/api/tools/windows-x64/manifest.json`
- `pygarden.tools.authToken`
  - Bearerトークン文字列
- `pygarden.tools.installRoot`
  - 未指定時は `%LOCALAPPDATA%\PyGardenRuntime`
- `pygarden.tools.channel`
  - `stable` / `canary`

## 4. exe配置場所（Windows）
- ルート: `%LOCALAPPDATA%\PyGardenRuntime`（または `installRoot`）
- `uv.exe`: `%LOCALAPPDATA%\PyGardenRuntime\tools\uv\uv.exe`
- `git.exe`: `%LOCALAPPDATA%\PyGardenRuntime\tools\portable-git\cmd\git.exe`
- state: `%LOCALAPPDATA%\PyGardenRuntime\tools\tool-state.json`
- cache: `%LOCALAPPDATA%\PyGardenRuntime\cache\`
- logs: `%LOCALAPPDATA%\PyGardenRuntime\logs\`

## 5. バージョン判定
- 次のいずれかで再導入:
  - 対象exeが存在しない
  - `tool-state.json` の version と manifest version が不一致
  - manifest `policy.forceMinimum*` 未満

## 6. manifest契約
- 必須キー:
  - `uv.version`, `uv.url`, `uv.sha256`
  - `portableGit.version`, `portableGit.url`, `portableGit.sha256`
- URLは社内配布基盤を想定（本番はHTTPS推奨）
- 推奨配置例（FastAPI）:
  - `http://<server>/api/tools/files/uv/<version>/uv.exe`
  - `http://<server>/api/tools/files/git/<version>/PortableGit-<version>-64-bit.7z.exe`
- `portableGit.url` は以下をサポート:
  - `.zip`（従来）
  - `.7z.exe`（Git for Windows Portable自己解凍exe）

## 7. エラーハンドリング
- ダウンロード失敗: setup画面にエラー表示
- ハッシュ不一致: インストール中断
- 展開失敗: `.bak` からロールバック
- UI上は Retry とログコピーを提供

## 8. 実行時ガード
- 実行コマンド (`pygarden.runFromManifest`) 前に `ensureRuntimeReady` を呼び、必要時だけ更新する。

## 9. アプリ配布との違い
- ツール導入用 manifest と、Gitea 上のアプリ用 manifest は別。詳細は [app-contract.md](app-contract.md) / サーバ側 [app-manifest-contract.md](../../nora-backend/docs/app-manifest-contract.md)。
- ランタイムキャッシュ削除コマンド: `pygarden.clearRuntimeCache`。

## 10. アンインストール
- 拡張アンインストールでは `%LOCALAPPDATA%\PyGardenRuntime` は残る。ユーザーが削除する場合は `PyGarden: Clear runtime cache` を案内する。

## 11. Gitea カタログ / Release 実行フロー
- コマンド: `PyGarden: Open App Catalog`（ホームのツール導入とは別 Webview）
- 設定:
  - `pygarden.gitea.baseUrl`, `pygarden.gitea.token`, `pygarden.gitea.orgs`
  - （任意）`pygarden.backplane.catalogUrl = http://127.0.0.1:8000/api/catalog/apps`
  - （任意）`pygarden.telemetry.url = http://127.0.0.1:8000`（実際の POST は `/api/telemetry/events` に送る）
- アプリ配置: `%LOCALAPPDATA%\PyGardenRuntime\apps\<owner_repo@tag>\`
- Release asset は `.zip` 優先、`manifest.softrail.json` で `uv sync` + `uv run`。
