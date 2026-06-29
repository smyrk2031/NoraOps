# NoraOps フロー図（開発・運用の地図）

> **誰向け**: 人間の開発者も、生成 AI も。「どこを触ればいいか」が迷子になったときの**最初の一歩**用です。  
> **優しいメモ**: 細かい API 一覧は [機能一覧とAPI.md](../../NoraOps/機能一覧とAPI.md)、拡張のファイル一覧は [MODULES.md](../../vscode-extension/docs/MODULES.md) が正本です。ここは**流れ**に集中しています。

---

## このフォルダの読み方

| 順 | 資料 | いつ読む？ |
|----|------|------------|
| **★** | **[06-データのつながりと保管](./06-データのつながりと保管.md)** | **どこに何が残るか・正本はどこか**（いちばん聞かれがち） |
| 1 | [01-セットアップフロー](./01-セットアップフロー.md) | 初回導入・本番立ち上げ・開発環境構築 |
| 2 | [02-ユーザ利用フロー](./02-ユーザ利用フロー.md) | 「ユーザーが何をしているか」を理解したいとき |
| 3 | [03-拡張内部フロー](./03-拡張内部フロー.md) | `vscode-extension/` を直すとき |
| 4 | [04-バックエンド動作フロー](./04-バックエンド動作フロー.md) | `nora-backend/` を直すとき |
| 5 | [05-機能と編集先マップ](./05-機能と編集先マップ.md) | **「この機能、どのファイル？」** を一発で探す |

**管理者向け（ブラウザ）**: `/admin/topology` — 連携マップ（.env と機能の対応・現状モードの可視化、秘密は非表示）

---

## 全体の一枚絵

```mermaid
flowchart TB
  subgraph people [人]
    Admin[運用・管理者]
    Dev[開発者]
    User[利用者]
  end
  subgraph client [vscode-extension]
    Creator[Creator]
    Runner[Runner]
    Guard[ガードレール<br/>チェック・許可リスト]
  end
  subgraph server [nora-backend]
    API[FastAPI]
    AdminUI[/admin 管理画面]
  end
  subgraph external [外部]
    Gitea[(Gitea)]
    PyPI[(PyPI / 社内ミラー)]
  end
  Admin --> AdminUI
  Admin --> API
  Dev --> client
  Dev --> server
  User --> Creator
  User --> Runner
  Creator --> Guard
  Creator --> API
  Runner --> API
  API --> Gitea
  Guard --> API
  Creator --> PyPI
  Runner --> PyPI
```

**メモ**: 拡張は **git push しない**設計です。保存は zip → サーバー → Gitea。詳細は [02-ユーザ利用フロー](./02-ユーザ利用フロー.md)。

---

## 生成 AI に渡すときのコツ

1. **タスクの種類**に合わせて上の 1〜5 のうち **1 本だけ**をコンテキストに入れると精度が上がります。
2. コード変更後は [05-機能と編集先マップ](./05-機能と編集先マップ.md) で「隣も直す必要があるか」を確認（例: ルール JSON は 3 箇所同期）。
3. 矛盾したら **コードが勝ち**。フロー図は 2026-06 時点の理解です。

---

## 関連ドキュメント

| 資料 | 用途 |
|------|------|
| [製品像とロードマップ](../../NoraOps/製品像とロードマップ.md) | 主機能 / 副機能 / 将来像 |
| [現状とアーキテクチャ](../../NoraOps/現状とアーキテクチャ.md) | 三層・「拡張で git しない」思想 |
| [MAINTENANCE.md](../MAINTENANCE.md) | リリース時の同期ルール |
