# NoraOps ドキュメント（正本入口）

**NoraOps** リポジトリ内のドキュメント入口です。

### 3 層の読み分け

| 層 | パス | 役割 |
|----|------|------|
| **メタ（ここ）** | `docs/` | 入口・棚卸・メンテ・移行 |
| **仕様** | [`NoraOps/`](../NoraOps/) | 製品の思想・アーキ・手順（**量が多いのは正常**） |
| **凍結** | [`NoraOps/archive/`](../NoraOps/archive/) | 旧構想 — 実装判断禁止 |

`NoraOps/` 全体を archive 扱いしないでください。詳細: [NoraOps/README.md](../NoraOps/README.md)

---

実装の「ある／ない」は次の **6 点セット** で判定してください（矛盾したらコードが勝ちます）。

| # | 正本 | 用途 |
|---|------|------|
| 0 | [製品像とロードマップ](../NoraOps/製品像とロードマップ.md) | 製品の一言・主副機能・将来像 |
| 1 | [現状とアーキテクチャ](../NoraOps/現状とアーキテクチャ.md) | 三層構成・責務・実装判断 |
| 2 | [機能一覧とAPI](../NoraOps/機能一覧とAPI.md) | API・コマンド・設定（v0.17 基準） |
| 3 | [実装記録](../NoraOps/実装記録.md) | リリース履歴（先頭 = 最新） |
| 4 | [vscode-extension/docs/MODULES.md](../vscode-extension/docs/MODULES.md) | 拡張モジュール境界 |
| 5 | [nora-backend/.env.example](../nora-backend/.env.example) | サーバー設定の正本 |

### フロー図（開発・AI 向け地図）

迷子になったらここから → **[flows/README.md](./flows/README.md)**

| 資料 | 内容 |
|------|------|
| [01-セットアップフロー](./flows/01-セットアップフロー.md) | 本番・開発・利用者 PC の導入 |
| [02-ユーザ利用フロー](./flows/02-ユーザ利用フロー.md) | Creator / Runner / ガードレール |
| [03-拡張内部フロー](./flows/03-拡張内部フロー.md) | `activate.js` からの枝分かれ |
| [04-バックエンド動作フロー](./flows/04-バックエンド動作フロー.md) | ルータ・保存・許可リスト |
| [05-機能と編集先マップ](./flows/05-機能と編集先マップ.md) | **どのファイルを直すか** 早見表 |
| [06-データのつながりと保管](./flows/06-データのつながりと保管.md) | **正本・キャッシュ・ID のつながり**（おすすめ） |

---

## 誰が何を読むか

### 新規参加者（最初の 1 時間）

1. [README.md](../README.md) — リポ構成
2. [製品像とロードマップ](../NoraOps/製品像とロードマップ.md) — 何をする製品か
3. [現状とアーキテクチャ](../NoraOps/現状とアーキテクチャ.md)
4. [フロー図](./flows/README.md) — 全体の流れ（**おすすめ**）
5. [データのつながりと保管](./flows/06-データのつながりと保管.md) — どこに何が残るか
6. [開発時用の動作手順書](../NoraOps/開発時用の動作手順書.md)
7. [テストと動作確認](../NoraOps/テストと動作確認.md)

### 本番・運用

| 資料 | 内容 |
|------|------|
| [NoraOpsの導入](../NoraOps/NoraOpsの導入.md) | 導入全体 |
| [認証モードとGitea運用](../NoraOps/認証モードとGitea運用.md) | IIS / OTP / 個人リポ |
| [IIS-ARR配備](../NoraOps/IIS-ARR配備.md) | サブパス配備 |
| [PyPI 連携設定書](../nora-backend/docs/pypiserverサービス連携設定書兼仕様書.md) | 社内 PyPI（任意） |
| [MONOREPO.md](./MONOREPO.md) | リポ構成・vendor 同梱 |
| [MAINTENANCE.md](./MAINTENANCE.md) | リリース・同期ルール |
| [LICENSE.md](./LICENSE.md) | ライセンス・第三者ツール |

### 設計・改定

| 資料 | 内容 |
|------|------|
| [ワークスペース設計改定](../NoraOps/ワークスペース設計改定.md) | Creator 理想形 |
| [互換方針](../NoraOps/互換方針.md) | 旧 layout 互換 |
| [Giteaリポジトリ要件](../NoraOps/Giteaリポジトリ要件.md) | リポ zip・監査 |
| [ポリシーチェックルール](../NoraOps/ポリシーチェックルール.md) | sec/pol JSON |

### バックログ（実装判断に使わない）

| 資料 | 内容 |
|------|------|
| [今後のUX改善](../NoraOps/今後のUX改善.md) | UX バックログ |
| [archive/](../NoraOps/archive/) | **旧構想 ? 参照禁止** |

---

## 整理の進捗

| フェーズ | 状態 | 資料 |
|----------|------|------|
| ver1 → NoraOps 移行 | **完了** | [MIGRATION.md](../MIGRATION.md) |
| `nora-backend` → `nora-backend` | **完了** | [MIGRATION.md §7](../MIGRATION.md) |
| Phase 0 棚卸 | 完了 | [inventory.md](./inventory.md) |
| Phase 1 ドキュメント整流 | **Tier 定義完了** | [NoraOps/README.md](../NoraOps/README.md) ・ [inventory.md](./inventory.md) |
| Git 初期化 | 未実施 | [MIGRATION.md §5](../MIGRATION.md) |

### Phase 1 でやること（作り直しではない）

1. **正本 5 点**だけをリリースごとに同期する
2. 絶対パス表記をリポジトリ相対に統一（手順書・テスト MD）— **2026-06 実施済み**
3. **重複 MD**（PyPI 等）は短い入口 + 詳細正本の 2 層のまま維持
4. **`archive/`** は触らない（参照禁止のまま）
