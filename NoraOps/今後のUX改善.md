# 今後の UX 改善（バックログ）

## 0. Gitea リポジトリ

正: **[Giteaリポジトリ要件.md](./Giteaリポジトリ要件.md)**（雛形・zip・venv 方針・アイコン将来案）

## 1. フロー・画面構成

| 項目 | 状態 | 内容 |
|------|------|------|
| Creator / Runner 分離 | [x] v0.8 | 別タブ・別 UI。下部ステータスバーに **Creator** / **Runner** |
| 起動時に両タブ | [x] v0.8 | `noraops.runner.autoOpenPanels`（既定 ON）→ v0.10 は **設定・Creator・Runner** 3 タブ |
| サーバー接続設定 UI | [x] v0.10 | **NoraOps 設定** タブ・接続テスト・IIS サブパス対応 → [サーバー接続設定.md](./サーバー接続設定.md) |
| コンパクト UI | [x] v0.8 | 11px 基調・折りたたみ（Creator の Python / 動作確認） |
| Creator 7 段フロー | [x] v0.8.1 | 雛形→開発→依存→環境→導入→F5→Gitea（青=現在） |
| Gitea リポ要件 MD | [x] v0.8.1 | [Giteaリポジトリ要件.md](./Giteaリポジトリ要件.md) |
| Runner お気に入り最上部 | [x] v0.8 | ★ タイル → 最近 → 検索はモーダル（サブ） |
| Runner サムネ表示 | [x] v0.9 | お気に入り・最近・検索に `thumbnail.png` |
| Runner 最新版差し替え | [x] v0.9 | `artifactSha` 不一致で ● + ワンクリック更新 |
| 検索モーダル | [x] v0.8 | 名前・リポ・説明を一覧（50件超向け） |
| 整理＝ストレージ | [x] v0.8 | Runner 環境フォルダ削除。トップ付近に「整理」 |
| 保存後の次ヒント | [ ] | トーストから Runner へ |
| 掲載済みバッジ | [ ] | Creator ホームに catalog 状態 |

→ Runner 詳細: [Runner利用ガイド.md](./Runner利用ガイド.md)

**Runner の意味（利用者向け）**

| 段階 | 実際の操作 |
|------|------------|
| 起動 | ★ お気に入り / 最近使った からワンクリック |
| 探す | 「＋ 他のアプリを検索」モーダル（公開リポ） |
| 整理 | ストレージ — `runner-apps` 等の削除 |

## 2. ディスク消費（P0）

| 項目 | 状態 |
|------|------|
| ストレージ画面 | [x] |
| お気に入り（ストレージ行） | [x] |
| 90日レコメンド削除 | [x] |
| アプリお気に入り（Runner） | [x] v0.8 `runner-app-prefs.json` |
| venv lastUsed 自動更新 | [ ] |

## 3. 保存・起動

- [x] entryPicker / session のみ / 送信先強調

## 4. PyPI ミラー・許可リスト

| 項目 | 状態 | 内容 |
|------|------|------|
| XLSX 許可リスト | [x] | `/admin/packages`、B=パッケージ名 C=バージョン |
| 拡張 warn（ブロックなし） | [x] | `packageAllowlist.js` + `uv sync` 後 deps_audit |
| 社内 index（uv） | [x] | `NORAOPS_PYPI_INDEX_URL` + `UV_DEFAULT_INDEX` |
| ミラー sync CLI | [x] | `scripts/pypi-mirror-sync.py` — [連携設定書](../nora-backend/docs/pypiserverサービス連携設定書兼仕様書.md) |
| pypiserver 本番 | [ ] | NSSM + IIS ARR 手順はドキュメントのみ |

## 5. テスト・CI

→ [テストと動作確認.md](./テストと動作確認.md)

## 設定

| キー | 既定 | 説明 |
|------|------|------|
| `noraops.runner.autoOpenPanels` | `true` | 起動時 Creator + Runner タブ |
| `noraops.runner.autoOpen` | `true` | 上記 OFF 時の従来挙動 |
