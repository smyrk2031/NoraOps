# アプリ実行契約（Gitea Release / NoraOps）

NoraOps（Runner）が Gitea の Release アセットからアプリを取得し `uv` で実行するときに、リポジトリ側が守るべき規約です。  
ツールチェーンの配布（`uv.exe` / PortableGit）とは別の概念であり、[配布物管理.md](配布物管理.md) と併せて読みます。

## スキーマ `schemaVersion: "1"`

リポジトリルートまたは展開後のzipルートに **`manifest.softrail.json`**（推奨）または **`manifest.json`** を配置します。

### 最小例

```json
{
  "schemaVersion": "1",
  "name": "my-app",
  "uvRun": ["python", "-m", "my_package"]
}
```

| フィールド | 必須 | 説明 |
|-----------|------|------|
| `schemaVersion` | はい | 現状 `"1"` のみ |
| `name` | はい | 表示用の短い名前 |
| `uvRun` | はい | `uv run` に渡す引数配列（先頭からそのまま連結）。例: `["python","-m","app"]` |
| `syncBeforeRun` | いいえ | `true` のとき初回実行前に `uv sync` を実行（デフォルト `true`） |

### Release アセット規約（推奨フェーズ）

- **単一ZIP** でルートまたは1階層下に上記マニフェストとソースが含まれること。
- アセット名の例: `app-<semver>.zip` または `sources.zip`。拡張は **`.zip` 終端のアセットを優先**して取得します。
- 公開リポでもプライベートでも、ユーザーは Gitea で取得権限が必要です（PAT）。

### エラーとユーザー向け意味

| 状況 | 意味・対処 |
|------|-----------|
| 404 on asset | サーバにファイル未配置または URL 誤り。Release に zip を添付する。 |
| ハッシュ検証（将来）不一致 | 配布ファイル破損。再アップロードし manifest の sha を更新。 |
| `cmd/git.exe` 不在 | PortableGit 展開に失敗。公式 `.7z.exe` を確認。 |
| `uvRun` 不正 | manifest の `uvRun` を、`uv run …` と同様に修正。 |

### アンインストールとキャッシュ

- ランタイム（uv / PortableGit）は `%LOCALAPPDATA%\PyGardenRuntime` に配置され、**拡張削除だけでは自動では消えません**。
- 意図的に削除する場合は VS Code でコマンド **「PyGarden: Clear runtime cache」を実行したうえで、フォルダを削除**してください。

## FastAPI・拡張との用語整合

- **ツール manifest**: `data/tools/windows-x64/manifest.json`（uv / PortableGit）。
- **アプリ manifest**: 上記 `manifest.softrail.json` / `manifest.json`。
