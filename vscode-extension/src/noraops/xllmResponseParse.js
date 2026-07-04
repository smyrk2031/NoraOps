/**
 * xLLM — AI 返答のゆるい解析（Gemini / ChatGPT 等の見出しパターン）
 */

const path = require("path");

const CHUNK_SEP = "\n\n--- xLLM 取り込み ---\n\n";

function normalizeRelPath(raw) {
  let p = String(raw || "").trim().replace(/\\/g, "/");
  p = p.replace(/^['"`]+|['"`]+$/g, "");
  p = p.replace(/^\.\/+/, "");
  if (!p || p.includes("..") || path.isAbsolute(p)) return "";
  return p;
}

/**
 * @param {string} markdown
 * @returns {{ path: string, content: string, lang: string, source: 'strict'|'loose' }[]}
 */
function parseStrictFileBlocks(markdown) {
  const text = String(markdown || "");
  const blocks = [];
  const parts = text.split(/\n(?=###\s+FILE:)/i);
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const lines = trimmed.split(/\r?\n/);
    const head = lines[0] || "";
    const m = head.match(/^###\s+FILE:\s*(.+)\s*$/i);
    if (!m) continue;
    const rel = normalizeRelPath(m[1]);
    if (!rel) continue;
    const body = lines.slice(1).join("\n").trim();
    const fenced = extractFencedCode(body);
    blocks.push({
      path: rel,
      content: fenced.content,
      lang: fenced.lang,
      source: "strict",
    });
  }
  return blocks;
}

function extractFencedCode(body) {
  const m = String(body || "").match(/```([a-zA-Z0-9+#.:\/_-]*)\s*\r?\n([\s\S]*?)```/);
  if (m) {
    return { lang: (m[1] || "").trim(), content: m[2].replace(/\s+$/, "") };
  }
  return { lang: "", content: String(body || "").replace(/\s+$/, "") };
}

function looksLikeFilePath(raw) {
  const p = normalizeRelPath(raw);
  if (!p) return "";
  if (p.includes("/")) return p;
  if (/\.[a-z0-9]{1,8}$/i.test(p)) return p;
  return "";
}

function pathFromFenceInfo(info) {
  const t = String(info || "").trim();
  if (!t) return "";
  const colon = t.match(/^[a-z0-9+#.-]+:(.+)$/i);
  if (colon) return looksLikeFilePath(colon[1]);
  if (!t.includes(" ") && /\.[a-z0-9]{1,8}$/i.test(t)) return looksLikeFilePath(t);
  return "";
}

function pathFromContextLine(line) {
  const t = String(line || "").trim();
  if (!t || t.length > 200) return "";

  let m = t.match(/^#+\s*FILE:\s*(.+)$/i);
  if (m) return looksLikeFilePath(m[1]);

  m = t.match(/^\*\*(.+?)\*\*\s*$/);
  if (m) return looksLikeFilePath(m[1]);

  m = t.match(/^(?:file|ファイル|path|パス)\s*[:：]\s*(.+)$/i);
  if (m) return looksLikeFilePath(m[1]);

  m = t.match(/^[`"']([^`"']+)[`"']\s*$/);
  if (m) return looksLikeFilePath(m[1]);

  m = t.match(/^[`"']?([\w./-]+\.[a-z0-9]{1,8})[`"']?\s*[:：]?\s*$/i);
  if (m) return looksLikeFilePath(m[1]);

  m = t.match(/^#+\s+([\w./-]+\.[a-z0-9]{1,8})\s*$/i);
  if (m) return looksLikeFilePath(m[1]);

  m = t.match(/^(?:\/\/|#)\s*([\w./-]+\.[a-z0-9]{1,8})\s*$/i);
  if (m) return looksLikeFilePath(m[1]);

  m = t.match(/^[-*]\s+[`"']?([\w./-]+\.[a-z0-9]{1,8})[`"']?\s*$/i);
  if (m) return looksLikeFilePath(m[1]);

  return "";
}

function contextLinesBefore(text, index, maxLines = 6) {
  const head = text.slice(0, index);
  const lines = head.split(/\r?\n/);
  const out = [];
  for (let i = lines.length - 1; i >= 0 && out.length < maxLines; i--) {
    const line = lines[i];
    if (!line.trim() && out.length) break;
    if (line.trim()) out.unshift(line);
  }
  return out;
}

/**
 * コードフェンス直前の見出しからパスを推定（パス不明のフェンスは無視）
 */
function parseLooseFencedBlocks(markdown) {
  const text = String(markdown || "");
  const blocks = [];
  const re = /```([^\n`]*)\r?\n([\s\S]*?)```/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    const info = match[1] || "";
    const content = match[2].replace(/\s+$/, "");
    if (!content.trim()) continue;

    let rel = pathFromFenceInfo(info);
    if (!rel) {
      const ctx = contextLinesBefore(text, match.index);
      for (let i = ctx.length - 1; i >= 0; i--) {
        rel = pathFromContextLine(ctx[i]);
        if (rel) break;
      }
    }
    if (!rel) continue;

    blocks.push({
      path: rel,
      content,
      lang: info.split(":")[0].trim(),
      source: "loose",
    });
  }
  return blocks;
}

function mergeBlocks(strict, loose) {
  const byPath = new Map();
  for (const b of loose) byPath.set(b.path, b);
  for (const b of strict) byPath.set(b.path, b);
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * @param {string} markdown
 * @returns {{ blocks: object[], meta: { strictCount: number, looseCount: number, fenceSkipped: number } }}
 */
function parseResponseBlocks(markdown) {
  const strict = parseStrictFileBlocks(markdown);
  const loose = parseLooseFencedBlocks(markdown);
  const fenceMatches = String(markdown || "").match(/```/g);
  const fenceCount = fenceMatches ? Math.floor(fenceMatches.length / 2) : 0;
  const blocks = mergeBlocks(strict, loose);
  const looseOnly = blocks.filter((b) => b.source === "loose").length;
  return {
    blocks,
    meta: {
      strictCount: strict.length,
      looseCount: loose.length,
      mergedCount: blocks.length,
      looseOnlyCount: strict.length ? blocks.length - strict.length : looseOnly,
      fenceCount,
      fenceSkipped: Math.max(0, fenceCount - loose.length),
    },
  };
}

function appendResponseChunk(existing, chunk) {
  const prev = String(existing || "").trimEnd();
  const next = String(chunk || "").trim();
  if (!next) return prev;
  if (!prev) return next;
  return prev + CHUNK_SEP + next;
}

module.exports = {
  CHUNK_SEP,
  parseStrictFileBlocks,
  parseLooseFencedBlocks,
  parseResponseBlocks,
  appendResponseChunk,
  pathFromContextLine,
  pathFromFenceInfo,
};
