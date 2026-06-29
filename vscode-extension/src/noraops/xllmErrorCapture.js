/**
 * xLLM — エラーログの取り込み・整形
 */

const fs = require("fs");
const path = require("path");
const { resolveScaffoldRoot } = require("./scaffold");

const ERROR_MARKERS = [
  /traceback \(most recent call last\)/i,
  /^error:/im,
  /^exception:/im,
  /syntaxerror:/i,
  /typeerror:/i,
  /valueerror:/i,
  /modulenotfounderror:/i,
  /attributeerror:/i,
  /indentationerror:/i,
  /file ".*", line \d+/i,
  /errno /i,
];

/**
 * 長いログからエラーっぽい部分を抽出（末尾優先）
 * @param {string} raw
 * @param {number} maxChars
 */
function extractErrorSnippet(raw, maxChars = 12_000) {
  const text = String(raw || "").trim();
  if (!text) return "";
  if (text.length <= maxChars) return text;

  const lines = text.split(/\r?\n/);
  let start = Math.max(0, lines.length - 80);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (ERROR_MARKERS.some((re) => re.test(line))) {
      start = Math.max(0, i - 3);
      break;
    }
  }
  let snippet = lines.slice(start).join("\n");
  if (snippet.length > maxChars) {
    snippet = "…\n" + snippet.slice(-maxChars);
  }
  return snippet.trim();
}

/**
 * ワークスペースの logs/log.txt 末尾（あれば）
 */
function readWorkspaceLogTail(workspaceRoot, maxBytes = 48_000) {
  if (!workspaceRoot) return "";
  const root = resolveScaffoldRoot(workspaceRoot);
  const candidates = [
    path.join(root, "logs", "log.txt"),
    path.join(root, "nora", "dev", "logs", "log.txt"),
  ];
  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const buf = fs.readFileSync(p);
      if (buf.length <= maxBytes) return buf.toString("utf8");
      return buf.slice(-maxBytes).toString("utf8");
    } catch {
      /* ignore */
    }
  }
  return "";
}

function buildErrorDiagnosisInstructions() {
  const { buildSingleResponseRule } = require("./xllmPromptModes");
  return `## AI への指示（エラー調査モード）

- 以下は **実行時エラー** と **プロジェクトの複数ファイル** です。
- **やること**: エラーの原因となりそうな箇所を特定し、修正案を提示してください。
${buildSingleResponseRule()}
- 変更提案は **次の形式のみ** で返してください:

\`\`\`markdown
### ANALYSIS:
（原因の説明を短く。どのファイルのどのあたりか）

### FILE: path/to/file.py
\`\`\`python
（修正後の全文）
\`\`\`
\`\`\`

- 原因が不明なときは \`### QUESTION:\` で質問してください。
- 触らないファイルは出力しないでください。`;
}

module.exports = {
  extractErrorSnippet,
  readWorkspaceLogTail,
  buildErrorDiagnosisInstructions,
};
