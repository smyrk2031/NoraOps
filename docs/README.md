# NoraOps ドキュメント（正本入口）

**NoraOps** モノレポのドキュメント入口です。引き継ぎ・新規参加者は **このページ → [flows/07-モードと機能マップ](./flows/07-モードと機能マップ.md)** の順で読むと全体像が掴めます。

**現行リリース**: 拡張 **v0.26.0** · バックエンド **v0.26.0** · 最終メンテ: 2026-07

---

## 全体像（一枚絵）

```mermaid
flowchart TB
  subgraph people [人]
    Admin[運用・管理者]
    Dev[開発者]
    User[利用者]
  end
  subgraph ext [vscode-extension v0.23]
    direction TB
    Nav[5 タブ UI<br/>Setting / Connect / Prompt / Creator / Runner]
    Guard[ガードレール]
    Cre[Creator 保存・公開]
    Run[Runner 起動・ZIP・SC]
    UV[uv 同梱可]
  end
  subgraph be [nora-backend]
    API[FastAPI]
    ADM[/admin]
    DB[(data/ SQLite)]
  end
  subgraph ext2 [外部]
    Gitea[(Gitea)]
    PyPI[(PyPI)]
  end
  Admin --> ADM
  Admin --> API
  Dev --> Nav
  User --> Run
  Dev --> Cre
  Cre --> Guard
  Cre --> API
  Run --> API
  Run --> UV
  API --> Gitea
  API --> DB
  UV --> PyPI
  Guard --> API
```

| コンポーネント | パス | 一言 |
|----------------|------|------|
| 拡張 | `vscode-extension/` | VS Code 上の UI・チェック・保存・Runner |
| サーバー | `nora-backend/` | API・管理画面・artifact・認証 |
| 仕様 | `NoraOps/` | 製品思想・手順・API 一覧 |
| **入口（ここ）** | `docs/` | 索引・フロー・メンテ |
| 凍結 | `NoraOps/archive/` | **実装判断に使わない** |

---

## 3 層の読み分け

| 層 | パス | 役割 |
|----|------|------|
| **メタ（ここ）** | `docs/` | 入口・棚卸・メンテ・フロー図 |
| **仕様** | [`NoraOps/`](../NoraOps/) | 製品の思想・アーキ・手順（量が多いのは正常） |
| **凍結** | [`NoraOps/archive/`](../NoraOps/archive/) | 旧構想 — 実装判断禁止 |

---

## 引き継ぎクイックスタート（推奨順）

| # | 資料 | 所要 | 得られること |
|---|------|------|--------------|
| 1 | **[flows/07-モードと機能マップ](./flows/07-モードと機能マップ.md)** | 20 分 | モード・タブ・機能の全体 |
| 2 | [flows/06-データのつながりと保管](./flows/06-データのつながりと保管.md) | 15 分 | 正本・キャッシュ・ID |
| 3 | [NoraOps/現状とアーキテクチャ](../NoraOps/現状とアーキテクチャ.md) | 20 分 | 設計思想 |
| 4 | [flows/05-機能と編集先マップ](./flows/05-機能と編集先マップ.md) | 参照用 | どのファイルを直すか |
| 5 | [MAINTENANCE.md](./MAINTENANCE.md) | 10 分 | リリース・同期ルール |
| 6 | [開発時用の動作手順書](../NoraOps/開発時用の動作手順書.md) | 実践 | 手を動かす |

---

## 実装の正本 6 点セット

矛盾したら **コードが勝ち**。ドキュメントは地図。

| # | 正本 | 用途 |
|---|------|------|
| 0 | [製品像とロードマップ](../NoraOps/製品像とロードマップ.md) | 製品の一言・主副機能 |
| 1 | [現状とアーキテクチャ](../NoraOps/現状とアーキテクチャ.md) | 三層構成・責務 |
| 2 | [機能一覧とAPI](../NoraOps/機能一覧とAPI.md) | API・コマンド・設定 |
| 3 | [実装記録](../NoraOps/実装記録.md) | リリース履歴（先頭 = 最新） |
| 4 | [vscode-extension/docs/MODULES.md](../vscode-extension/docs/MODULES.md) | 拡張モジュール境界 |
| 5 | [nora-backend/.env.example](../nora-backend/.env.example) | サーバー設定 |

---

## フロー図インデックス

| # | 資料 | 内容 |
|---|------|------|
| **★** | **[07-モードと機能マップ](./flows/07-モードと機能マップ.md)** | **モード・タブ・機能のつながり** |
| ★ | [06-データのつながりと保管](./flows/06-データのつながりと保管.md) | 正本・キャッシュ・ID |
| 1 | [01-セットアップフロー](./flows/01-セットアップフロー.md) | 本番・開発・利用者 PC |
| 2 | [02-ユーザ利用フロー](./flows/02-ユーザ利用フロー.md) | Creator / Runner / ガード |
| 3 | [03-拡張内部フロー](./flows/03-拡張内部フロー.md) | activate からの枝分かれ |
| 4 | [04-バックエンド動作フロー](./flows/04-バックエンド動作フロー.md) | ルータ・保存・許可リスト |
| 5 | [05-機能と編集先マップ](./flows/05-機能と編集先マップ.md) | 編集先早見表 |

入口: [flows/README.md](./flows/README.md)

---

## 誰が何を読むか

### 新規参加者（初日）

1. 本ページの全体像 mermaid
2. [07-モードと機能マップ](./flows/07-モードと機能マップ.md)
3. [README.md](../README.md) — リポ構成
4. [テストと動作確認](../NoraOps/テストと動作確認.md)

### 本番・運用

| 資料 | 内容 |
|------|------|
| [NoraOpsの導入](../NoraOps/NoraOpsの導入.md) | 導入全体 |
| [認証モードとGitea運用](../NoraOps/認証モードとGitea運用.md) | IIS / OTP |
| [IIS-ARR配備](../NoraOps/IIS-ARR配備.md) | サブパス配備 |
| [MONOREPO.md](./MONOREPO.md) | vendor 同梱 |
| [MAINTENANCE.md](./MAINTENANCE.md) | リリース同期 |
| [LICENSE.md](./LICENSE.md) | 第三者ライセンス |

### 機能追加・バグ修正

| やりたいこと | 読む |
|--------------|------|
| 保存が失敗 | 02 §3, 05 F-save 行 |
| Runner 起動 | 07 §5, `artifactRunner.js` |
| ZIP 取込 | 07 §5, `runnerZipImport.js` |
| ショートカット | `runnerDesktopShortcut.js` |
| 許可リスト | 04 §5, 06 §4.3 |
| VSIX ビルド | MAINTENANCE §uv 同梱 |

---

## v0.25 追記（2026-07-05）

- **保存 / 公開ブランチ分離**: 下書き `noraops-draft`（force）と正式 `main`（履歴保持）

## v0.24 時点の主要機能（メモ）

| 領域 | 機能 |
|------|------|
| Creator | 保存・公開・xLLM・Copilot BYOK 補助・プロンプト連携 |
| Runner | カタログ・お気に入り・**ZIP 取込**・**デスクトップ SC**・ストレージ整理 |
| Prompt | 組み込みプロンプト帳（`builtin-catalog.json`） |
| ツール | **uv.exe VSIX 同梱可** · サーバー DL フォールバック |
| ガード | checkRunner · 許可リスト · repo-audit |

---

## 整理の進捗

| フェーズ | 状態 |
|----------|------|
| ver1 → NoraOps 移行 | 完了 — [MIGRATION.md](../MIGRATION.md) |
| Phase 0 棚卸 | 完了 — [inventory.md](./inventory.md) |
| Phase 1 ドキュメント整流 | **進行中** — 本入口 + flows/07 追加（2026-07） |
| Git 初期化 | 要確認 — [MIGRATION.md §5](../MIGRATION.md) |

---

## やってはいけない（引き継ぎ注意）

- `NoraOps/archive/` を根拠に実装する
- ルール JSON を 1 箇所だけ更新する（**3 箇所同期** — [MAINTENANCE](./MAINTENANCE.md)）
- 本番監査で PATH の Node に依存する（`NORAOPS_NODE_EXE` を設定）
- PyGarden（ver1 直下 Electron）を NoraOps リリースに含める
