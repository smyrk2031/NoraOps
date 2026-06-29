# manifest.json の sha256 / size の書き方（手順）

対象ファイル:

```text
softrail-server\data\tools\windows-x64\manifest.json
```

**ルール**: 配置した **実ファイル** の SHA-256 とバイト数を入れる。`aaaa…` のダミーは使わない。

---

## 手順一覧（初回・差し替え時とも同じ）

| # | やること |
|---|----------|
| 1 | 公式から取得し、所定フォルダにファイルを置く |
| 2 | PowerShell で **sha256** と **size** を確認する |
| 3 | `manifest.json` に値を書き込む（手動 or スクリプト） |
| 4 | FastAPI を起動し URL が **200** か確認 |
| 5 | VS Code で **NoraOps: ツールをセットアップ** を試す |

---

## 1. ファイルを置く

`softrail-server` フォルダを基準に:

| ツール | 置くファイル |
|--------|----------------|
| uv | `data\tools\uv\0.6.0\uv.exe` |
| git | `data\tools\git\2.54.0\PortableGit-2.54.0-64-bit.7z.exe` |

バージョンを変えたらフォルダ名（`0.6.0` / `2.54.0`）も manifest の `version` と揃える。

---

## 2. sha256 と size を確認する（PowerShell）

**①** PowerShell を開く  

**②** `softrail-server` に移動:

```powershell
cd nora-backend
```

**③** 次をそのまま実行（パスは自分の version に合わせて変更）:

```powershell
$uvFile  = "data\tools\uv\0.6.0\uv.exe"
$gitFile = "data\tools\git\2.54.0\PortableGit-2.54.0-64-bit.7z.exe"

# uv
$uvHash = (Get-FileHash -Path $uvFile -Algorithm SHA256).Hash.ToLower()
$uvSize = (Get-Item -Path $uvFile).Length
"--- uv ---"
"sha256: $uvHash"
"size:   $uvSize"

# git
$gitHash = (Get-FileHash -Path $gitFile -Algorithm SHA256).Hash.ToLower()
$gitSize = (Get-Item -Path $gitFile).Length
"--- git ---"
"sha256: $gitHash"
"size:   $gitSize"
```

**④** 画面に出た 4 つの値をメモする（あとで manifest にコピーする）。

例（値は環境ごとに異なります）:

```text
--- uv ---
sha256: 1a2b3c4d…（64文字）
size:   12345678

--- git ---
sha256: 9f8e7d6c…（64文字）
size:   98765432
```

> **注意**: zip を展開する**前**の zip のハッシュではない。uv は **uv.exe 単体**、git は **.7z.exe インストーラそのもの**。

---

## 3-A. manifest.json に手動で入れる

**①** エディタで開く:

```text
softrail-server\data\tools\windows-x64\manifest.json
```

**②** 次の項目を、手順 2 で出た値に置き換える:

| JSON のキー | 入れる値 |
|-------------|----------|
| `uv.version` | `0.6.0`（フォルダ名と同じ） |
| `uv.url` | `http://127.0.0.1:8000/api/tools/files/uv/0.6.0/uv.exe`（本番はホストを実 URL に） |
| `uv.sha256` | 手順 2 の uv の sha256（**小文字 64 文字**） |
| `uv.size` | 手順 2 の uv の size（**数値のみ**） |
| `portableGit.version` | `2.54.0` |
| `portableGit.url` | `http://127.0.0.1:8000/api/tools/files/git/2.54.0/PortableGit-2.54.0-64-bit.7z.exe` |
| `portableGit.sha256` | 手順 2 の git の sha256 |
| `portableGit.size` | 手順 2 の git の size |

**③** 保存する。

記入例（`sha256` / `size` は仮の値）:

```json
{
  "manifestVersion": "1",
  "channel": "stable",
  "uv": {
    "version": "0.6.0",
    "url": "http://127.0.0.1:8000/api/tools/files/uv/0.6.0/uv.exe",
    "sha256": "ここに手順2のuvのsha256を64文字で",
    "size": 12345678
  },
  "portableGit": {
    "version": "2.54.0",
    "url": "http://127.0.0.1:8000/api/tools/files/git/2.54.0/PortableGit-2.54.0-64-bit.7z.exe",
    "sha256": "ここに手順2のgitのsha256を64文字で",
    "size": 98765432
  }
}
```

---

## 3-B. スクリプトで自動反映（推奨）

手順 2 を省略し、配置済みファイルから manifest を一括更新する。

> **注意**: FastAPI の再起動だけではこのスクリプトは **動きません**。  
> サーバ管理者が PowerShell で **明示的に 1 回実行**する作業です（ファイルを置き換えたときも同様）。

```powershell

```powershell
cd nora-backend

powershell -ExecutionPolicy Bypass -File .\scripts\update-tools-manifest.ps1 `
  -BaseUrl "http://127.0.0.1:8000" `
  -UvVersion "0.6.0" `
  -GitVersion "2.54.0"
```

成功するとターミナルに `uv sha256=…` / `git sha256=…` が表示され、`manifest.json` が上書き保存される。

本番サーバの URL を使う場合は `-BaseUrl "https://git-api.company.local"` のように変える。

---

## 4. 配布 URL の確認

FastAPI を起動した状態で:

```powershell
Invoke-WebRequest -Uri "http://127.0.0.1:8000/api/tools/files/uv/0.6.0/uv.exe" -Method Head
Invoke-WebRequest -Uri "http://127.0.0.1:8000/api/tools/files/git/2.54.0/PortableGit-2.54.0-64-bit.7z.exe" -Method Head
```

どちらも **StatusCode 200** であること。404 ならファイルパスが違う。

manifest 本体:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/tools/windows-x64/manifest.json
```

表示された `sha256` が、手順 2 の値と一致していること。

---

## 5. 拡張側で確認

1. Extension Development Host で **NoraOps: ツールの状態を確認**
2. 問題なければ **NoraOps: ツールをセットアップ（uv / git）**
3. エラー `checksum mismatch` が出たら → サーバ上のファイルと manifest の sha256 が一致していない（手順 2 からやり直し）

---

## ファイルを差し替えたとき

1. 新ファイルを所定パスに上書き（または新 version フォルダに配置）  
2. **`update-tools-manifest.ps1` を再実行**（または手順 2〜3 をやり直す）  
3. FastAPI を再起動（既に動いていれば manifest 読み直しのため任意）  
4. 利用者 PC には **ツールをセットアップ** の再実行を案内  

---

## 古いバージョンのフォルダは消してよいか

| 場所 | 消してよい？ | 条件 |
|------|--------------|------|
| **サーバ** `data\tools\uv\0.5.0\` など | **はい** | `manifest.json` がもうその version を指していないこと |
| **サーバ** いま使っている版（例 `0.6.0`） | **いいえ** | manifest が指している正本 |
| **各 PC** `%LOCALAPPDATA%\NoraOps\runtime\` | **はい** | 消したあと拡張で「ツールをセットアップ」すれば manifest 指定版を再取得 |
| **各 PC** 旧 `%LOCALAPPDATA%\PyGardenRuntime\` | **はい** | NoraOps 移行後は不要（別製品の残骸） |

- サーバに **複数 version を残す**のはロールバック用。不要なら古いフォルダだけ削除で問題なし。  
- クライアントは manifest の **1 バージョンだけ**を取りに来る。古い runtime を消しても、次のセットアップで正本から入り直す。

---

関連: [NoraOpsの導入.md](./NoraOpsの導入.md) · [softrail-server/docs/配布物管理.md](../softrail-server/docs/配布物管理.md)
