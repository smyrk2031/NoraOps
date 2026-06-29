# GitHub Copilot BYOK 連携（Phase 1）

## 概要

組織の **FastAPI（nora-backend）** で `NORAOPS_AI_ENABLED=1` のときだけ、**NoraOps4code 拡張**が次を行います。

1. サーバーへの通信と Azure OpenAI 設定の確認
2. GitHub Copilot 拡張の有無
3. ワークスペースの機密プリフライト（`.env` 等）
4. 「個人 Copilot ではなく組織ゲートウェイのみ」の明示同意
5. （ブロッカーが無い場合）`GET /api/v1/noraops/ai/probe` で Azure 接続テスト

`NORAOPS_AI_ENABLED=0` のときは Creator の Copilot カードは表示されません。

## サーバー設定（.env）

```env
NORAOPS_AI_ENABLED=1
AZURE_OPENAI_ENDPOINT=https://<resource>.openai.azure.com
AZURE_OPENAI_API_KEY=<key>
AZURE_OPENAI_DEPLOYMENT=<deployment-name>
AZURE_OPENAI_API_VERSION=2024-02-15-preview
NORAOPS_AI_DAILY_TOKEN_LIMIT=0
NORAOPS_AI_REQUIRE_ORG_GATEWAY=1
```

## API

| メソッド | パス | 内容 |
|----------|------|------|
| GET | `/api/v1/noraops/ai/status` | 有効化・設定・本日使用量 |
| GET | `/api/v1/noraops/ai/probe` | Azure へ最小 chat 完了（接続確認） |
| GET | `/api/v1/noraops/ai/copilot-policy` | 拡張向けポリシー・禁止パターン |

互換: `/api/v1/ai/status` も同じ内容を返します。

## 拡張での操作

- **Creator** → 「Copilot / BYOK（組織 AI）」→ **準備チェック**
- コマンドパレット: **NoraOps: Copilot BYOK 準備チェック**

### 機密流出防止

- ワークスペース内の `.env` / `.pem` / `credentials` 等を検出
- `.env` があるのに `.gitignore` に無い場合は error
- **開いているエディタ**に `.env` や鍵らしき文字列がある場合は error
- 直近の **セキュリティチェック**（IP 直書き等）に error がある場合はブロック

### 個人 GitHub Copilot の抑止

- 初回チェック時にモーダルで「組織 Azure のみ」を同意（`globalState` に記録）
- VS Code に Azure 関連の Copilot 設定が見つからない場合は警告
- Copilot 設定画面を開くボタンあり

## VS Code 側（BYOK）

管理者が FastAPI `.env` に Azure を設定したうえで、各 PC の **GitHub Copilot** 設定で Azure OpenAI（BYOK）を組織エンドポイントに向けてください。  
詳細: [GitHub Docs — Configure BYOK](https://docs.github.com/en/copilot/how-tos/configure-byok)

## Phase 2（実装済み）

| 機能 | パス |
|------|------|
| Chat プロキシ | `POST /api/v1/noraops/ai/chat` |
| 利用量 JSON | `GET /api/v1/noraops/ai/usage?days=14` |
| ダッシュボード | ブラウザ `/noraops/ai-usage` |
| 上限超過 | `NORAOPS_AI_DAILY_TOKEN_LIMIT` → 429 |

## Phase 3（実装済み）

| 機能 | 内容 |
|------|------|
| BYOK ガード | `github.copilot.*` 変更を監視。Azure BYOK が外れたら自動で組織設定に戻し警告 |
| 設定タブ / Creator | Copilot 状態・利用量（円換算サマリ）・セットアップ |
| コンシェルジュ | Creator「アプリのコンシェルジュ」→ Gitea 類似検索 → Copilot プロンプトコピー |

## 未実装

- 拡張ステータスバーに本日の AI 使用量のみ常時表示

## 関連

- [生成AI連携構想.md](./生成AI連携構想.md)
- [ポリシーチェックルール.md](./ポリシーチェックルール.md)
