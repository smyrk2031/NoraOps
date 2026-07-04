# Changelog — NoraOps4code

形式は [Keep a Changelog](https://keepachangelog.com/ja/1.0.0/) に準拠。バージョンは [Semantic Versioning](https://semver.org/lang/ja/)（拡張の `package.json`）。

## [0.24.0] — 2026-07-04

### Added

- **Runner**: ZIP 取込ヘルプモーダル（契約・除外ファイル・作り方）
- **Runner**: デスクトップ SC のサムネアイコン（`nora/assets/thumbnail.png` 等）
- **Runner**: `.env` 同期（`runner-dotenv` · 開発 WS からの救済）
- **Runner**: VS Code 外起動（`runner-launch.js` + `vscode-shim.js`）
- **docs**: `flows/07-モードと機能マップ.md` — 引き継ぎ用全体図

### Fixed

- **Runner**: デスクトップ SC — OneDrive 日本語パス・文字化け・モジュール未検出
- **Runner**: SC ファイル名から `__app-*` ID サフィックスを除去（表示名のみ）
- **Python 環境**: VS Code 外では出力チャンネル無しでも `uv` 実行可能

### Changed

- `stage-bundled-uv.ps1` — PowerShell 文字化け修正
- `docs/` 核 MD 全面メンテ（MAINTENANCE · README · flows 01–07）

## [0.23.0] — 2026-06-21

### Added

- **Runner**: **ZIP から追加** — 契約どおりの ZIP を手動取込（Gitea / サーバー不要・オフライン可）
- **Runner**: 公開アプリの **オフライン起動**（ローカルキャッシュがある場合）
- **Runner**: お気に入りから **デスクトップショートカット** 作成（🖥 ボタン）
- **uv 同梱フォールバック** — `resources/tools/windows-x64/uv.exe` + `noraops.tools.useBundledUv`（既定 ON）
- スクリプト: `vscode-extension/scripts/stage-bundled-uv.ps1`

## [0.22.1] — 2026-06-21

### Added

- **Connect**: 実行履歴（ワークスペースに最大 50 件・接続ごとに再実行・応答確認）
- **Connect**: **curl コピー**（フォーム内容または履歴のリクエストから生成）

## [0.22.0] — 2026-06-21

### Added

- **Connect タブ**: Setting と Prompt の間に追加 — 任意 URL への GET/POST をワンクリック実行
- **接続プロファイル**: 追加・編集・削除・並べ替え（ワークスペース単位 `connectProfiles`）
- **応答表示**: テキスト/JSON はパネル表示、バイナリは「ファイルとして保存」（`Content-Disposition` 対応）
- コマンド: `NoraOps: Connect（API 接続）`

## [0.21.1] — 2026-06-21

### Changed

- **基本プロンプト**: ワークスペースのフォルダ名・manifest・モック spec からアプリ名を自動反映（固定名禁止を明記）
- **仕様書 / 手順書**: MD に加え **HTML 版**（実画面 UI 復元・Mermaid フロー）
- **ドキュメント統括**: `docs/` 内 md・html を `docs/ドキュメント統括.html` にタブ統合する基本プロンプトを追加

## [0.21.0] — 2026-06-21

### Changed

- **Memo → Prompt タブ**: 自由メモから **プロンプト帳** に再設計（`creatorPrompts.js`, `promptPanel.js`, `noraops-prompt.html`）
- **基本プロンプト**: 拡張同梱（削除不可・有効/無効切替）— モック / 0→1 実装 / 環境 / xLLM 各種
- **マイプロンプト**: 自由追加・編集・削除・並べ替え・有効/無効・xLLM 表示 ON/OFF
- **xLLM ①**: 有効プロンプトをタイトルボタンでワンクリック選択（5 件超は「・・・」展開）
- **ドキュメント分割**: README / 仕様書 / 手順書 / ライセンス / フローチャート / **解体新書** を個別プロンプト化
- **旧 Memo 移行**: `creatorMemos` → `creatorPromptsCustom` へ初回読み込み時に自動移行

### Added

- **サーバー同期**: `GET /api/v1/noraops/prompts/builtin-catalog`、Prompt タブの「最新に更新」
- **モジュール**: `builtinPromptCatalog.js`, `promptResolve.js`, `promptSync.js`

### Tests

- `creatorPrompts.test.js` 他（計 **147** 件 pass）

## [0.20.0] — 2026-06-21

### Added

- **シェル 4 タブ**: Setting → Memo → Creator → Runner（`noraOpsShell.js`）
- **Memo タブ**: ワークスペース単位の開発メモ（検索・並べ替え・上下移動、`creatorMemos.js`）
- **xLLM ソース選択**: ワークスペース全体 / フォルダ / ファイルツリーモーダル（チェック UI）
- **xLLM 圧縮**: なし・軽量・標準（デフォルト）・骨格のみ + 説明モーダル（`xllmCompress.js`）
- **xLLM 返答取り込み P1**: クリップボードから追記・置換、分割返答のマージ、ゆるいパーサー（`xllmResponseParse.js`）
- **Creator UI 状態永続化**: タブ切替後も xLLM 入力・スコープ・圧縮モード等を復元（`creatorUiState.js`）

### Fixed

- **Setting タブ**: Webview 読み込みレースで接続チェック一覧が空になる問題（`setupReady` + 直接 postMessage）

### Tests

- `xllmCompress.test.js`, `xllmFileTree.test.js`, `xllmResponseParse.test.js`, `creatorMemos.test.js` 他（計 136 件）

## [0.19.1] — 2026-06-21

### Added

- Runner 版公開（semver tag）、公開ゲート、部分失敗 UI、お気に入り常に最新

## [0.19.0] 以前

→ [NoraOps/実装記録.md](../NoraOps/実装記録.md)
