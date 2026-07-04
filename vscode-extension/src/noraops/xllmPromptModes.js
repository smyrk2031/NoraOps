/**
 * xLLM — エクスポートモード別プロンプト（短く・実用寄り）
 */

const path = require("path");
const fs = require("fs");
const { resolveScaffoldRoot } = require("./scaffold");

/** アプリ向けドキュメントの既定保存先（ワークスペースルート直下） */
const DOCS_DIR_REL = "docs";

const EXPORT_MODES = {
  GENERAL: "general",
  ERROR: "error",
  DOCS: "docs",
};

const SCHEMA_BY_MODE = {
  [EXPORT_MODES.GENERAL]: "nora.xllm-export/1",
  [EXPORT_MODES.ERROR]: "nora.xllm-export-error/1",
  [EXPORT_MODES.DOCS]: "nora.xllm-export-docs/1",
};

function normalizeExportMode(mode) {
  if (mode === EXPORT_MODES.ERROR) return EXPORT_MODES.ERROR;
  if (mode === EXPORT_MODES.DOCS) return EXPORT_MODES.DOCS;
  return EXPORT_MODES.GENERAL;
}

function getSchemaForMode(mode) {
  return SCHEMA_BY_MODE[normalizeExportMode(mode)] || SCHEMA_BY_MODE[EXPORT_MODES.GENERAL];
}

function getModeLabel(mode) {
  const m = normalizeExportMode(mode);
  if (m === EXPORT_MODES.ERROR) return "エラー調査";
  if (m === EXPORT_MODES.DOCS) return "ドキュメント一式";
  return "通常";
}

function readWorkspaceVersionContext(workspaceRoot) {
  const root = workspaceRoot ? resolveScaffoldRoot(workspaceRoot) : "";
  const { readNoraManifest } = require("./appEntry");
  const { readVersion } = require("./versionUtil");
  const man = root ? readNoraManifest(root) : null;
  const pyVer = root ? readVersion(root) : null;
  const manifestVer = man?.version ? String(man.version) : null;
  const workspaceFolder = workspaceRoot ? path.basename(workspaceRoot) : "ワークスペース";
  const displayName = String(man?.displayName || man?.label || man?.name || "").trim();
  let mockAppTitle = "";
  if (workspaceRoot) {
    try {
      const { readMockSpec } = require("./mockPrompts");
      mockAppTitle = String(readMockSpec(workspaceRoot)?.appTitle || "").trim();
    } catch {
      /* ignore */
    }
  }
  const appName = mockAppTitle || displayName || workspaceFolder;
  const docsFiles = workspaceRoot ? listDocsFolderFiles(workspaceRoot) : [];
  return {
    version: manifestVer || pyVer || "0.1.0",
    pyVersion: pyVer,
    manifestVersion: manifestVer,
    appName,
    displayName: displayName || workspaceFolder,
    workspaceFolder,
    workspaceRoot: root || workspaceRoot || "",
    docsDir: `${DOCS_DIR_REL}/`,
    docsFiles,
  };
}

/**
 * `docs/` 内の md / html 一覧（統括ドキュメント用）
 * @param {string} workspaceRoot
 */
function listDocsFolderFiles(workspaceRoot) {
  if (!workspaceRoot) return [];
  const docsPath = path.join(resolveScaffoldRoot(workspaceRoot), DOCS_DIR_REL);
  if (!fs.existsSync(docsPath)) return [];
  try {
    return fs
      .readdirSync(docsPath)
      .filter((f) => /\.(md|html?)$/i.test(f))
      .sort((a, b) => a.localeCompare(b, "ja"));
  } catch {
    return [];
  }
}

function buildWorkspaceContextBlock(ctx = {}) {
  const name = ctx.appName || ctx.displayName || ctx.workspaceFolder || "このアプリ";
  const folder = ctx.workspaceFolder || "（ワークスペース）";
  const ver = ctx.version || "0.1.0";
  const docsList =
    Array.isArray(ctx.docsFiles) && ctx.docsFiles.length
      ? ctx.docsFiles.map((f) => `\`${DOCS_DIR_REL}/${f}\``).join(", ")
      : "（まだファイルなし）";
  return `## このワークスペース（自動反映 — 固定名にしないこと）

| 項目 | 値 |
|------|-----|
| フォルダ名 | \`${folder}\` |
| アプリ表示名 | **${name}** |
| バージョン | ${ver} |
| ドキュメント保存先 | \`${DOCS_DIR_REL}/\`（ワークスペースルート直下。**ユーザー任意パスではない**） |
| 既存 docs ファイル | ${docsList}

- プロンプト内の「このアプリ」「アプリ名」は上記 **${name}** を使う。別名・プレースホルダ名は使わない。`;
}

function buildSingleResponseRule() {
  return `- **1 回の返答にまとめる**: 変更するファイルは **すべて 1 つの返答** に入れる。チャットを分割しない。
  - 「続きは次へ」「ファイルごとに送る」は **不可**（Gemini 等でもこの形式で一括出力）
  - 前置き・後書きは最小限。説明は各 \`### FILE:\` の直前に短く`;
}

function buildSecurityCautionLine() {
  return `- コードにセキュリティ違反（IP 直書き・秘密情報等）があれば **修正を優先**。新規に同種の問題を入れない。`;
}

function buildFileOutputFormatBlock() {
  return `${buildSingleResponseRule()}
- 出力は **次の形式のみ**（触らないファイルは出さない）:

\`\`\`markdown
### FILE: path/to/file
\`\`\`言語
（全文）
\`\`\`
\`\`\``;
}

function buildGeneralInstructions(ctx = {}) {
  const ver = ctx.version || "0.1.0";
  const name = ctx.appName || "このアプリ";
  return `## AI への指示（通常モード — ${name}）

${buildWorkspaceContextBlock(ctx)}

**方針**: シンプル・実用。説明は短く。余計な装飾や長文は避ける。

- 複数ファイル構成。各ファイルは \`### FILE: 相対パス\` で区切られています。
${buildFileOutputFormatBlock()}
- **バージョン**（現在 ${ver}）: 利用者に見える変更時は **SemVer** で更新。
  - 破壊的変更 → major / 機能追加 → minor / バグ修正・文言 → patch
  - \`nora/manifest.json\` の \`version\` と \`pyproject.toml\` の \`version\` を揃える
  - \`${DOCS_DIR_REL}/CHANGELOG.md\` に1行追記（なければ作成）。例: \`- 0.2.1: ログイン画面のバリデーション追加\`
- **GUI アプリ**: タイトルバー等に \`${name} v${ver}\` のように **上記アプリ表示名** を反映
${buildSecurityCautionLine()}
- 不明点は \`### QUESTION:\` で質問。秘密情報は出力しない。`;
}

function buildDocsBundleInstructions(ctx = {}) {
  const ver = ctx.version || "0.1.0";
  const name = ctx.appName || "このアプリ";
  return `## AI への指示（ドキュメント一式モード）

**方針**: 簡潔・実務向け。華美にしない。推測は「要確認」と明記。

\`docs/\` に次の **5 ファイル** を生成または更新（ソースから読み取り、既存は統合）:

| ファイル | 内容 |
|----------|------|
| \`docs/README.md\` | 概要・背景・**どんな業務のどの部分**を手作業していたか・**何を自動化**し**どんな効果**か |
| \`docs/仕様書.md\` | 機能仕様・画面・データ・制約 |
| \`docs/手順書.md\` | セットアップ・日常操作・障害時の手順 |
| \`docs/ライセンス.md\` | 利用条件（権利者不明ならプレースホルダ） |
| \`docs/フローチャート.md\` | 主要フローを **Mermaid**（\`\`\`mermaid ブロック） |

${buildFileOutputFormatBlock()}
- アプリ名目安: ${name} / バージョン: ${ver}
- 将来のアプリ UI では「ヘルプ」ボタン → \`docs/\` の Markdown 表示を想定（今回は md のみ）
${buildSecurityCautionLine()}
- コード変更が不要なら md だけ返す。秘密情報は出力しない。`;
}

const SINGLE_DOC_SPECS = {
  readme: {
    path: `${DOCS_DIR_REL}/README.md`,
    label: "README",
    format: "md",
    focus:
      "概要・背景・**どんな業務のどの部分**を手作業していたか・**何を自動化**し**どんな効果**があるか。利用者向けに簡潔に。アプリ表示名はワークスペース情報の名前を使う。",
  },
  spec: {
    path: `${DOCS_DIR_REL}/仕様書.md`,
    label: "仕様書（Markdown）",
    format: "md",
    focus:
      "機能仕様・画面・データ構造・制約・非機能要件。ソースと矛盾しないこと。画面名は実装のラベル・ウィンドウタイトルに合わせる。",
  },
  specHtml: {
    path: `${DOCS_DIR_REL}/仕様書.html`,
    label: "仕様書（HTML）",
    format: "html",
    focus: `**1 ファイル完結の HTML 仕様書**（ブラウザで開ける）。

**UI 復元の方針**（重要）:
- プロジェクト内の **実画面** を参照: \`static/\`・テンプレート・\`nora/mock/index.html\`・\`main.py\` の UI コード
- 各画面を HTML で **レイアウト再現**（色・余白・主要ラベル・ボタン配置）。スクリーンショット画像が無くても、コードから読み取れる見た目を再現
- 画面ごとに \`<section id="screen-...">\` と見出し。ナビ or アンカーでジャンプ可能に

**フロー**:
- 主要フローはページ内に **Mermaid**（\`<pre class="mermaid">\`）または簡潔な HTML フローチャートで記述
- 画面遷移とデータの入出力を対応づける

**技術**:
- 外部 CDN 不要（Mermaid は使う場合 \`mermaid.min.js\` を同梱するか、CSS フロー図で代替可）
- インライン CSS。印刷にも耐えるシンプルなデザイン`,
  },
  manual: {
    path: `${DOCS_DIR_REL}/手順書.md`,
    label: "手順書（Markdown）",
    format: "md",
    focus:
      "セットアップ・日常操作・障害時の対処。手順は番号付きで具体的に。操作名は実アプリのボタン・メニュー表記に合わせる。",
  },
  manualHtml: {
    path: `${DOCS_DIR_REL}/手順書.html`,
    label: "手順書（HTML）",
    format: "html",
    focus: `**1 ファイル完結の HTML 手順書**。

**UI 連動**:
- 手順の各ステップで **該当画面の HTML ミニ復元**（実装 / モック HTML からレイアウトを写す）
- 「① ログイン画面で…」→ その画面の簡易 UI ブロックを手順直下に表示
- 操作対象（ボタン・入力欄）を \`<mark>\` や枠線で強調

**フロー**:
- 初回セットアップ〜日常利用〜障害時を章立て
- 複雑な流れは Mermaid または番号付きフロー図を併記

**技術**: 外部 CDN 不要・インライン CSS・1 ファイルで完結`,
  },
  license: {
    path: `${DOCS_DIR_REL}/ライセンス.md`,
    label: "ライセンス",
    format: "md",
    focus: "利用条件・権利者・免責。不明ならプレースホルダと要確認を明記。",
  },
  flowchart: {
    path: `${DOCS_DIR_REL}/フローチャート.md`,
    label: "フローチャート",
    format: "md",
    focus: "主要フローを **Mermaid**（\\`\\`\\`mermaid ブロック）で記述。画面遷移・バッチ処理を網羅。",
  },
  teardown: {
    path: `${DOCS_DIR_REL}/解体新書.md`,
    label: "解体新書（LLM 向け）",
    format: "md",
    focus: `**LLM がこのアプリを正確に改修するための設計書**。人間向け README とは別物。
含めること:
- **目的・解く課題**（1 段落）— アプリ表示名 **{{appName}}** を明記
- **設計思想・トレードオフ**（なぜこの構成か）
- **ディレクトリと責務**（各フォルダ / 主要ファイルの役割）
- **データの流れ**（入力 → 処理 → 出力）
- **拡張時のルール**（触ってよい層 / 触らない層、命名・バージョン方針）
- **既知の制約・技術的負債**（推測は「要確認」）
- **用語集**（ドメイン用語）
文体: 箇条書き中心・短い見出し・LLM がコンテキストとして再利用しやすい密度。`,
  },
};

function buildDocPortalInstructions(ctx = {}) {
  const ver = ctx.version || "0.1.0";
  const name = ctx.appName || "このアプリ";
  const outPath = `${DOCS_DIR_REL}/ドキュメント統括.html`;
  const files = Array.isArray(ctx.docsFiles) ? ctx.docsFiles : [];
  const fileLines = files.length
    ? files.map((f) => `- \`${DOCS_DIR_REL}/${f}\``).join("\n")
    : "- （まだなし — 他プロンプトで生成後に再実行推奨）";
  return `## AI への指示（ドキュメント統括 HTML）

${buildWorkspaceContextBlock(ctx)}

**生成・更新するファイルは 1 つだけ**: \`${outPath}\`

**目的**: \`${DOCS_DIR_REL}/\` 内の **すべての .md と .html** を、**1 つの HTML** にまとめ、**タブ切替**で閲覧できるポータルにする。

**統合対象**（現時点でフォルダ内にあるファイル — 内容を読み取り統合）:
${fileLines}

**UI 要件**:
- 先頭にアプリ名 **${name}** とバージョン ${ver}
- 左または上に **タブ**（ファイル名ベース。例: README / 仕様書 / 手順書…）
- 各タブで対応ファイルの内容を表示
  - \`.md\` → HTML に変換して埋め込み（見出し・リスト・コードブロック）
  - \`.html\` → \`iframe\` の \`srcdoc\` またはサニタイズした HTML 断片として埋め込み（同一ファイル内に複数ページ構成でも可）
- \`${outPath}\` 自身はタブ一覧に含めない（無限ネスト防止）
- スタイルはインライン CSS。外部 CDN 不要
- 将来アプリの「ヘルプ」ボタンから \`${outPath}\` を開く想定

${buildFileOutputFormatBlock()}
- **触るファイル**: \`${outPath}\` のみ（元の md/html は改変しない）
${buildSecurityCautionLine()}`;
}

/**
 * 単一ドキュメント生成用の xLLM 指示
 * @param {keyof SINGLE_DOC_SPECS} docKey
 * @param {object} [ctx]
 */
function buildSingleDocInstructions(docKey, ctx = {}) {
  const spec = SINGLE_DOC_SPECS[docKey];
  if (!spec) return buildGeneralInstructions(ctx);
  const ver = ctx.version || "0.1.0";
  const name = ctx.appName || "このアプリ";
  const focus = String(spec.focus || "").replace(/\{\{appName\}\}/g, name);
  const formatNote =
    spec.format === "html"
      ? `- 出力形式: **HTML 1 ファイル**（\`### FILE:\` のフェンスは \`html\`）
- 外部 API / CDN 必須にしない。可能ならインライン CSS`
      : `- コード変更が不要なら Markdown だけ返す`;
  return `## AI への指示（${spec.label} 生成 — ${name}）

${buildWorkspaceContextBlock(ctx)}

**方針**: 簡潔・実務向け。推測は「要確認」と明記。

**生成・更新するファイルは 1 つだけ**: \`${spec.path}\`

**内容の焦点**:
${focus}

${buildFileOutputFormatBlock()}
- **触るファイル**: \`${spec.path}\` のみ（他ファイルは出力しない）
- アプリ表示名: **${name}** / バージョン: ${ver}
${formatNote}
${buildSecurityCautionLine()}
- 秘密情報は出力しない。`;
}

function resolveInstructionsForMode(mode, workspaceRoot) {
  const m = normalizeExportMode(mode);
  if (m === EXPORT_MODES.ERROR) {
    return require("./xllmErrorCapture").buildErrorDiagnosisInstructions();
  }
  const ctx = readWorkspaceVersionContext(workspaceRoot);
  if (m === EXPORT_MODES.DOCS) {
    return buildDocsBundleInstructions(ctx);
  }
  return buildGeneralInstructions(ctx);
}

module.exports = {
  EXPORT_MODES,
  SCHEMA_BY_MODE,
  DOCS_DIR_REL,
  normalizeExportMode,
  getSchemaForMode,
  getModeLabel,
  readWorkspaceVersionContext,
  listDocsFolderFiles,
  buildWorkspaceContextBlock,
  buildGeneralInstructions,
  buildDocsBundleInstructions,
  buildSingleDocInstructions,
  buildDocPortalInstructions,
  SINGLE_DOC_SPECS,
  buildSingleResponseRule,
  resolveInstructionsForMode,
};
