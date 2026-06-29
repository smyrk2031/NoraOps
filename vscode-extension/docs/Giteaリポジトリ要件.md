# Gitea リポジトリ要件（拡張同梱）

**正本（詳細）**: リポジトリ直下の [NoraOps/Giteaリポジトリ要件.md](../../NoraOps/Giteaリポジトリ要件.md)

## 最小構成

- `nora/manifest.json` — エントリ・表示名
- `pyproject.toml` — ルート・直下 1 階層・`nora/packages/` のいずれか（uv 依存の正本）
- 起動用 `.py` — manifest の `entry`
- `README.md` または `README.html` — Runner 検索用の説明
- `.gitignore` — `.env` / `.venv` 除外

## 保存と公開

| 操作 | 必須ファイル |
|------|-------------|
| **Gitea 保存のみ** | 推奨（不足は ToDo 表示。保存は可能） |
| **Runner 公開** | README + pyproject + manifest + entry + SEC/POL error なし |

公開 = topic `nora-published` + semver git tag（例 `v1.0.0`）+ artifact。Creator クラウドタブの「Runner に公開する」または公開リリースモーダル。

保存成功・公開失敗時は拡張が別メッセージで通知します。

## Creator の順序

1 雛形 → 2 開発 → 3 pyproject 依存 → 4〜5 uv → 6 F5 → 7 Gitea 保存（任意で公開）

## Runner

- **お気に入り**: 常に最新公開版で起動。版を選ぶ場合は検索モーダルから。
- **検索モーダル**: 版ドロップダウン・公開者メール表示（v0.19+）
