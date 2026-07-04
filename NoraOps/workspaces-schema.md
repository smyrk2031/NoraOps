# AppData workspaces スキーマ（nora.workspace/1）

**正本**: [ワークスペース設計改定.md](./ワークスペース設計改定.md) §7  
**実装**: `vscode-extension/src/noraops/workspaceStore.js`

---

## 1. ファイル配置

```text
%LOCALAPPDATA%\NoraOps\
  workspaces\
    {workspaceKey}.json
```

| 項目 | 値 |
|------|-----|
| `workspaceKey` | `sha256(normalize(absPath)).hex` の先頭 32 文字 |
| `normalize` | `path.resolve` → `\` を `/` → 小文字（Windows） |

テスト時は環境変数 `NORAOPS_LOCAL_ROOT` で `NoraOps` ルートを上書き可能。

---

## 2. JSON スキーマ

```json
{
  "schema": "nora.workspace/1",
  "workspaceKey": "a1b2…",
  "workspacePath": "F:/projects/my-app",
  "updatedAt": "2026-06-20T12:00:00.000Z",

  "appId": "nora.app.550e8400-e29b-41d4-a716-446655440000",
  "displayName": "My App",
  "creatorProfile": "import",
  "creatorWorkflow": "import",

  "giteaRepoId": 42,
  "giteaFullName": "team/my-app",
  "giteaOwner": "team",
  "giteaName": "my-app",
  "cloneUrl": "https://gitea.example/team/my-app.git",

  "lastSave": "12:34",
  "lastPushOk": true,
  "lastPublished": true,
  "lastPublishedVersion": "0.2.0",
  "lastPublishedTag": "v0.2.0",
  "lastPublishedAt": "2026-06-20T11:00:00.000Z",

  "importRequirementsPath": "requirements.txt",
  "pythonEnvReady": true,
  "pythonExe": "F:/projects/my-app/.venv/Scripts/python.exe",

  "online": true,
  "secIssues": 0,
  "polIssues": 0,

  "pythonEnv": {
    "venvDir": "F:/projects/my-app/.venv",
    "venvName": ".venv",
    "python": "F:/projects/my-app/.venv/Scripts/python.exe",
    "projectDir": "F:/projects/my-app",
    "updatedAt": "2026-06-20T12:00:00.000Z"
  },

  "securityWarnState": {
    "schema": "nora.security-warn-state/1",
    "suppressed": ["abc123…"],
    "reviewed": ["def456…"],
    "updatedAt": "2026-06-20T12:00:00.000Z"
  },

  "creatorPromptsSchema": "nora.creator-prompts/1",
  "creatorPromptsMeta": {
    "catalogVersion": "0.21.0",
    "remoteCatalogVersion": null,
    "builtinStates": {
      "xllm.general": { "enabled": true }
    }
  },
  "creatorPromptsCustom": [
    {
      "id": "a1b2c3d4",
      "title": "独自プロンプト",
      "body": "…",
      "enabled": true,
      "showInXllm": true,
      "order": 1000,
      "createdAt": "2026-06-21T10:00:00.000Z",
      "updatedAt": "2026-06-21T10:00:00.000Z"
    }
  ],

  "connectProfilesSchema": "nora.connect-profiles/1",
  "connectProfiles": [
    {
      "id": "a1b2c3d4",
      "name": "Health check",
      "method": "GET",
      "url": "http://127.0.0.1:8000/api/health",
      "headers": [{ "key": "Accept", "value": "application/json" }],
      "body": "",
      "contentType": "application/json",
      "order": 10,
      "createdAt": "2026-06-21T10:00:00.000Z",
      "updatedAt": "2026-06-21T10:00:00.000Z"
    }
  ],
  "connectHistorySchema": "nora.connect-history/1",
  "connectHistory": [
    {
      "id": "h1",
      "profileId": "a1b2c3d4",
      "profileName": "Health check",
      "executedAt": "2026-06-21T11:00:00.000Z",
      "request": {
        "method": "GET",
        "url": "http://127.0.0.1:8000/api/health",
        "headers": [],
        "body": "",
        "contentType": "application/json"
      },
      "result": {
        "ok": true,
        "status": 200,
        "durationMs": 42,
        "bodyText": "{\\"status\\":\\"ok\\"}"
      }
    }
  ],

  "creatorUi": {
    "schema": "nora.creator-ui/1",
    "creatorViewId": "xllm",
    "xllm": {
      "scopeMode": "pick",
      "scopeSubMode": "tree",
      "scopePaths": ["main.py"],
      "compressMode": "standard",
      "promptKey": "xllm.general"
    },
    "updatedAt": "2026-06-21T12:00:00.000Z"
  }
}
```

---

## 3. フィールド一覧

### 3.1 メタ（必須）

| フィールド | 型 | 説明 |
|-----------|-----|------|
| `schema` | string | `"nora.workspace/1"` |
| `workspaceKey` | string | ファイル名の stem |
| `workspacePath` | string | 最後に書き込んだ絶対パス |
| `updatedAt` | ISO8601 | 最終更新 |

### 3.2 セッション（`readWorkspaceSession` が返すフラット項目）

| フィールド | 説明 |
|-----------|------|
| `appId` | manifest と同期 |
| `displayName` | UI 表示名 |
| `creatorProfile` | `greenfield` / `import` / `fork` / `venv-only`（将来） |
| `creatorWorkflow` | 現行 UI モード（`greenfield` / `import`） |
| `giteaRepoId` | Gitea API `id`（Phase 4） |
| `giteaFullName`, `giteaOwner`, `giteaName` | 保存先キャッシュ |
| `cloneUrl` | 表示用 |
| `lastSave`, `lastPushOk` | 保存 UI |
| `lastPublished*` | 公開 UI |
| `importRequirementsPath` | import ウィザード |
| `pythonEnvReady`, `pythonExe` | セッション補助（pythonEnv と同期） |
| `online`, `secIssues`, `polIssues` | チェック UI キャッシュ |

### 3.3 ネスト

| キー | 内容 |
|------|------|
| `pythonEnv` | `python-env.json` 相当（`pythonEnv.js`） |
| `securityWarnState` | 警告確認状態（`securityWarnStore.js`） |
| `creatorPromptsMeta` | 基本プロンプトの有効状態・サーバー同期版（`creatorPrompts.js`） |
| `creatorPromptsCustom` | マイプロンプト配列（`creatorPrompts.js`） |
| `connectProfiles` | Connect タブの API 接続プロファイル（`connectProfiles.js`） |
| `connectHistory` | Connect 実行履歴（直近 50 件・`connectHistory.js`） |
| `creatorUi` | Creator Webview の入力・xLLM スコープ・`promptKey` 等（`creatorUiState.js`） |

---

## 4. 読み書き規則

| 操作 | ルール |
|------|--------|
| **読** | AppData → 不足分を `.nora/*` から補完（lazy import） |
| **書** | **AppData のみ**（`.nora` には書かない） |
| **移行** | 初回 `readWorkspaceRecord` で legacy を AppData に取り込み |

Legacy パス:

- `.nora/session.json`
- `.nora/python-env.json`
- `.nora/security-warn-state.json`

---

## 5. API（拡張内部）

| 関数 | 用途 |
|------|------|
| `workspaceKey(root)` | キー生成 |
| `readWorkspaceRecord(root)` | フルレコード |
| `writeWorkspaceRecord(root, patch)` | 部分更新 |
| `readWorkspaceSession(root)` | セッション形（pathsMeta 互換） |
| `writeWorkspaceSession(root, patch)` | セッション更新 |
| `readPythonEnvMeta(root)` | pythonEnv ブロック |
| `writePythonEnvMeta(root, meta)` | pythonEnv 更新 |
| `readSecurityWarnState(root)` | securityWarnState ブロック |
| `writeSecurityWarnState(root, state)` | securityWarnState 更新 |

---

*最終更新: v0.21 — creatorPrompts / creatorUi*
