# ライセンス整理

NoraOps モノレポで使う **ソースの権利** と **第三者コンポーネント** をまとめます。

---

## 1. 本リポジトリのソースコード

| 対象 | ライセンス | ファイル |
|------|------------|----------|
| モノレポ全体（NoraOps） | **MIT** | [../LICENSE](../LICENSE) |
| vscode-extension（NoraOps4code） | 同上 | [../vscode-extension/LICENSE](../vscode-extension/LICENSE) |
| nora-backend | 同上 | [../nora-backend/LICENSE](../nora-backend/LICENSE) |

VSIX 同梱: `vsce package` 時に `vscode-extension/LICENSE` が入ります。

---

## 2. nora-backend — Python 依存

### 2.1 直接依存（`requirements.txt` / `pyproject.toml`）

運用・配布に関わる主要パッケージです。

| パッケージ | 用途 | ライセンス（代表） |
|------------|------|-------------------|
| fastapi | Web API | MIT |
| uvicorn[standard] | ASGI サーバー | BSD-3-Clause |
| httpx | HTTP クライアント（Gitea 等） | BSD-3-Clause |
| pydantic[email] | バリデーション | MIT |
| pydantic-settings | 設定 | MIT |
| jinja2 | HTML テンプレート | BSD-3-Clause |
| sqlalchemy | ORM | MIT |
| psycopg[binary] | PostgreSQL ドライバ | **LGPL-3.0-only** |
| openpyxl | XLSX 許可リスト取込 | MIT |
| packaging | バージョン比較 | Apache-2.0 OR BSD-2-Clause |
| python-multipart | アップロード | Apache-2.0 |
| markdown | ヘルプ MD 変換 | BSD-3-Clause |
| pyzipper | バックアップ ZIP（AES） | MIT |

**LGPL 注意**: `psycopg` を本番で使う場合は、社内ポリシーに従いリンク/配布形態を確認してください。

### 2.2 開発・テストのみ

| パッケージ | ライセンス |
|------------|------------|
| pytest | MIT |
| pytest-asyncio | Apache-2.0 |

### 2.3 間接依存を含む全一覧の再生成

`nora-backend` の venv で:

```powershell
cd nora-backend
.\.venv\Scripts\python.exe -m pip install pip-licenses
.\.venv\Scripts\python.exe -m piplicenses --format=markdown -u -d
```

監査・リリース前に上記を実行し、出力を社内記録に保存することを推奨します（2026-06-24 時点で約 40 パッケージ）。

---

## 3. vscode-extension — Node 依存

### 3.1 実行時（VSIX に同梱）

| 種別 | 内容 |
|------|------|
| **ランタイム npm 依存** | **なし**（`dependencies` 未使用） |
| 実行基盤 | VS Code 組み込み Node.js + Extension API |
| 同梱ソース | 本リポジトリ MIT |

拡張本体は `src/` の JavaScript のみを VSIX にパックします。

### 3.2 開発時のみ（`devDependencies`）

| パッケージ | バージョン | ライセンス |
|------------|------------|------------|
| @types/node | ^22.15.3 | MIT |

`npm test` は Node 標準モジュール + 拡張ソースのみで動作します。

### 3.3 再生成

```powershell
cd vscode-extension
npm ls --all
# 各 package.json の license フィールドを確認
```

---

## 4. 同梱・配布バイナリ（Git 外・`data/tools/`）

サーバーが FastAPI 経由で配布するツール。バイナリ本体は `.gitignore` 対象。

| ツール | 配置例 | ライセンス |
|--------|--------|------------|
| **uv** | `data/tools/uv/<ver>/uv.exe` | [Apache-2.0 / MIT](https://github.com/astral-sh/uv) |
| **Portable Git** | `data/tools/git/<ver>/PortableGit-….7z.exe` | GPL-2.0（同梱 LICENSE.txt） |
| **Node.js**（任意） | `data/tools/node/<ver>/node.exe` | [MIT](https://github.com/nodejs/node) |

manifest 正本: `nora-backend/app/bootstrap_data/tools/windows-x64/manifest.json`

---

## 5. 任意インフラ（別インストール）

NoraOps ソースに含まれませんが、運用で併用する場合の参考です。

| コンポーネント | インストール例 | ライセンス |
|----------------|----------------|------------|
| **pypiserver** | `pip install pypiserver` | [zlib / PSF 等](https://github.com/pypiserver/pypiserver)（配布物の LICENSE 参照） |
| **Gitea** | 別途ダウンロード | MIT |
| **IIS / ARR** | Windows Server | Microsoft 利用規約 |

手順: [nora-backend/docs/pypiserverサービス連携設定書兼仕様書.md](../nora-backend/docs/pypiserverサービス連携設定書兼仕様書.md)

---

## 6. ドキュメント分割の方針

| ファイル | 対象 |
|----------|------|
| **本書（`docs/LICENSE.md`）** | モノレポ全体 + バックエンド Python + 同梱ツール + 任意インフラ |
| `vscode-extension/LICENSE` | 拡張ソースの MIT 宣言（VSIX 同梱） |

拡張の第三者依存は実質 **@types/node（開発のみ）** のみのため、本書 §3 に集約しています。

---

*最終更新: 2026-06-24 — pip-licenses による一覧再生成手順を追記*
