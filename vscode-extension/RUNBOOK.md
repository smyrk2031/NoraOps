# NoraOps4code Runbook

## Save → Gitea (v0.5.0+)

1. Extension zips workspace (excludes `.git`, `.venv`, `.env`, …).
2. Extension uploads to FastAPI:
   - `POST /api/v1/noraops/push/sessions` (`scope: write`) → `pushToken`
   - `POST /api/v1/repos/save` (multipart `workspace`) with `Authorization: Bearer <pushToken>`
3. Server safe-extracts zip and `git push` to Gitea using `GITEA_TOKEN` only.

**Users do not configure Gitea PAT in VS Code.** No local `git commit` / bundle during save.

## Runner (v0.5.0+)

1. `POST /api/v1/noraops/push/sessions` (`scope: read`)
2. `GET /api/v1/portal/apps/{owner}/{name}/artifact` → extract under `%LOCALAPPDATA%\NoraOps\runner-apps\`
3. Client `uv sync` + `uv run` (no git clone)

Publish (`POST /api/v1/repos/publish`) triggers background artifact zip build on server.

## Server requirements

- `GITEA_BASE_URL`, `GITEA_TOKEN` in `nora-backend/.env`
- PAT scopes: **user** and **repository** = read+write (Gitea 1.26 needs `write:user` for repo create)
- `git` on server `PATH` (clone, push, artifact build)
- Optional: `NORAOPS_PUSH_SESSION_TTL_MINUTES`, `NORAOPS_SAVE_MAX_ZIP_MB`, `NORAOPS_ARTIFACTS_DIR`

## Troubleshooting

| Symptom | Check |
|---------|--------|
| Empty repo on Gitea | Save failed; re-save. Check server logs / `GITEA_TOKEN` |
| `503` on save | Server `git`? Token valid? |
| `401` on save/download | Session expired; retry |
| `413` on save | Raise `NORAOPS_SAVE_MAX_ZIP_MB` |
| Runner: no artifact | Publish app first; wait for background zip build |
| `400` zip rejected | Forbidden paths (`.env`) or Zip Slip |

## Extension dev

- F5 from `vscode-extension/`
- Setting: `noraops.server.baseUrl` only (e.g. `http://127.0.0.1:8000`)

## App identity & save safety (v0.12.0+)

| 概念 | 説明 |
|------|------|
| **表示名** | ユーザーが付ける名前（日本語 OK）。`nora/manifest.json` の `displayName` |
| **リポ slug** | クラウド上の英数字名。初回保存時に決定・重複 NG |
| **appId** | `nora.app.{UUID}` — 不変。サーバー DB `nora_app_registry` でリポと 1:1 紐づけ |

- 初回保存: 表示名を入力 → 確認 → クラウドに登録
- 2 回目以降: **保存する** ボタンだけ（メニューなし）
- 別アプリを誤って同じ保存先へ save しようとすると **409** で拒否

## Creator UI (v0.14.0+)

- トップ: アプリ名 + **大きな 1 ボタン**（今やることだけ表示）
- 流れ: 雛形 → AI で作る → 環境 → 試す → 保存 → Runner
- **起動ファイル**: 作る / クラウド モーダルから階層一覧で選択
- **コンシェルジュ**: 解析後に結果モーダル（類似アプリ README・プロンプト編集・AI 連携）
- 4 タイル（準備 / 作る / 環境 / クラウド）は詳細用
- クラウド: 接続自動確認、サムネ現在/プレビュー、起動ファイル設定

## CMS とチェックルール（管理者向け）

| 種類 | CMS（/admin/cms） | コード側 |
|------|-------------------|----------|
| **チェック ON/OFF** | ○ トグル UI | `check-toggles.json` に自動保存 |
| **ルール定義** | × JSON 編集廃止 | `*.rules.json` + `checkRunner.js` |
| **新 kind** | × | 拡張リリース + `docs/CHECKS.md` 参照 |
| **コンシェルジュ / 環境プロンプト** | ○ Markdown 編集 | サーバーが合成 → 拡張は表示のみ |
| **基本プロンプトカタログ** | ○ 一覧・追加・編集・削除 | `data/noraops/prompts/builtin-catalog.json` — 詳細: `nora-backend/docs/prompts-catalog.md` |
| **MCP ソース** | 参照のみ（未配信） | `sources.example.json` + 将来 API |

- 拡張は起動・保存前に `GET /api/v1/checks/rules` で bundle 取得（無効ルールはサーバー側で除外）
- 詳細: `nora-backend/docs/CHECKS.md`

## AI 連携（サーバー設定）

| 環境変数 | 説明 |
|---------|------|
| `NORAOPS_AI_ENABLED` | AI 全体 ON/OFF |
| `NORAOPS_COPILOT_ENABLED` | Copilot BYOK（既定 ON） |
| `NORAOPS_CONTINUE_ENABLED` | （非推奨・拡張未使用）サーバー側 Continue 中継の既定 |
| `NORAOPS_COPILOT_MIN_HOST_VERSION` | Copilot BYOK 推奨 VS Code（既定 1.122.0） |

`/api/v1/noraops/ai/status` の `features.copilot` で拡張が Copilot BYOK を判定。

## Tools bootstrap

`NoraOps: ツールをセットアップ` installs **uv** (required). **git** is optional for users (server uses git; Runner/Creator save do not).

See [nora-backend/docs/app-artifact-contract.md](../nora-backend/docs/app-artifact-contract.md).

## Tests & smoke checks

→ [NoraOps/テストと動作確認.md](../NoraOps/テストと動作確認.md)

```powershell
npm test
# GUI: NoraOps: 動作確認（主要機能）
```
