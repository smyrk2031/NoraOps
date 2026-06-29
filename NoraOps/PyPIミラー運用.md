# PyPI ミラー運用（NoraOps）

> **詳細な設定書・仕様・やさしい手順**は **[nora-backend/docs/pypiserverサービス連携設定書兼仕様書.md](../nora-backend/docs/pypiserverサービス連携設定書兼仕様書.md)** を参照してください。

社内パッケージ許可リスト（XLSX → `data/noraops/packages/allowlist.json`）に基づき、**pypiserver** へ wheel/sdist をミラーします。Creator 拡張は社内 index を第一とし、未ミラー分は PyPI フォールバック可能です（フォールバックで入った分はミラーに自動追加しません）。

## 構成

| コンポーネント | 役割 |
|----------------|------|
| nora-backend (FastAPI) | 許可リスト API・deps_audit・審査キュー・ミラー sync CLI |
| pypiserver (NSSM) | `127.0.0.1:8081` で `~/packages` を配信 |
| IIS ARR | 例: `https://intranet/NoraOps/pypi/` → pypiserver |
| 拡張 (uv) | `UV_DEFAULT_INDEX` = 社内 URL、`UV_EXTRA_INDEX_URL` = PyPI（フォールバック時） |

API パス（`/NoraOps/api/...`）と PyPI パス（`/NoraOps/pypi/`）は **別サブパス** に分離してください。

## 1. pypiserver（NSSM）

```powershell
pip install pypiserver
# ミラー配置先（nora-backend の NORAOPS_PYPI_MIRROR_DIR と同一推奨）
$packages = Join-Path (Get-Location) "data\noraops\packages\mirror"
nssm install NoraOpsPypiserver "C:\Python311\python.exe" "-m" "pypiserver" "run" "-p" "127.0.0.1:8081" "-P" $packages
nssm start NoraOpsPypiserver
```

## 2. IIS ARR リバースプロキシ

- サイトに URL Rewrite + ARR を有効化
- ルール例: パス `/NoraOps/pypi/(.*)` → `http://127.0.0.1:8081/{R:1}`
- 社内 LAN のみ / IP 制限（将来 Basic 認証可）

## 3. nora-backend 環境変数

```env
# ARR 経由の simple index（末尾は /simple/ 推奨）
NORAOPS_PYPI_INDEX_URL=https://intranet/NoraOps/pypi/simple/
NORAOPS_PYPI_FALLBACK_ENABLED=1
NORAOPS_PYPI_MIRROR_DIR=./data/noraops/packages/mirror
NORAOPS_PYPI_MIRROR_ARCHIVE_DIR=./data/noraops/packages/mirror-archive
```

拡張の `noraops.server.baseUrl` は API と同じオリジンに合わせます。

## 4. 許可リスト XLSX 取込

1. 管理画面 `/admin/packages` から XLSX をアップロード  
2. **列位置はフォームで指定**（フォーマット変更に対応）

| 項目 | 既定 | 必須 | 説明 |
|------|------|------|------|
| ヘッダ行番号 | `9` | はい | この行の次からデータ行（例: 9 → 10 行目以降） |
| 分類列 | `A` | いいえ | 空欄で分類列を使わない |
| 分類フィルタ | `Pythonライブラリ` | いいえ | 空欄でフィルタなし |
| パッケージ名列 | `B` | はい | PyPI パッケージ名 |
| バージョン列 | `C` | はい | `2.*` / `1.*.*` / PEP 440 / 空・`-`＝全バージョン |
| メンテナンス日列 | `D` | いいえ | 取込メタデータとして保存 |

**取込結果の分類**

| 分類 | 許可リストへ |
|------|-------------|
| 許可 | 反映する |
| 要確認 | 反映しない（解釈不能・怪しいバージョン等） |
| スキップ | 反映しない（分類不一致・重複等） |

取込後は **差分（追加・削除・変更）** を管理画面で確認できます。

3. または API: `POST /api/admin/packages/allowlist/upload`（multipart + 上記フォーム項目）

## 5. ミラー同期ジョブ

```powershell
cd nora-backend
.\.venv\Scripts\python.exe scripts\pypi-mirror-sync.py
```

- allowlist のパッケージを PyPI から `pip download` で取得  
- allowlist から外れたファイルは `mirror-archive/` へ移動（即削除しない）  
- 状態: `data/noraops/packages/mirror-status.json`

### Windows タスクスケジューラ例

- トリガー: 毎日 02:00  
- 操作: `nora-backend\.venv\Scripts\python.exe scripts\pypi-mirror-sync.py`  
- 作業ディレクトリ: `nora-backend`  
- 失敗時: イベントログまたは `mirror-status.json` の `failures` を確認

## 6. 運用フロー（フォールバック）

1. 開発者が未許可パッケージで uv sync → 拡張 warn、続行可  
2. sync 後 `deps_audit` がサーバーへ送信（Access Token 時はメール付き）  
3. `/admin/packages` で審査キュー・未許可 Top を確認 → XLSX 更新 → 次回ミラー job  
4. **フォールバックで入ったパッケージはミラーに自動追加しない**

## 7. 関連 API

| メソッド | パス | 説明 |
|----------|------|------|
| GET | `/api/v1/noraops/client/runtime-config` | `pypiIndexUrl`, `packageAllowlistEtag` |
| GET | `/api/v1/noraops/packages/allowlist` | 許可リスト（ETag 対応） |
| POST | `/api/v1/noraops/packages/check` | パッケージ承認判定 |
| POST | `/api/v1/noraops/packages/deps-audit` | 未許可依存のテレメトリ |
| PATCH | `/api/admin/packages/review-status` | 審査ステータス（todo / considering / …） |
| GET | `/api/admin/packages/deps-audit-dashboard` | 審査キュー JSON |
