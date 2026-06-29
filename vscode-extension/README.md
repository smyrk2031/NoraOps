# NoraOps4code（vscode-extension）

Creator / Runner 拡張。

## 移行

`ver1/vscode-extension/` から本フォルダへコピーしてください。  
手順: [../MIGRATION.md](../MIGRATION.md)

**除くもの**: `node_modules/`, `*.vsix`

## 開発（移行後）

```powershell
npm test
npm run repo-audit -- --workspace <path> --rules <bundle.json>
```

### VSIX ビルド（配布用）

```powershell
npx --yes @vscode/vsce package --no-dependencies
# → noraops4code-0.19.1.vsix（package.json の version に追随）

# サーバー配布に載せる場合（例）
Copy-Item noraops4code-*.vsix ..\nora-backend\app\static\noraops4code.vsix -Force
# client-latest.json の version / releaseNotes も更新
```

F5 デバッグ: 本フォルダを VS Code で開く。

## 本番接続

1. `noraops.server.baseUrl` — ポータル URL（Setting タブから設定）
2. 本番（`email_token`）: Setting › **アカウント** でメール登録 → NoraAccessToken を設定

詳細: [../NoraOps/認証モードとGitea運用.md](../NoraOps/認証モードとGitea運用.md)
