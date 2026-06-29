# NoraOps の導入

社内向け **NoraOps**（保存・Gitea・チェック）を初めて立ち上げる人向けです。  
開発時の細かい手順は [開発時用の動作手順書.md](./開発時用の動作手順書.md)、配置パスの一覧は [ツール配布-配置場所.md](./ツール配布-配置場所.md)、クライアント方針は [ポータルとクライアント.md](./ポータルとクライアント.md) を参照してください。

---

## 1. 構成のイメージ

```text
[VS Code 拡張 NoraOps4code] ──HTTP──► [FastAPI nora-backend] ──API──► [Gitea]
        │                                    │
        │ zip 保存 / artifact GET + uv        │ ツール配布（uv.exe）・サーバー git
        └────────────────────────────────────┘
[Runner / 将来 Tauri] ──同じツール URL / 同じ実体──┘
```

| 部品 | 役割 |
|------|------|
| **FastAPI** | チェックルール配布、リポ作成 API、**共有ツール（uv / git）の配布** |
| **VS Code 拡張** | **Creator**: 保存・チェック・Gitea。**Runner**（Phase1b）: 承認済みアプリの実行 |
| **Gitea** | リポジトリの置き場（Windows Server 上の `gitea.exe` でも可） |

---

## 2. どこにインストールされるか（2か所）

NoraOps のツールは **「社内の正本」** と **「各 PC のコピー」** の 2 段です。  
**一元管理したい資産はサーバ側**（`data/tools`）。PC 側はあとからまとめて消せます。

```text
[公式 GitHub] → 手動配置 → [① サーバ正本] ──HTTP──► [② 各 PC の NoraOps runtime]
                              ↑                           ↑
                         ここを資産として管理              拡張がコピー（削除可）
```

### ① サーバ正本（社内のマスター・ここを資産管理）

| ツール | パス（`nora-backend` 基準） | 中身 |
|--------|-------------------------------|------|
| **uv** | `data\tools\uv\<version>\uv.exe` | 配布する **uv.exe 単体** |
| **git** | `data\tools\git\<version>\PortableGit-…-64-bit.7z.exe` | 配布する **インストーラ**（サーバ上は git.exe ではない） |

**消すとき**: 該当バージョンフォルダを削除し、`manifest.json` からその version を外す。

### ② 各 PC（拡張が「ツールをセットアップ」したあと）

| ツール | パス |
|--------|------|
| **uv** | `%LOCALAPPDATA%\NoraOps\runtime\tools\uv\uv.exe` |
| **git** | `%LOCALAPPDATA%\NoraOps\runtime\tools\portable-git\cmd\git.exe` |
| 状態記録 | `%LOCALAPPDATA%\NoraOps\runtime\tools\tools-state.json` |

**消すとき**（PC だけ初期化）:

```powershell
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\NoraOps\runtime"
```

その後、拡張で **NoraOps: ツールをセットアップ** を再実行すれば、サーバ正本から再取得する。

> **git.exe について**: サーバに置くのは PortableGit の `.7z.exe`。PC 上で初回セットアップ時に展開され、使われるのは `portable-git\cmd\git.exe` です。

---

## 3. 共有ツール（uv / git）の考え方

- **実体の正本は 1 か所** — サーバの `nora-backend/data/tools/` に置き、拡張（Creator/Runner）・将来 Tauri は **同じバイナリ**を FastAPI 経由で取得する。
- **公式のダウンロード元は固定**（社内ミラーはサーバ上のコピーのみ）。
- **バージョン管理** — `manifest.json` の version / sha256 と `policy.forceMinimum*` で、クライアントに「後から取りに来させる」（脆弱性対応・後進）。

### 3.1 公式ダウンロード元（正）

| ツール | 公式 URL | 備考 |
|--------|----------|------|
| **uv** | https://github.com/astral-sh/uv/releases | Windows x64 は `uv-x86_64-pc-windows-msvc.zip` を展開し **uv.exe のみ**を使う |
| **Portable Git** | https://github.com/git-for-windows/git-snapshots/releases | ポータブル向けアセット（例: `PortableGit-<ver>-64-bit.7z.exe`）を選ぶ |

> git の本番リリースは [git-for-windows/releases](https://github.com/git-for-windows/git/releases) にもあるが、NoraOps では **snapshots リリース**を Portable 配布の取得元として使う。

### 3.2 サーバへの配置（導入時・運用時とも同じ）

`nora-backend` リポジトリ内:

| ツール | 配置パス | 例（version は manifest と一致させる） |
|--------|----------|----------------------------------------|
| uv | `data\tools\uv\<version>\uv.exe` | `data\tools\uv\0.6.0\uv.exe` |
| git | `data\tools\git\<version>\PortableGit-<version>-64-bit.7z.exe` | `data\tools\git\2.54.0\PortableGit-2.54.0-64-bit.7z.exe` |

絶対パス例:

```text
nora-backend\data\tools\uv\0.6.0\uv.exe
nora-backend\data\tools\git\2.54.0\PortableGit-2.54.0-64-bit.7z.exe
```

### 3.3 manifest の sha256 とは

`data\tools\windows-x64\manifest.json` の `sha256` は、**その URL で配るファイル 1 個分の指紋（SHA-256 ハッシュ）** です。

| 項目 | 内容 |
|------|------|
| **何のため** | ダウンロード後の **破損・取り違え・改ざん** を検知する（拡張が DL 後に再計算して一致するか見る） |
| **何のためではない** | ベンダー署名の代替ではない。社内で「この版のこのファイル」と決める **在庫ラベル** に近い |
| **いつ設定する** | サーバに **最終ファイルを置いたあと**、manifest を公開する直前 |
| **基準** | **実ファイルのバイト列全体**を SHA-256 した **64 文字の小文字 hex**（プレースホルダ不可） |
| **size** | 同じファイルのバイト数。進捗表示・人的確認用（sha256 とセットで更新） |

**手順（コピペ用）**: **[manifest-jsonの書き方.md](./manifest-jsonの書き方.md)** に番号付きで記載。

要約:

1. ファイルを `data\tools\...` に配置  
2. PowerShell で `Get-FileHash` → **sha256**（小文字 64 文字）と **size** を確認  
3. `manifest.json` に貼る（または `nora-backend\scripts\update-tools-manifest.ps1` で自動反映）  
4. `GET /api/tools/files/...` が 200 か確認  
5. 拡張で「ツールをセットアップ」を試す  

詳細・理論: [nora-backend/docs/配布物管理.md](../nora-backend/docs/配布物管理.md) §5。

### 3.4 導入時チェックリスト（サーバ管理者）

1. 上記 **公式 URL** から対象バージョンのアセットを取得  
2. 上記 **配置パス** にコピー  
3. `data\tools\windows-x64\manifest.json` を更新  
   - `version` / `url` / `sha256` / `size`  
   - 必要なら `policy.forceMinimumUvVersion` / `forceMinimumGitVersion`  
4. FastAPI を起動し、次が **200** であること  

```powershell
Invoke-WebRequest -Uri "http://127.0.0.1:8000/api/tools/files/uv/0.6.0/uv.exe" -Method Head
Invoke-WebRequest -Uri "http://127.0.0.1:8000/api/tools/files/git/2.54.0/PortableGit-2.54.0-64-bit.7z.exe" -Method Head
```

manifest 更新は [manifest-jsonの書き方.md](./manifest-jsonの書き方.md) の手順 2〜3 を参照。

---

## 4. クライアント（VS Code 拡張）の導入

### 4.1 前提

- FastAPI が起動している（例: `http://127.0.0.1:8000`）
- サーバ側で **3.4** のツール配置が完了している

### 4.2 設定（ユーザー）

```json
{
  "noraops.server.baseUrl": "http://127.0.0.1:8000"
}
```

| 設定 | 用途 |
|------|------|
| `noraops.server.baseUrl` | チェックルール・リポ作成・**zip 保存**・artifact・ツール manifest |
| `noraops.gitea.baseUrl` | （任意）表示用。未設定時はサーバーから取得 |
| `noraops.gitea.token` | **不要**（git はサーバーのみ） |

**Gitea PAT** は `nora-backend/.env` の `GITEA_TOKEN` のみ。拡張は git を使わず Credential Helper は出ません。

公開アプリ契約: [nora-backend/docs/app-artifact-contract.md](../nora-backend/docs/app-artifact-contract.md)

### 4.3 ツールの取得（PC ごと・初回）

拡張は起動時に **自動ダウンロードしない**。次を実行する:

| コマンド | 内容 |
|----------|------|
| **NoraOps: ツールをセットアップ（uv / git）** | FastAPI から DL → `%LOCALAPPDATA%\NoraOps\runtime\tools\` |
| **NoraOps: ツールの状態を確認** | インストール済みバージョンと manifest の差分 |

ローカル配置先:

```text
%LOCALAPPDATA%\NoraOps\runtime\tools\uv\uv.exe
%LOCALAPPDATA%\NoraOps\runtime\tools\portable-git\cmd\git.exe
```

### 4.4 日常の使い方

| 操作 | 場所 |
|------|------|
| **保存**（Gitea へ） | 画面下ステータスバー「保存」 |
| **ホーム** | ステータスバー「NoraOps」または `NoraOps: ホームを開く` |
| **履歴** | ステータスバー「履歴」 |

**保存だけ**なら uv は不要。git は Portable Git（セットアップ後）または PATH 上の `git` で動作する。

---

## 5. 今後の運用（バージョンアップ・脆弱性対応）

### 5.1 流れ（サーバ側）

1. **公式 URL** で新バージョンを確認  
   - uv: https://github.com/astral-sh/uv/releases  
   - git: https://github.com/git-for-windows/git-snapshots/releases  
2. 新ファイルを **新バージョンのフォルダ**に配置（旧版は残してよい）  
3. `manifest.json` の `version` / `url` / `sha256` / `size` を切り替え  
4. 緊急時は `policy.forceMinimumUvVersion` / `forceMinimumGitVersion` を上げ、古いクライアントに更新を促す  
5. `GET /api/tools/files/...` が 200 であることを確認  

### 5.2 流れ（利用者側）

1. **NoraOps: ツールの状態を確認** → 「更新あり」  
2. **NoraOps: ツールをセットアップ（uv / git）** → 再 DL・検証・配置  

拡張は manifest の **etag 的な version 比較**で、サーバが進んだバージョンだけ取りに行く。

### 5.3 やらないこと

- 利用者 PC ごとに公式サイトから直接バラバラに落とす（バージョンが散らばる）  
- manifest の sha256 を更新せずに exe だけ差し替える（検証エラーになる）  

---

## 6. 関連ドキュメント

| ドキュメント | 内容 |
|--------------|------|
| [ツール配布-配置場所.md](./ツール配布-配置場所.md) | パス・manifest キー一覧 |
| [開発時用の動作手順書.md](./開発時用の動作手順書.md) | F5・FastAPI・Gitea の試し方 |
| [スリムPhase1.md](./スリムPhase1.md) | Phase1a の機能範囲 |
| [manifest-jsonの書き方.md](./manifest-jsonの書き方.md) | **sha256 / size の確認と manifest 反映（手順）** |
| [nora-backend/docs/配布物管理.md](../nora-backend/docs/配布物管理.md) | サーバ側の詳細運用 |

---

*ダウンロード元: uv → astral-sh/uv releases、git → git-for-windows/git-snapshots releases（社内配布は FastAPI `data/tools` のみ）。*
