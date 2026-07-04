# 基本プロンプトカタログ（CMS）

拡張 Prompt タブの **基本プロンプト** をサーバーから配布・管理する手順です。

## ファイルと API

| 項目 | パス |
|------|------|
| 本番データ（CMS が書く） | `data/noraops/prompts/builtin-catalog.json` |
| シード（初回コピー元） | `app/bootstrap_data/noraops/prompts/builtin-catalog.json` |
| 配信 API | `GET /api/v1/noraops/prompts/builtin-catalog` |
| CMS API | `GET/POST /api/admin/cms/builtin-prompts` |

初回起動時、`data/` にカタログが無い（または空に近い）場合は **bootstrap から自動コピー** されます。

## CMS での編集

1. ブラウザで `/admin/cms` を開く（Basic 認証が有効ならログイン）
2. **基本プロンプト** カードを開く
3. 行をクリックして編集、または **＋ 追加**
4. **一覧に反映** → **カタログを保存**

保存後、拡張は Prompt タブの **最新に更新**（または次回同期）で反映されます。  
サーバー版が同梱版より新しいときだけ拡張が上書きします（`catalogVersion` 比較）。

## 本番反映チェックリスト

- [ ] `data/noraops/prompts/builtin-catalog.json` が存在し、`version` と `prompts` が入っている
- [ ] 古い空ファイルが残っていない（空だと bootstrap より優先され内容が空のままになる）
- [ ] `GET /api/v1/noraops/prompts/builtin-catalog` で JSON が返る
- [ ] CMS 画面の件数・version が期待どおり

## bootstrap の更新（開発）

拡張同梱 `builtinPromptCatalog.js` を正本にしたい場合:

1. 拡張側でカタログを更新・バージョン bump
2. `bootstrap_data/noraops/prompts/builtin-catalog.json` を同期
3. 本番は CMS 保存またはファイル差し替え

## 動的プロンプト

`dynamic: true` の項目はサーバーでは `body: null`。本文は拡張がワークスペースから生成します（モック / 0→1 / 環境など）。
