/**
 * xLLM — 外部 AI チャット向けマルチファイルプロンプト生成
 */

const fs = require("fs");
const path = require("path");
const { classifyForSave, collectFiles } = require("./workspaceZip");
const { resolveScaffoldRoot } = require("./scaffold");

const SCHEMA = "nora.xllm-export/1";
const ERROR_SCHEMA = "nora.xllm-export-error/1";
const DOCS_SCHEMA = "nora.xllm-export-docs/1";
const {
  EXPORT_MODES,
  normalizeExportMode,
  getSchemaForMode,
  getModeLabel,
  readWorkspaceVersionContext,
  buildGeneralInstructions,
  resolveInstructionsForMode,
} = require("./xllmPromptModes");
const MAX_FILES = 80;
const MAX_FILE_CHARS = 120_000;
const MAX_TOTAL_CHARS = 480_000;

const BINARY_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".zip",
  ".exe",
  ".dll",
  ".pyc",
  ".woff",
  ".woff2",
  ".pdf",
  ".db",
  ".sqlite",
]);

const LANG_BY_EXT = {
  ".py": "python",
  ".js": "javascript",
  ".ts": "typescript",
  ".json": "json",
  ".md": "markdown",
  ".html": "html",
  ".css": "css",
  ".toml": "toml",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".sql": "sql",
  ".sh": "shell",
  ".ps1": "powershell",
  ".xml": "xml",
};

function guessLang(relPath) {
  const ext = path.extname(relPath).toLowerCase();
  return LANG_BY_EXT[ext] || "";
}

function isTextCandidate(relPath) {
  const ext = path.extname(relPath).toLowerCase();
  if (BINARY_EXT.has(ext)) return false;
  return true;
}

function readTextFile(fullPath, relPath) {
  if (!isTextCandidate(relPath)) {
    return { ok: false, reason: "バイナリ拡張子のためスキップ" };
  }
  let buf;
  try {
    const st = fs.statSync(fullPath);
    if (st.size > 2_000_000) {
      return { ok: false, reason: "ファイルが大きすぎます（2MB 超）" };
    }
    buf = fs.readFileSync(fullPath);
  } catch (e) {
    return { ok: false, reason: e.message || "読取失敗" };
  }
  if (buf.includes(0)) {
    return { ok: false, reason: "バイナリ内容のためスキップ" };
  }
  let text = buf.toString("utf8");
  if (text.length > MAX_FILE_CHARS) {
    text = `${text.slice(0, MAX_FILE_CHARS)}\n\n…（${MAX_FILE_CHARS} 文字で切り詰め）`;
  }
  return { ok: true, content: text };
}

/**
 * @param {string} workspaceRoot
 * @param {{ mode: 'all' } | { mode: 'pick', relPaths: string[] }} scope
 */
function collectExportFileEntries(workspaceRoot, scope) {
  const root = path.resolve(resolveScaffoldRoot(workspaceRoot));
  const relSet = new Set();
  const skipped = [];

  if (scope.mode === "all") {
    for (const f of collectFiles(root)) {
      relSet.add(f.rel);
    }
  } else {
    for (const raw of scope.relPaths || []) {
      const rel = String(raw || "").replace(/\\/g, "/").replace(/^\/+/, "");
      if (!rel) continue;
      const full = path.join(root, rel);
      let st;
      try {
        st = fs.statSync(full);
      } catch {
        skipped.push({ rel, reason: "パスが見つかりません" });
        continue;
      }
      if (st.isDirectory()) {
        const prefix = rel.endsWith("/") ? rel : `${rel}/`;
        const clsDir = classifyForSave(rel, true);
        if (!clsDir.included) {
          skipped.push({ rel, reason: clsDir.reason || "除外フォルダ" });
          continue;
        }
        function walk(dir, relBase) {
          let entries;
          try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
          } catch {
            return;
          }
          for (const ent of entries) {
            const r = relBase ? `${relBase}/${ent.name}` : ent.name;
            const norm = r.replace(/\\/g, "/");
            const cls = classifyForSave(norm, ent.isDirectory());
            if (!cls.included) {
              if (ent.isDirectory()) skipped.push({ rel: norm, reason: cls.reason || "除外" });
              continue;
            }
            const f = path.join(dir, ent.name);
            if (ent.isDirectory()) walk(f, r);
            else relSet.add(norm);
          }
        }
        walk(full, rel.replace(/\/$/, ""));
      } else {
        const cls = classifyForSave(rel, false);
        if (!cls.included) {
          skipped.push({ rel, reason: cls.reason || "除外ファイル" });
          continue;
        }
        relSet.add(rel);
      }
    }
  }

  const files = [];
  for (const rel of [...relSet].sort((a, b) => a.localeCompare(b))) {
    if (files.length >= MAX_FILES) {
      skipped.push({ rel: "…", reason: `ファイル数上限（${MAX_FILES}）` });
      break;
    }
    const full = path.join(root, rel);
    const read = readTextFile(full, rel);
    if (!read.ok) {
      skipped.push({ rel, reason: read.reason });
      continue;
    }
    files.push({ rel, content: read.content, lang: guessLang(rel) });
  }

  return { root, files, skipped };
}

function buildAiInstructions(workspaceRoot) {
  const ctx = workspaceRoot ? readWorkspaceVersionContext(workspaceRoot) : {};
  return buildGeneralInstructions(ctx);
}

/**
 * 外部 AI 向けプロンプトのトークン数 **目安**（モデルにより実際は異なります）
 * @param {string} text
 */
function estimateTokensForPrompt(text) {
  const s = String(text || "");
  let cjk = 0;
  let other = 0;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (
      (code >= 0x3040 && code <= 0x30ff) ||
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0xff00 && code <= 0xffef)
    ) {
      cjk++;
    } else {
      other++;
    }
  }
  return Math.max(1, Math.ceil(cjk / 1.6 + other / 4));
}

/**
 * @param {{ workspaceRoot: string, userRequest: string, scope: object, mode?: string, errorLog?: string }} opts
 */
function buildExportMarkdown(opts) {
  const mode = normalizeExportMode(opts.mode);
  const { workspaceRoot, userRequest, scope } = opts;
  const { root, files, skipped } = collectExportFileEntries(workspaceRoot, scope);
  if (!files.length) {
    return {
      ok: false,
      reason: "no_files",
      message: "エクスポート対象のテキストファイルがありません。",
      skipped,
    };
  }

  const {
    extractErrorSnippet,
  } = require("./xllmErrorCapture");
  const errorSnippet =
    mode === EXPORT_MODES.ERROR ? extractErrorSnippet(opts.errorLog || "") : "";
  const versionCtx = readWorkspaceVersionContext(workspaceRoot);

  let total = 0;
  const schema = getSchemaForMode(mode);
  const parts = [
    `# NoraOps xLLM エクスポート`,
    ``,
    `- schema: ${schema}`,
    `- mode: ${mode}`,
    `- workspace: ${path.basename(root)}`,
    `- app: ${versionCtx.appName}`,
    `- version: ${versionCtx.version}`,
    `- files: ${files.length}`,
    ``,
    resolveInstructionsForMode(mode, workspaceRoot),
    ``,
  ];

  if (mode === EXPORT_MODES.ERROR) {
    parts.push(`## 実行時エラー（ログ）`, ``);
    parts.push(
      errorSnippet
        ? "```\n" + errorSnippet + "\n```"
        : "（エラーログ未入力 — ターミナルやログから取得して再生成してください）"
    );
    parts.push(``);
    parts.push(`## 補足（任意）`, ``, String(userRequest || "").trim() || "（なし）", ``);
  } else if (mode === EXPORT_MODES.DOCS) {
    parts.push(`## 追記する背景・業務内容（任意）`, ``);
    parts.push(
      String(userRequest || "").trim() ||
        "（未入力 — ソースコードから読み取れる範囲で docs/ 一式を作成してください）",
      ``
    );
  } else {
    parts.push(`## ユーザーの依頼`, ``);
    parts.push(
      String(userRequest || "").trim() || "（依頼文未入力 — 上記ファイルを読んだうえで改善提案をください）",
      ``
    );
  }

  const { buildCheckNoticeForPrompt } = require("./xllmPolicyNotice");
  const checkNotice = buildCheckNoticeForPrompt(opts.checkSummary);
  if (checkNotice.text) {
    parts.push(checkNotice.text, ``);
  }

  parts.push(`## プロジェクトファイル`, ``);

  for (const f of files) {
    const fence = f.lang || "";
    const block = `### FILE: ${f.rel}\n\`\`\`${fence}\n${f.content}\n\`\`\`\n`;
    total += block.length;
    if (total > MAX_TOTAL_CHARS) {
      skipped.push({ rel: f.rel, reason: `合計 ${MAX_TOTAL_CHARS} 文字上限のためここで打切` });
      break;
    }
    parts.push(block);
  }

  if (skipped.length) {
    parts.push(`## スキップした項目`, ``);
    for (const s of skipped.slice(0, 30)) {
      parts.push(`- \`${s.rel}\`: ${s.reason}`);
    }
    parts.push(``);
  }

  const markdown = parts.join("\n");
  const tokenEstimate = estimateTokensForPrompt(markdown);
  return {
    ok: true,
    markdown,
    fileCount: files.length,
    charCount: markdown.length,
    tokenEstimate,
    skipped,
    rootLabel: path.basename(root),
    mode,
    checkNotice,
  };
}

module.exports = {
  SCHEMA,
  ERROR_SCHEMA,
  DOCS_SCHEMA,
  EXPORT_MODES,
  MAX_FILES,
  MAX_FILE_CHARS,
  MAX_TOTAL_CHARS,
  buildAiInstructions,
  collectExportFileEntries,
  buildExportMarkdown,
  estimateTokensForPrompt,
  guessLang,
  normalizeExportMode,
  getModeLabel,
};
