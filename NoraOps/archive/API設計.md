# NoraOps API 設計（方針草案）

**役割**: ② FastAPI が **① Gitea を読み解析**し、**VS Code 拡張（Creator + Runner）** と **将来 Tauri クライアント**に JSON とファイルを提供する。人向けの **ダウンロードページ（HTML）** は ② が配り、**.vsix** の案内先を明確にする（[ポータルとクライアント.md](./ポータルとクライアント.md)）。

**現状**: `softrail-server` と共存しつつ **NoraOps としての名前空間** を定義。互換は `/api/v1` で明示。

## 1. 原則

| 項目 | 方針 |
|------|------|
| 形式 | JSON / UTF-8 |
| エラー | `detail`（人間向け）+ 任意で `code`（機械向け） |
| 認証 | **Phase1a**: チェックルール GET は **無認証可**（社内ネット前提）でも可。本番は API Key。**Gitea／NoraOps ユーザ認証は Phase1a では作らない**（[スリムPhase1.md](./スリムPhase1.md)） |
| 版付け | 新規は `/api/v1/...` を推奨。レガシー `/api/...` は deprecate 期間を設ける |
| Idempotency | 生成系 POST は将来 `Idempotency-Key` を検討 |

## 2. 名前空間（論理グループ）

| プレフィックス | 用途 | 主な利用者 |
|----------------|------|------------|
| `/` … `/download` 等（HTML） | **配布ページ**：NoraOps 紹介、**.vsix 取得**への導線 | 人・管理者 |
| `/api/v1/health` | 生存確認 | LB・監視 |
| `/api/v1/tools/...` | uv / Git 等の manifest・ファイル配布 | **拡張・将来 Tauri**（[配布検討.md](./配布検討.md) B） |
| `/api/v1/catalog/...` | **内部用**一覧（運用・解析向け／Gitea に近い範囲） | 管理者・ダッシュボード |
| `/api/v1/portal/catalog/published` | **承認済み**カタログ（Phase1b: topic `nora-published`）。Runner 検索の正 | **拡張 Runner / Tauri** |
| `/api/v1/portal/catalog/published/{owner}/{name}` | 実行メタ（clone パス・pyproject 候補） | Runner |
| `/api/v1/noraops/client/latest` | **.vsix** 版・URL・リリースノート（`data/noraops/client-latest.json`） | 拡張起動時の更新通知 |
| `/api/v1/catalog/published`（旧案） | → 上記 `portal/` に統一 | — |
| `/api/v1/admin/publish-requests`（新・仮） | 承認・差戻し・監査（具体的パスは実装時） | 運用ロール |
| `/api/v1/git/...` （新） | Git ホスト抽象の読み取り（repo / release） | 拡張・ダッシュボード |
| `/api/v1/checks/rules` （**FastAPI-17**） | **チェックルール束**（security + repo_policy）。拡張は etag キャッシュ。将来の静的解析も同一 ruleId | **④ 拡張**・② バッチ |
| `/api/v1/checks/run` （Phase1b） | サーバ側で同一ルールを実行（横断解析） | ② |
| `/api/v1/repos/{o}/{r}/lease` （**FastAPI-18**） | 編集リース取得・heartbeat・解放（認証なし・Phase1b） | ④ |
| `/api/v1/ai/*` （Phase2・既定 OFF） | 組織 OpenAI ゲートウェイ・ログ。キーはサーバのみ | ④ |
| `/api/v1/analytics/...` | 横断メトリクス・**禁止ポリシー違反**・（将来）類似ペア | **② ダッシュボード**・**④ 拡張** |
| `/api/v1/telemetry/...` | イベント収集 | 拡張 |
| `/api/v1/admin/...` | 設定・ログ | 運用者 |
| `/api/v1/ai/...` （新） | チャット・要約・PR 草案・**feature flag でガード** | 拡張・バッチ |
| `/api/v1/webhooks/...` （新） | Gitea/GitHub からのイベント | Git ホスト |

**承認モデル（案）**: `owner/repo` + **`tag` または `release_id`** をキーに承認フラグ。**② が唯一のゲート**。クライアントは **`catalog/published` のみ**参照。Gitea 側変更と **② のキャッシュ／スナップショット**の整合は実装 RFC で定める。

### 拡張連携（Gitea 操作・Push 前）

| 概念（仮パス） | 用途 | 呼び主 |
|----------------|------|--------|
| `POST /api/v1/repos/provision`（等） | **FastAPI-15**：組織・可視性付きで Gitea に空リポ作成 | VSCode-12 |
| `POST /api/v1/repos/preflight`（等） | **FastAPI-14**：必須ファイル不足・チェック観点のレポート＋雛形・AI プロンプト案 | VSCode-13 |

**原則**: 拡張は **PAT で Gitea を無制限に叩かない**設計に寄せ、**プロキシ・ゲートは ②**（[責務と境界.md](./責務と境界.md) §1b）。

## 3. 既存実装とのマッピング（移行のたたき台）

| 現状（例） | NoraOps 推奨 | メモ |
|------------|----------------|------|
| `GET /api/health` | `GET /api/v1/health` | 同一レスポンスで両方も可 |
| `GET /api/catalog/apps` | `GET /api/v1/catalog/apps`（**内部一覧**）、クライアントは `GET /api/v1/catalog/published` | 移行後は運用のみが前者を使う想定も可 |
| `GET /api/analytics/*` | `GET /api/v1/analytics/*` | |
| `POST /api/telemetry/events` | `POST /api/v1/telemetry/events` | |
| `GET /api/gitea/*` | `GET /api/v1/git/*` または `.../providers/gitea/*` | **Git 抽象化**時に整理 |

## 4. Azure OpenAI 連携（設定の形）

サーバ環境変数（例・名前は実装時に確定）:

| 変数 | 意味 |
|------|------|
| `AZURE_OPENAI_ENDPOINT` | エンドポイント URL |
| `AZURE_OPENAI_API_KEY` | キー（Key Vault 推奨） |
| `AZURE_OPENAI_DEPLOYMENT_CHAT` | チャット用デプロイ名 |
| `AZURE_OPENAI_DEPLOYMENT_EMBEDDING` | Embedding 用 |
| `NORAOPS_AI_ENABLED` | マスタスイッチ |
| `NORAOPS_AI_DAILY_TOKEN_BUDGET` | 任意・コスト上限の目安 |

**API**: クライアントに Azure キーを配らず、**`/api/v1/ai/*` 経由**が必須（監査・課金のため）。

## 5. Webhook（将来）

| ソース | イベント例 | バックエンド動作 |
|--------|----------------|------------------|
| Gitea | `push`, `pull_request`, `issues` | 再インデックス・要約ジョブ |
| GitHub | 同名相当 | アダプタで正規化 |

**セキュリティ**: `X-Gitea-Signature` / `X-Hub-Signature-256` 検証必須。

## 6. 匿名チャット（構想 8章）を API に載せる場合

- **別リソース**: `/api/v1/ideas/*` など、通常のリポ解析と混ぜない。
- **保存**: セッション ID のみ・本文はハッシュ or 短期 TTL など、構想資料の「匿名」を技術的に定義する。
- **最初は OFF**: `NORAOPS_IDEA_CHAT_ENABLED=false` デフォルト推奨。

## 7. OpenAPI

- FastAPI の **自動 OpenAPI** をそのまま公開し、`/api/v1` だけ再エクスポートする運用でよい。
- 外向けドキュメントには **「試験的」エンドポイント** をタグで区別する。

---

*レビュー時は「どのエンドポイントが課金・長時間処理か」を必ず表にする。*
