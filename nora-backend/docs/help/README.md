# ポータルヘルプのメンテナンス

## 構成

- `manifest.json` … タブ一覧（表示名・カテゴリ・参照 MD）
- 本文 MD は原則 **`NoraOps/`** フォルダ（`NORAOPS_DOCS_DIR`）を正本とする

## タブを追加する

1. `NoraOps/` に Markdown を追加または更新
2. `manifest.json` の `tabs` にエントリを追加:

```json
{
  "id": "my-doc",
  "title": "表示名",
  "icon": "◇",
  "category": "manual",
  "source": { "type": "file", "path": "新しい資料.md" }
}
```

3. ポータル `/help` を再読み込み（サーバー再起動不要）

## カテゴリ

| category | 用途 |
|----------|------|
| overview | アプリ概要 |
| manual | マニュアル |
| spec | 機能仕様 |
| release | リリースノート |
| design | システム設計（拡張含む） |
| license | ライセンス（自動生成タブ） |

## 拡張側ドキュメント

`../vscode-extension/docs/*.md` を `path` に指定可能（リポジトリ相対）。

## ライセンスタブ

`generator: licenses` はサーバー起動時に `requirements.txt`・拡張 `package.json` から一覧を生成します。
