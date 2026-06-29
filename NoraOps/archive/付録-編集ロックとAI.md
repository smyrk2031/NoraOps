# 付録 — 編集ロック・AI 連携・Copilot 分離

[スリムPhase1.md](./スリムPhase1.md) の補足。**Phase1a 必須ではない**が、方針を先に固定する。

---

## 1. push 競合を「考えない」前提

| 前提 | 内容 |
|------|------|
| 利用者 | 非エンジニア中心、**ほぼ一人**が自分のリポだけ触る |
| Gitea の役割 | **自動でクラウドに溜まるソース**（個人用バックアップ＋版の倉庫） |
| Git のマージ UI | **不要** |

このため **競合解消フローは作らない**。まれに二人が触るときだけ **編集ロック（リース）** で push 競合を **起こさない**。

---

## 2. 編集ロック（FastAPI-18）— いったんの案

**Gitea ネイティブのロックではなく**、NoraOps が **「いま誰が保存してよいか」** を FastAPI で持つ。

### 2.1 イメージ

```text
A さん: VS Code 起動 → リポを開く → リース取得
B さん: 同じリポを開く → 「A さんが編集中」→ 保存ボタン無効（閲覧は可）

A さん: VS Code 終了 or 30分無操作 → リース解放
B さん: 保存可能に
```

### 2.2 エンドポイント（認証なし・Phase1a 同様）

| メソッド | パス | 用途 |
|----------|------|------|
| `POST` | `/api/v1/repos/{owner}/{repo}/lease` | 取得（既に他者なら 409） |
| `PUT` | 同上 | ハートビート（TTL 延長） |
| `DELETE` | 同上 | 明示解放 |
| `GET` | 同上 | 状態参照（任意） |

**リクエスト例**

```json
{
  "holder_id": "device-uuid-from-extension",
  "holder_label": "山田のPC"
}
```

**レスポンス（409）**

```json
{
  "detail": "このアプリはいま別の場所で編集中です。",
  "code": "lease_held",
  "holder_label": "佐藤のPC",
  "expires_at": "2026-05-18T15:00:00Z"
}
```

| 項目 | 値 |
|------|-----|
| TTL | **5 分**（ハートビートなしで失効） |
| ハートビート | 拡張が **2 分ごと**（VS Code 起動＆ワークスペース一致時） |
| 解放 | `onDeactivate`・ウィンドウ閉じ・「編集を終了」ボタン |

### 2.3 拡張の挙動（VSCode-UI-7）

| タイミング | 動作 |
|------------|------|
| ワークスペース open | `POST lease` 試行 |
| 成功 | 保存ボタン **有効** |
| 409 | 保存 **無効**、ホームに「〇〇が編集中」 |
| 保存前 | リース有効か再確認（失効していたら再取得） |
| push | リース保持者のみ（他者はそもそも保存不可） |
| オフライン | リース API 失敗 → **ローカルのみ**（既存方針）。復帰後に lease 再取得 |

**競合ではなく「先に取った人が書ける」**ので、Git の merge は不要。

### 2.4 Phase

| フェーズ | 内容 |
|----------|------|
| Phase1a | **省略可**（一人利用ならほぼ不要） |
| Phase1a' または Phase1b 薄く | 上記 API ＋ 保存ボタン連動 |

---

## 3. `GET /checks/rules` — 認証

**Phase1a: 認証なし**（社内 VPN 前提）。将来 API Key 1 本を足せるようヘッダは予約のみ。

---

## 4. AI 連携（組織契約 OpenAI・MCP）— Phase2 設計メモ

### 4.1 やりたいこと

| 項目 | 内容 |
|------|------|
| 組織の OpenAI 等 | キーは **FastAPI のみ**保持。拡張は **トークンを見ない** |
| ログ | プロンプト／トークン量を **サーバ側**（PII 最小化） |
| チャット隙間 | 拡張サイドバー or ホームに **「聞く」** → `POST /api/v1/ai/chat` |
| MCP | リポジトリ解析結果をツール化（既存 `app/routers/mcp.py` を NoraOps 名で拡張） |
| BYOK | 個人キーを使う導入社向け **オプション**（下記） |

### 4.2 FastAPI は分ける？ 一緒？

| 案 | 内容 | おすすめ |
|----|------|----------|
| **A. 同一プロセス・ルータ分離** | `routers/checks.py`, `routers/ai.py`, `routers/mcp.py` を同じ `softrail-server` | **Phase1a〜2 は A** |
| **B. 別サービス** | `noraops-core` と `noraops-ai` | 負荷・課金分離が必要になってから |

**理由（A でよい）**

- リポジトリ解析 → MCP ツール → チャット context は **同じ DB・同じ Gitea 設定**を見る。
- デプロイは **Platform-1 の 1 ホスト**のままシンプル。
- コード上は **パッケージ分割**しておけば、後から B に切り出せる。

```text
同一 FastAPI プロセス
  /api/v1/checks/*     … ルール・将来静的解析
  /api/v1/repos/*      … 作成・lease
  /api/v1/ai/*         … chat・ログ（既定 OFF）
  /api/v1/mcp/*        … ツール一覧・invoke
```

### 4.3 エンドポイント案（Phase2・既定 OFF）

| メソッド | パス | 用途 |
|----------|------|------|
| `POST` | `/api/v1/ai/chat` | チャット 1 ターン（サーバが OpenAI 呼び出し） |
| `GET` | `/api/v1/ai/status` | 有効か・モデル名・上限（拡張が UI 出し分け） |
| `POST` | `/api/v1/mcp/invoke` | 既存 bridge の NoraOps 版 |

環境変数: `NORAOPS_AI_ENABLED=false`（既定）。

---

## 5. VS Code：BYOK と Copilot を混ぜない — 可能か？

**結論: 完全禁止は不可能だが、実務上かなり寄せられる。**

VS Code 上の **GitHub Copilot は別拡張**のため、NoraOps が OS レベルで止めることはできない。代わりに **層を分ける**。

### 5.1 三つの AI モード（`noraops.ai.mode`）

| 値 | 意味 |
|----|------|
| `off` | AI なし。Copilot も manifest で入れない |
| `gateway`（組織推奨） | **FastAPI 経由のみ**。組織キー |
| `byok` | 個人キーを **SecretStorage** に保存し FastAPI or 直接（要ポリシー） |

### 5.2 拡張ができること

| 施策 | 内容 |
|------|------|
| **初回 bootstrap** | `gateway` / `off` 時は **Copilot を推奨拡張に含めない** |
| **ワークスペース設定の contribution** | `noraops.enforceOrgAiOnly: true` のとき `.vscode/settings.json` に `"github.copilot.enable": false` を書き込む（NoraOps 管理ワークスペースのみ） |
| **検知と警告** | `vscode.extensions.getExtension('GitHub.copilot')` が有効ならホームに **「組織ポリシー: Copilot を切ってください」** |
| **BYOK 保存** | `settings.json` 平文 **禁止**。`SecretStorage` + 設定は「BYOK 有効」フラグのみ |
| **チャット UI** | NoraOps ホーム／サイドに **組織 AI を開く**ボタンのみ（Copilot Chat を開かせない導線） |

### 5.3 できないこと（期待値調整）

- ユーザーが手動で Copilot 拡張を入れて有効化するのは **止められない** → 検知＋警告＋社内規程。
- Copilot に **個人 GitHub がログイン済み**かどうかは VS Code API で **直接は読めない**ことが多い → 「Copilot 拡張が有効」を代理指標にする。

### 5.4 機能 ID（Phase2）

| ID | 内容 |
|----|------|
| **VSCode-AI-1** | `ai.mode`・gateway チャット UI・SecretStorage BYOK |
| **VSCode-AI-2** | Copilot 検知・ワークスペース settings 強制（任意） |
| **FastAPI-12** | AI ゲートウェイ（既存 ID をこの形に） |

---

## 6. まとめ表

| トピック | 決定 |
|----------|------|
| push 競合 | 解消 UI なし。**編集リース**で予防（Phase1a 省略可） |
| checks/rules 認証 | **なし** |
| AI / MCP | **同一 FastAPI・ルータ分離**。Phase2・既定 OFF |
| Copilot 混同防止 | **可能な範囲で** manifest・settings・検知・組織 AI 導線 |

---

*実装順: Phase1a コア → FastAPI-17 → （必要なら）FastAPI-18 → Phase2 AI/MCP*
