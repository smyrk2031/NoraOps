# NoraOps チェックルール（FastAPI 正本）

拡張は `GET /api/v1/checks/rules` で取得（etag / 304 対応）。オフライン時は `vscode-extension/resources/checks/` の同梱 JSON。

| ファイル | 内容 |
|----------|------|
| `security.rules.json` | セキュリティ（**Phase1: `sec.ip_literal` のみ**） |
| `repo-policy.rules.json` | リポ構成（README / nora/manifest 等） |

ルールを変えたら **FastAPI を再起動**し、拡張側は次回保存・F5 前に自動取得されます。
