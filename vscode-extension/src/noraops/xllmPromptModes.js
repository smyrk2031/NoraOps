/**
 * xLLM — エクスポートモード別プロンプト（短く・実用寄り）
 */

const path = require("path");
const { resolveScaffoldRoot } = require("./scaffold");

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
  const root = resolveScaffoldRoot(workspaceRoot);
  const { readNoraManifest } = require("./appEntry");
  const { readVersion } = require("./versionUtil");
  const man = readNoraManifest(root);
  const pyVer = readVersion(root);
  const manifestVer = man?.version ? String(man.version) : null;
  const appName = man?.label || man?.name || path.basename(root);
  return {
    version: manifestVer || pyVer || "0.1.0",
    pyVersion: pyVer,
    manifestVersion: manifestVer,
    appName,
  };
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
  return `## AI への指示（通常モード）

**方針**: シンプル・実用。説明は短く。余計な装飾や長文は避ける。

- 複数ファイル構成。各ファイルは \`### FILE: 相対パス\` で区切られています。
${buildFileOutputFormatBlock()}
- **バージョン**（現在 ${ver}）: 利用者に見える変更時は **SemVer** で更新。
  - 破壊的変更 → major / 機能追加 → minor / バグ修正・文言 → patch
  - \`nora/manifest.json\` の \`version\` と \`pyproject.toml\` の \`version\` を揃える
  - \`docs/CHANGELOG.md\` に1行追記（なければ作成）。例: \`- 0.2.1: ログイン画面のバリデーション追加\`
- **GUI アプリ**: タイトルバー等にバージョンが自然に見える配置（例: \`アプリ名 v${ver}\`）
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
  normalizeExportMode,
  getSchemaForMode,
  getModeLabel,
  readWorkspaceVersionContext,
  buildGeneralInstructions,
  buildDocsBundleInstructions,
  buildSingleResponseRule,
  resolveInstructionsForMode,
};
