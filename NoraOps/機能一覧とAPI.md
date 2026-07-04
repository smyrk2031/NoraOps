<!-- doc-meta: status=現行 | canonical=yes | updated=2026-07-05 -->

# 機能一覧と API（現行 v0.25）

> **正本**: この表と [実装記録.md](./実装記録.md)（最新版は先頭ブロック）。製品の位置づけは [製品像とロードマップ.md](./製品像とロードマップ.md)。

## FastAPI（nora-backend）

| メソッド | パス | 用途 | 認証 |
|----------|------|------|------|
| POST | `/api/v1/noraops/auth/register-email` | 初回登録メール送信 | なし |
| GET | `/api/v1/noraops/auth/activate-email` | 本登録 + NoraAccessToken 表示 | なし（ワンタイム token） |
| POST | `/api/v1/noraops/auth/reissue-access-token` | トークン再発行メール | なし |
| GET | `/api/v1/noraops/auth/registration-status` | 登録状態 | NoraAccessToken（任意） |
| GET | `/api/v1/noraops/auth/me` | ログインユーザ情報 | NoraAccessToken 等 |
| POST | `/api/v1/noraops/push/sessions` | 短命トークン（`scope`: read/write） | **email_token**: NoraAccessToken |
| GET | `/api/v1/noraops/client/runtime-config` | 拡張向け Gitea URL・`pypiIndexUrl`・allowlist etag | なし |
| GET | `/api/v1/noraops/client/latest` | .vsix 更新情報 | なし |
| GET | `/api/v1/noraops/packages/allowlist` | パッケージ許可リスト（ETag） | なし |
| POST | `/api/v1/noraops/packages/check` | パッケージ承認判定 | なし |
| POST | `/api/v1/noraops/packages/deps-audit` | 未許可依存テレメトリ（Access Token 時はメール付き） | 任意 |
| GET | `/api/admin/packages/allowlist` | 管理用許可リスト JSON | 管理 |
| POST | `/api/admin/packages/allowlist/upload` | XLSX 取込（列設定フォーム付き） | 管理 |
| PATCH | `/api/admin/packages/review-status` | 未許可パッケージの審査ステータス更新 | 管理 |
| GET | `/api/admin/packages/deps-audit-dashboard` | 審査キュー・未許可集計 JSON | 管理 |
| GET | `/admin/packages` | 審査キュー・許可リスト UI | ブラウザ |
| GET | `/api/admin/repo-audit/dashboard` | リポ横断チェック集計 | 管理 |
| POST | `/api/admin/repo-audit/run-delta` | 差分リポ監査（夜間ジョブ想定） | 管理 |
| POST | `/api/admin/repo-audit/run-one` | 指定リポ 1 件監査 | 管理 |
| GET | `/api/v1/checks/rules` | チェックルール bundle | なし |
| POST | `/api/v1/repos/provision` | Gitea 新規リポ | なし |
| POST | `/api/v1/repos/save` | **workspace zip → git push**（保存=`noraops-draft` force、公開=`main` 履歴付き） | write セッション |
| POST | `/api/v1/repos/publish` | topic + artifact ビルド開始 | なし |
| POST | `/api/v1/repos/push` | （非推奨）git bundle | write セッション |
| GET | `/api/v1/portal/catalog/published` | Runner カタログ | なし |
| GET | `/api/v1/portal/apps/{owner}/{name}/artifact` | ソース zip | read セッション |
| GET | `/api/tools/windows-x64/manifest.json` | uv 配布 manifest | 設定による |
| GET | `/api/v1/noraops/diagnostics/run` | **動作確認（スモーク）** JSON | なし |
| GET | `/noraops/diagnostics/run` | 同上（HTML 画面） | ブラウザ |

## 動作確認・テスト

API は上表のとおり。チェック項目の一覧・実行タイミング・拡張とサーバーの役割分担は **[テストと動作確認.md](./テストと動作確認.md)** を正とする。

## 拡張コマンド（主要）

| コマンド | モード |
|----------|--------|
| `noraops.save` | Creator |
| `noraops.openRunner` | Runner |
| `noraops.openAppForEdit` | Runner→Creator |
| `noraops.openSetup` | 両方（サーバー接続・アカウント登録） |
| `noraops.switchMode` | 両方 |
| `noraops.setupTools` | 両方 |

## 環境変数（サーバー `.env`）

| 変数 | 説明 |
|------|------|
| `NORAOPS_AUTH_MODE` | `open` / **`email_token`**（本番）/ レガシー: `windows_trust`, `email_otp` |
| `NORAOPS_PUBLIC_BASE_URL` | メール内リンクのベース URL |
| `NORAOPS_MAIL_*` | 登録・有効化メール送信 |
| `GITEA_BASE_URL` | Gitea |
| `GITEA_TOKEN` | サーバー専用 PAT（user+repository 書き込み） |
| `NORAOPS_PUBLISHED_TOPIC` | 既定 `nora-published` |
| `NORAOPS_SAVE_MAX_ZIP_MB` | zip 上限（既定 50） |
| `NORAOPS_ARTIFACTS_DIR` | artifact キャッシュ |
| `NORAOPS_PYPI_INDEX_URL` | 社内 simple index（空=pypiserver 未使用・拡張は PyPI 直） |
| `NORAOPS_PYPI_FALLBACK_ENABLED` | `1` で PyPI を extra index（監査対象） |
| `NORAOPS_BACKUP_*` | 自動バックアップ・[運用ガイド](./バックアップと復元.md)（`/admin/backup`） |

## 任意: pypiserver（別プロセス）

| 項目 | 説明 |
|------|------|
| 配信 | `127.0.0.1:8081` + IIS `/NoraOps/pypi/` |
| ミラー sync | `nora-backend/scripts/pypi-mirror-sync.py` |
| 手順 | [pypiserver 連携設定書](../nora-backend/docs/pypiserverサービス連携設定書兼仕様書.md) |
