# アプリ実行契約（拡張側）

サーバ側の詳細は [app-manifest-contract.md](../../nora-backend/docs/app-manifest-contract.md) と同一です。

## 実行フローの前提

1. **ツール**：`PyGarden Runtime` が `manifestUrl` からツール一覧を取得し `%LOCALAPPDATA%\PyGardenRuntime` に uv / PortableGit を配置。
2. **アプリ**：Gitea で Release を選択 → `.zip` アセットを `apps/` キャッシュに展開 → ルートの `manifest.softrail.json`（または `manifest.json`）を読み、`uv sync`（任意）→ `uv run ...` を実行。

## アンインストール

VS Code が拡張をアンインストールしても **キャッシュフォルダは残ります**。削除する場合:

- コマンドパレット: **PyGarden: Clear runtime cache**

手動削除先の例:

- `%LOCALAPPDATA%\PyGardenRuntime`

## ユーザー向けエラー（ツールDL）

| メッセージの傾向 | 対処 |
|-----------------|------|
| `Download failed (not found)` | FastAPI にファイルを置いたか、`api/tools/files/...` URL を確認 |
| `checksum mismatch` | サーバの manifest の sha256 と実ファイルが一致しているか確認 |
| `PortableGit self-extract failed` | `.7z.exe` が公式配布か、ウィルス対策でブロックされていないか確認 |
