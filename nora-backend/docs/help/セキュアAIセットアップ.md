# セキュア AI セットアップ（Copilot BYOK / Continue）

組織の Azure OpenAI を VS Code から安全に使う手順です。  
**拡張の「セキュア AI」ボタンで多くは自動設定**できます。うまくいかないときだけ、このページのコピペ手順を使ってください。

---

## どちらを選ぶ？

| 方式 | 自動設定 | API キー | 向いている人 |
|------|----------|----------|--------------|
| **Continue（推奨）** | ◎ ほぼ完全自動 | **不要**（ダミーキー + サーバー中継） | 個人 Copilot 契約なし・手順を簡単にしたい |
| **GitHub Copilot BYOK** | △ 一部自動 | Copilot 設定で**手動**（サーバーから配らない） | VS Code 組込 Copilot チャットを使いたい |

管理者: AI の ON/OFF は **CMS → AI 中継**。Azure キーは **`.env` のみ**。

---

## A. Continue（推奨）— 自動設定

1. NoraOps Creator で **「セキュアな AI と連携して開発」** を押す  
   （または VS Code コマンド `NoraOps: セキュア AI を開始`）
2. 拡張が **Continue 拡張のインストール** と **`.continue/config.json` の作成** を行います
3. Continue チャットが開いたら、NoraOps のプロンプトを貼り付け

### 手動で書く場合

**ファイル:** ワークスペース直下 `.continue/config.json`

中身の最新版（proxy URL 等）は API から取得できます:

```
GET /api/v1/noraops/ai/setup-guide
→ continue.configText をそのままファイルに保存
```

例（構造のみ — **URL は環境ごとに異なります**）:

```json
{
  "models": [
    {
      "title": "NoraOps Azure (org)",
      "provider": "openai",
      "model": "your-deployment",
      "apiBase": "https://YOUR-SERVER/NoraOps/api/v1/noraops/ai/proxy",
      "apiKey": "noraops-proxy"
    }
  ],
  "defaultModel": "NoraOps Azure (org)"
}
```

- `apiKey` は **`noraops-proxy` のダミー**のままで OK（本番キーはサーバー `.env` のみ）
- チャットはすべて **NoraOps サーバー中継**経由。トークンは利用量ダッシュボードに記録されます

---

## B. GitHub Copilot BYOK — 一部自動

1. **VS Code 1.122.0 以上**
2. 拡張 **GitHub Copilot** / **GitHub Copilot Chat** をインストール
3. NoraOps の **「セキュア AI」** または **「Copilot BYOK 設定を反映」** で `settings.json` に endpoint / deployment を自動投入
4. **Azure API キー**は GitHub Copilot の設定 UI で組織手順に従い**手動入力**（セキュリティのため NoraOps からは送りません）
5. Copilot チャットを開き、プロンプトを貼り付け

### 手動で settings.json に書く場合

**ファイル:** ユーザー設定またはワークスペース `.vscode/settings.json`

```
GET /api/v1/noraops/ai/setup-guide
→ copilot.settingsText を参考に追記
```

主なキー:

```json
{
  "github.copilot.enable": true,
  "github.copilot.chat.enable": true,
  "github.copilot.chat.azureEndpoint": "https://YOUR-RESOURCE.openai.azure.com",
  "github.copilot.chat.azureDeployment": "your-deployment"
}
```

---

## うまくいかないとき

| 症状 | 確認 |
|------|------|
| 「AI 無効」 | CMS → **AI 中継** マスター ON |
| 「Azure 未設定」 | サーバー `.env` の `AZURE_OPENAI_*` |
| Copilot BYOK が使えない | VS Code バージョン · Copilot 拡張 · API キー手入力 |
| Continue が応答しない | `noraops.server.baseUrl` · proxy URL · サーバー接続 |

**ライブ設定スニペット:** [API `/api/v1/noraops/ai/setup-guide`](/api/v1/noraops/ai/setup-guide)

**利用量:** [AI 利用量ダッシュボード](/noraops/ai-usage)

---

## 拡張側の自動処理（参考）

| 操作 | Copilot | Continue |
|------|---------|----------|
| 拡張インストール | ○ | ○ |
| 設定ファイル投入 | settings.json（endpoint 等） | `.continue/config.json` |
| API キー | × 手動 | ○ 不要（中継） |
| チャットを開く | ○ | ○ |
| リポ別トークン記録 | △ | ○（ヘッダー付与） |
