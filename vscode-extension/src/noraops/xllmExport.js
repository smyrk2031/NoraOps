/**
 * xLLM — 外部 AI チャット向けマルチファイルプロンプト生成
 */

const fs = require("fs");
const path = require("path");
const { classifyForSave, collectFiles } = require("./workspaceZip");
const { resolveScaffoldRoot } = require("./scaffold");

/** ワークスペース全体モードのみ追加除外（手動ピックでは .env 等も選べる） */
const XLLM_ALL_SCOPE_EXTRA_DIRS = new Set([
  ".vscode",
  ".cursor",
  ".idea",
  ".vs",
  ".history",
  "dist",
  "build",
  "coverage",
  ".tox",
  ".eggs",
  ".mypy_cache",
  ".ruff_cache",
  ".pytest_cache",
]);

const XLLM_ALL_SCOPE_EXTRA_FILE_NAMES = new Set([
  ".editorconfig",
  "Thumbs.db",
  "desktop.ini",
  ".DS_Store",
]);

function classifyForXllmAllScope(relPath, isDir) {
  const base = classifyForSave(relPath, isDir);
  if (!base.included) return base;
  const norm = String(relPath).replace(/\\/g, "/");
  const parts = norm.split("/").filter(Boolean);
  for (const p of parts) {
    if (XLLM_ALL_SCOPE_EXTRA_DIRS.has(p)) {
      return { included: false, reason: `開発環境フォルダ「${p}」` };
    }
  }
  if (!isDir) {
    const name = parts[parts.length - 1] || norm;
    if (XLLM_ALL_SCOPE_EXTRA_FILE_NAMES.has(name) || name.endsWith(".pyc")) {
      return { included: false, reason: "開発環境ファイル" };
    }
  }
  return { included: true, reason: null };
}

function collectFilesForXllmAllScope(root) {
  const files = [];
  function walk(dir, relBase) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const rel = relBase ? `${relBase}/${ent.name}` : ent.name;
      const norm = rel.replace(/\\/g, "/");
      const cls = classifyForXllmAllScope(norm, ent.isDirectory());
      if (!cls.included) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full, norm);
      else files.push({ rel: norm, full });
    }
  }
  walk(root, "");
  return files;
}

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
const { normalizeCompressMode, compressFileContent } = require("./xllmCompress");
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
    for (const f of collectFilesForXllmAllScope(root)) {
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
        // ユーザーが明示選択したファイルは .env 等も含める（全体モードのみ自動除外）
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
 * @param {{ workspaceRoot: string, userRequest: string, scope: object, mode?: string, promptKey?: string, errorLog?: string }} opts
 */
function buildExportMarkdown(opts) {
  const { workspaceRoot, userRequest, scope } = opts;
  const { legacyModeToPromptKey, resolvePromptBody, isErrorPromptKey, isDocsStylePromptKey } =
    require("./promptResolve");

  let promptKey = opts.promptKey || legacyModeToPromptKey(opts.mode);
  let instructions;
  let mode;
  let promptTitle;

  if (opts.promptKey || opts.mode) {
    const { resolvePromptForExport } = require("./creatorPrompts");
    const resolved = resolvePromptForExport(workspaceRoot, promptKey);
    if (resolved.ok) {
      instructions = resolved.body;
      mode = resolved.legacyMode || (resolved.isError ? "error" : resolved.isDocsStyle ? "docs" : "general");
      promptTitle = resolved.title;
      promptKey = resolved.key;
    } else {
      mode = normalizeExportMode(opts.mode);
      instructions = resolveInstructionsForMode(mode, workspaceRoot);
      promptKey = legacyModeToPromptKey(mode);
    }
  } else {
    mode = normalizeExportMode(opts.mode);
    promptKey = legacyModeToPromptKey(mode);
    instructions = resolveInstructionsForMode(mode, workspaceRoot);
  }

  mode = normalizeExportMode(mode);
  const isError = isErrorPromptKey(promptKey) || mode === EXPORT_MODES.ERROR;
  const isDocsStyle = isDocsStylePromptKey(promptKey) || mode === EXPORT_MODES.DOCS;
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
    isError ? extractErrorSnippet(opts.errorLog || "") : "";
  const versionCtx = readWorkspaceVersionContext(workspaceRoot);

  let total = 0;
  const schema = getSchemaForMode(mode);
  const parts = [
    `# NoraOps xLLM エクスポート`,
    ``,
    `- schema: ${schema}`,
    `- mode: ${mode}`,
    `- prompt: ${promptKey}${promptTitle ? ` (${promptTitle})` : ""}`,
    `- workspace: ${path.basename(root)}`,
    `- app: ${versionCtx.appName}`,
    `- version: ${versionCtx.version}`,
    `- files: ${files.length}`,
    ``,
    instructions,
    ``,
  ];

  if (isError) {
    parts.push(`## 実行時エラー（ログ）`, ``);
    parts.push(
      errorSnippet
        ? "```\n" + errorSnippet + "\n```"
        : "（エラーログ未入力 — ターミナルやログから取得して再生成してください）"
    );
    parts.push(``);
    parts.push(`## 補足（任意）`, ``, String(userRequest || "").trim() || "（なし）", ``);
  } else if (isDocsStyle) {
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

  const compressMode = normalizeCompressMode(opts.compressMode);
  if (compressMode !== "none") {
    parts.push(
      `> 圧縮モード: \`${compressMode}\`（構造優先の省略あり。精度が落ちる場合は「なし」で再生成）`,
      ``
    );
  }

  for (const f of files) {
    const fence = f.lang || "";
    const body =
      compressMode === "none" ? f.content : compressFileContent(f.content, f.rel, compressMode);
    const block = `### FILE: ${f.rel}\n\`\`\`${fence}\n${body}\n\`\`\`\n`;
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
  const sourceCharCount = files.reduce((n, f) => n + (f.content?.length || 0), 0);
  return {
    ok: true,
    markdown,
    fileCount: files.length,
    charCount: markdown.length,
    sourceCharCount,
    compressMode,
    tokenEstimate,
    skipped,
    rootLabel: path.basename(root),
    mode,
    promptKey,
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
