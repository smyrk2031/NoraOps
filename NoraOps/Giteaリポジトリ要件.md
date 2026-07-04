# Gitea リポジトリ要件（NoraOps）

Runner の一覧表示・起動、Creator の保存・公開の**正本**は Gitea 上のリポジトリです。  
将来のアイコン・サムネイル連携も含め、**現状の必須構成**と**拡張予定**をまとめます。

関連:

- サーバー契約: [nora-backend/docs/app-artifact-contract.md](../nora-backend/docs/app-artifact-contract.md)
- エントリ解決: [vscode-extension/docs/MODULES.md](../vscode-extension/docs/MODULES.md)
- **構成改定（追随予定）**: [ワークスペース設計改定.md](./ワークスペース設計改定.md)／[互換方針.md](./互換方針.md)

> **注（2026-06）**: 本文 §2 の `nora/packages` 中心構成は **現行実装の正本**。改定後はルート `pyproject.toml`・ルート `assets/` を推奨（互換期間中は旧パスも有効）。

---

## 1. 目的

| 利用者 | Gitea リポから読むもの |
|--------|----------------------|
| **Runner** | 説明・（将来）アイコン → artifact zip → `uv run` で起動 |
| **Creator** | 同じリポに zip 保存 → topic `nora-published` で Runner に掲載 |

保存は **クライアント git 不要**（拡張 → FastAPI → サーバー git push）。

---

## 2. 現状の必須構成（雛形）

「新しいアプリを作る」または初回保存前に、拡張が **不足分のみ** 追加するテンプレ（`ensureWorkspaceScaffold`）。

### 2.1 ディレクトリ一覧

```text
my-app/
├── README.md                 # 説明（Runner 検索モーダルに表示。将来サムネの補助）
├── .gitignore                # .env / .venv 等（後述）
├── nora/
│   ├── manifest.json         # NoraOps アプリ定義（必須）
│   └── packages/
│       ├── pyproject.toml    # uv の正本（必須）
│       ├── requirements.txt  # pyproject から同期可（補助）
│       └── main.py           # 既定エントリ
├── .vscode/
│   └── launch.json           # F5 デバッグ（雛形で生成）
└── .nora/
    └── session.json          # 保存先 Gitea 名など（拡張が書く。zip に含めない）
```

### 2.2 `nora/manifest.json`（必須）

スキーマ: `nora.manifest/1`（テンプレ: `vscode-extension/resources/templates/nora/manifest.json`）

| フィールド | 必須 | 説明 |
|-----------|------|------|
| `schema` | はい | `"nora.manifest/1"` |
| `appId` | はい | 例 `nora.app.my-app` |
| `displayName` | はい | 表示名 |
| `language` | はい | 現状 `"python"` |
| `entry` | はい | 例 `main.py`（`nora/packages/` からの相対） |
| `entryKind` | はい | `"script"` または `"module"` |
| `entryModule` | module 時 | `python -m` 用 |
| `packagesProject` | 推奨 | 既定 `"nora/packages"` |
| `version` | 推奨 | セマンティック版 |
| `stage` | 任意 | `trial` / `stable` 等 |

保存時にユーザーが **起動ファイル** を選ぶと `entry` が更新されます。

### 2.3 `nora/packages/pyproject.toml`（必須）

- **uv** のプロジェクト正本
- `name` は ASCII（日本語フォルダ名は `app-{hash}` に自動補正あり）
- `dependencies = [...]` に実行に必要なパッケージを列挙

### 2.4 `README.md` / `README.html`（Runner 公開時は必須）

| 操作 | 必須か |
|------|--------|
| **Gitea 保存のみ** | 推奨（ポリシー error だが保存はブロックしない） |
| **Runner 公開**（チェックボックス / 公開リリース） | **必須**（`validateReleaseReadiness` でブロック） |

- Gitea の **リポジトリ説明**（API `description`）の元
- Runner の検索モーダルで名前の下に表示
- 利用者向けの使い方・スクリーンショットリンクを書く場所

### 2.5 `.gitignore`（必須）

テンプレで生成。少なくとも以下を除外:

| パターン | 理由 |
|----------|------|
| `.env`, `.env.*` | 秘密情報（保存 zip でも拒否） |
| `.venv/`, `venv/` | ローカル環境（リポに含めない） |
| `__pycache__/` | 生成物 |
| `.vscode/*`（`launch.json` は例外可） | 個人設定 |

### 2.6 公開（Runner 掲載）

**保存だけ** = クラウドバックアップ（Gitea に push）。**公開** = Runner で検索・起動できる状態（topic + semver tag + artifact）。

| 項目 | 値 |
|------|-----|
| Gitea **topic** | `nora-published`（`NORAOPS_PUBLISHED_TOPIC`） |
| **git tag** | `v1.0.0` 形式（公開のたびに bump） |
| DB | `PublishedVersion`（版・公開者メール・日時） |
| Creator UI | クラウドタブ「Runner に公開する」+ 版番号、または「公開リリース」モーダル |

**公開前チェック**（拡張 `validateReleaseReadiness`）: README / pyproject.toml / nora/manifest.json / entry / セキュリティ・ポリシー error なし。

**保存のみ**のときは上記必須ファイルがなくても Gitea 保存は可能（ToDo 表示のみ）。

topic が無いリポは Runner の通常一覧に出ません（開発時は `NORAOPS_CATALOG_DEV_SHOW_ALL=1` で全件可）。

**Runner お気に入り**: ピン留めタイルは常に **最新の公開版** で起動。特定版は検索モーダルから選択。

旧運用（topic のみ・tag なし）のリポは、Creator または Gitea から初回版（例 `1.0.0`）を公開して移行してください。

---

## 3. zip 保存時のルール（サーバー）

`POST /api/v1/repos/save` で受け取るワークスペース zip から、おおよそ次を **除外** して Gitea に push します。

| 除外 | 理由 |
|------|------|
| `.git` | サーバー側で git 管理 |
| `.venv`, `venv` | 再現は uv で行う |
| `.env` 等 | セキュリティ |
| 巨大バイナリ | 上限 `NORAOPS_SAVE_MAX_ZIP_MB`（既定 50MB） |

**ブランチ（v0.25+）**

| 操作 | ブランチ（既定） | 履歴 | push |
|------|------------------|------|------|
| 通常保存 | `noraops-draft` | 残さない（最新のみ） | `--force` |
| 公開リリース | `main` | **残す** | 通常 push |

環境変数 `NORAOPS_SAVE_DRAFT_BRANCH` / `NORAOPS_SAVE_PUBLISH_BRANCH` で変更可能。詳細は [flows/02](../docs/flows/02-ユーザ利用フロー.md) §3。

`.nora/session.json` はワークスペース内だが、正本は Gitea 側の履歴。保存 zip のポリシーは [app-artifact-contract.md](../nora-backend/docs/app-artifact-contract.md) を参照。

---

## 4. Python 環境（Creator）

### 現状（v0.8.2+）

| 利用モード | venv の場所 |
|------------|-------------|
| **Creator（開発）** | **`nora/packages/.venv`**（リポ内。`.gitignore` でコミット除外） |
| **Runner** | artifact 展開先で都度 `uv sync`（利用者は venv 場所を意識しない） |
| 旧 AppData venv | Creator では使わない（Runner 専用キャッシュは `runner-apps/`） |

zip 保存時も `.venv` は除外されるため Gitea には載りません。

### サムネイル（v0.8.2+）

| 項目 | 値 |
|------|-----|
| 保存先 | `nora/assets/thumbnail.png` |
| manifest | `"thumbnail": "assets/thumbnail.png"`（保存時に自動） |
| UI | Creator 保存カード — 貼り付け / ファイル選択 → 適用 |
| Runner 表示 | 将来 Gitea avatar / manifest 参照（[§7](#7-将来-アイコンサムネイル設計メモ)） |

### 起動ファイル

- `nora/manifest.json` の `entry` / `entryKind` / `entryModule`
- Creator **「起動 .py を指定」** で `myapp.py` 等を明示可能（自動判定は main.py 優先だが上書き可）

---

## 5. Creator 開発フロー（推奨順）

手動開発・GitHub Copilot いずれも **順序は同じ**。違うのは「2 開発」のやり方だけ。

| # | 段階 | 内容 |
|---|------|------|
| 1 | **雛形** | 空フォルダ → NoraOps 必須構成（テンプレ自動） |
| 2 | **開発** | 手動編集 **または** Copilot で `main.py` / ロジックを生成 |
| 3 | **依存定義** | `nora/packages/pyproject.toml` の `dependencies` |
| 4 | **uv 環境** | 「Python 環境を用意」→ 外部 venv 作成（空でも可） |
| 5 | **パッケージ導入** | `uv sync`（拡張が実行） |
| 6 | **実行確認** | F5（`.vscode/launch.json`）でデバッグ実行 |
| 7 | **Gitea 保存** | zip → サーバー push → topic 付与 → Runner から利用可 |

Copilot 向け: 雛形後に `pyproject.toml` と `main.py` を編集させ、**保存前に F5 で一度動かす**と安全。

---

## 6. Runner 配布物（artifact）

保存・publish 後、サーバーが `git clone --depth 1` からソース zip を生成。

| 含める | 含めない |
|--------|----------|
| `nora/`, `nora/packages/`, `README.md`, `pyproject.toml` | `.git`, `.venv`, `.env` |

Runner は zip を `%LOCALAPPDATA%\NoraOps\runner-apps\` に展開し `uv sync` → `uv run`。

---

## 7. 将来: アイコン・サムネイル（設計メモ）

現状は Gitea API の **description** のみ Runner に表示。以下を段階導入する想定。

| 段階 | ソース | Runner 表示 |
|------|--------|-------------|
| **A（容易）** | Gitea リポ `avatar_url` / メタ | 一覧タイルの丸アイコン |
| **B** | `nora/manifest.json` に `icon`（相対パス） | リポ内 `nora/assets/icon.png` |
| **C** | `README.md` 先頭の画像 URL | サムネとして fetch（キャッシュ要） |
| **D** | サーバー側スクリーンショット生成 | 管理コスト大のため後回し |

### manifest 拡張案（未実装）

```json
{
  "schema": "nora.manifest/1",
  "displayName": "サンプル",
  "icon": "assets/icon.png",
  "cardColor": "#1e293b"
}
```

| ファイル | 推奨 |
|----------|------|
| `nora/assets/icon.png` | 128×128 以上、正方形 |
| `nora/assets/card.png` | 任意（Runner ワイドカード） |

**実装済み（v0.9.1）**: Creator の保存カードでサムネ枠をクリック → **Ctrl+V で即 `nora/assets/thumbnail.png` に保存**（Webview で貼れない場合は **クリップボードから保存**）。Gitea 保存 zip に含まれ → Runner / 検索で表示。

| API | 内容 |
|-----|------|
| 一覧 `GET /api/v1/portal/catalog/published` | `thumbnailUrl`, `hasThumbnail`, `artifactSha` |
| サムネ `GET /api/v1/portal/apps/{owner}/{name}/thumbnail` | PNG（認証不要・公開アプリのみ） |
| 詳細 `GET /api/v1/portal/catalog/published/{owner}/{name}` | 上記 + `updated_at` |

Runner は `artifactSha` の差分で「最新版に差し替え」を案内します。

---

## 8. チェックリスト（リリース前）

- [ ] `nora/manifest.json` がある
- [ ] `nora/packages/pyproject.toml` に依存が書いてある
- [ ] `README.md` に利用者向け説明がある
- [ ] `.gitignore` に `.env` / `.venv` がある
- [ ] F5 でローカル起動できる
- [ ] Creator から Gitea 保存が成功する
- [ ] Gitea に topic `nora-published` が付いている
- [ ] Runner で起動できる

---

## 9. 変更履歴

| 日付 | 内容 |
|------|------|
| 2026-05-19 | 初版（現状テンプレ・zip 規則・venv 方針・Creator 7 段・icon 将来案） |
