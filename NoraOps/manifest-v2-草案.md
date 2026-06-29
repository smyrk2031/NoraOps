# nora.manifest/2 草案

**状態**: 草案（v1 との共存期間あり）  
**正本**: [ワークスペース設計改定.md](./ワークスペース設計改定.md) §3, §5

---

## 1. v1 からの変更点

| 項目 | v1（現行） | v2（草案） |
|------|-----------|-----------|
| `entry` | ワークスpace 相対（例 `nora/dev/main.py`） | **リポジトリルート相対**（例 `main.py`, `src/app.py`） |
| `thumbnail` | `assets/thumbnail.png`（nora/ 以下相対） | **`assets/thumbnail.png`（リポジトリルート相対）** |
| `packagesProject` | `"nora/packages"` | **省略可**（省略時はルート `pyproject.toml`） |
| `schema` | `nora.manifest/1` | `nora.manifest/2` |

**読み取り互換**: 拡張は v1 / v2 両方受理。v1 の `entry` / `packagesProject` / nora 相対 thumbnail は [互換方針.md](./互換方針.md) に従う。

---

## 2. スキーマ（JSON）

```json
{
  "schema": "nora.manifest/2",
  "appId": "nora.app.550e8400-e29b-41d4-a716-446655440000",
  "displayName": "請求ツール",
  "language": "python",
  "entry": "main.py",
  "entryKind": "script",
  "entryModule": null,
  "version": "0.1.0",
  "stage": "trial",
  "thumbnail": "assets/thumbnail.png",
  "createdBy": "noraops4code",
  "noraopsVersion": "2"
}
```

### フィールド

| フィールド | 必須 | 説明 |
|-----------|------|------|
| `schema` | はい | `"nora.manifest/2"` |
| `appId` | はい | `nora.app.{uuid}`。不変 |
| `displayName` | はい | 表示名 |
| `language` | はい | 現状 `"python"` |
| `entry` | script 時 | **ルート相対** `.py` パス |
| `entryKind` | はい | `"script"` \| `"module"` |
| `entryModule` | module 時 | `python -m` 用 |
| `version` | 推奨 | セマンティック版 |
| `stage` | 任意 | `trial` / `stable` 等 |
| `thumbnail` | 任意 | **ルート相対** PNG パス |
| `packagesProject` | 任意 | 省略 = ルート。互換: `"nora/packages"` |

---

## 3. entry 解決（改定後）

優先順:

1. manifest `entryKind` / `entry` / `entryModule`  
2. ルート `main.py`, `app.py`, `run.py`  
3. `src/main.py`  
4. 互換: `nora/dev/main.py`, `nora/packages/main.py`  

---

## 4. thumbnail

| パス | 用途 |
|------|------|
| `assets/thumbnail.png` | **推奨**（README 画像と同フォルダ） |
| `nora/assets/thumbnail.png` | v1 互換読み取り |

manifest 保存時: ファイルが `assets/thumbnail.png` にあれば `thumbnail` フィールドを自動設定。

---

## 5. README テンプレ連携

Creator「公開準備」で README 雛形を生成する際、次をプロンプトに含める。

```markdown
# {{displayName}}

## このアプリについて
（Runner 検索・Gitea 説明に使う 1〜3 文）

## 使い方
1. …

## スクリーンショット
![説明](assets/screenshot-01.png)

## 必要環境
- Python 3.11+

## 作者
（任意）
```

**assets フォルダ**: 初回 scaffold で `assets/.gitkeep` のみ（①②）。サムネ UI は `assets/thumbnail.png` に保存。

---

## 6. 実装メモ

| コンポーネント | 対応 |
|---------------|------|
| `thumbnailAsset.js` | ルート `assets/` 優先、nora/assets フォールバック |
| `appEntry.js` | v2 entry をルート基準に解決 |
| `releaseValidation.js` | ルート pyproject 受理 |
| サーバー `repo_save.py` | schema バージョン不問（appId 必須は維持） |
| テンプレ `resources/templates/nora/manifest.json` | v2 + entry デフォルト `main.py`（greenfield 移行時） |

---

*最終更新: Phase 0 草案*
