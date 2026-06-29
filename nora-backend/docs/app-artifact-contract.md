# 公開アプリ契約（NoraOps v0.5+）

> **注**: リポジトリ内パス（pyproject / entry / thumbnail）は [NoraOps/ワークスペース設計改定.md](../../NoraOps/ワークスペース設計改定.md) に追随予定。zip 除外規則・API は本書が正本。

Runner・Creator 共通で、**Gitea 上の git 正本**と **サーバー配布用ソース zip** を分離する。

## 正本と配布

| 層 | 内容 |
|----|------|
| Gitea | git 履歴 + **公開時は semver tag**（例 `v1.0.0`） |
| `data/noraops/artifacts/{owner}/{name}/` | tag 単位 zip + `versions.json`（`.git` / `.venv` / `.env` なし） |

公開後、サーバーが **指定 tag** を `git clone` して zip を生成しキャッシュする。カタログの `artifactSha` は `versions.json` の `latestSha` を参照する。

## リポジトリに含めるもの

| 項目 | ルール |
|------|--------|
| Python | `pyproject.toml` + 推奨 `uv.lock`（ルート・直下 1 階層・`nora/packages/` を自動探索） |
| 説明 | `README.md` または `README.html` — **Runner 公開時は必須**（拡張が公開前に検証） |
| エントリ | 保存時にユーザーが指定 → `nora/manifest.json` の `entry`（script）または `entryKind: module` + `entryModule` |
| 公開マーカー | Gitea topic: `nora-published` + DB `PublishedVersion` |

## 保存と公開の違い

| 操作 | API | Runner |
|------|-----|--------|
| 保存のみ | `POST /api/v1/repos/save`（`publish=false`） | 掲載されない（バックアップ） |
| 保存 + 公開 | 同上 + `publish=true` + `version=1.0.0` | topic + tag artifact + 版一覧 |

公開だけ失敗した場合、git push は成功したまま `publish: { ok: false, error }` を返す（部分失敗）。

## アップロード禁止（zip 作成・解凍の両方）

- `.env`, `.env.*`, `*.pem`, `*.key`
- `.git`, `.venv`, `venv`, `__pycache__`
- 巨大バイナリ（zip 上限: `NORAOPS_SAVE_MAX_ZIP_MB`、既定 50MB）

## API

| 操作 | API | クライアント git |
|------|-----|------------------|
| 保存 | `POST /api/v1/repos/save`（multipart `workspace`, 任意 `publish`, `version`） | 不要 |
| 公開状態 | `GET /api/v1/repos/publish-state?owner=&name=` | 不要 |
| 単独公開 | `POST /api/v1/repos/publish` | 不要 |
| Runner 取得 | `GET /api/v1/portal/apps/{owner}/{name}/artifact?tag=` or `?version=` | 不要 |
| セッション | `POST /api/v1/noraops/push/sessions`（`scope`: `write` / `read`） | — |

## クライアント実行

1. artifact zip を `%LOCALAPPDATA%\NoraOps\runner-apps\` に展開
2. `uv sync` → `uv run`（Windows x64 固定、サーバーに Python 不要）

**Runner お気に入り**は常に最新公開版。特定版は検索モーダルで選択。

whl / venv のサーバー事前ビルドは行わない。
