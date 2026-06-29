/**
 * xLLM — AI 返答 Markdown の解析とワークスペースへの適用
 */

const fs = require("fs");
const path = require("path");
const { resolveScaffoldRoot } = require("./scaffold");
const { createSnapshot } = require("./xllmHistory");
const { buildLineDiff, summarizeDiff } = require("./xllmDiff");

/**
 * @param {string} markdown
 * @returns {{ path: string, content: string, lang: string }[]}
 */
function parseFileBlocks(markdown) {
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
    });
  }
  return blocks;
}

function normalizeRelPath(raw) {
  let p = String(raw || "").trim().replace(/\\/g, "/");
  p = p.replace(/^['"`]+|['"`]+$/g, "");
  p = p.replace(/^\.\/+/, "");
  if (!p || p.includes("..") || path.isAbsolute(p)) return "";
  return p;
}

function extractFencedCode(body) {
  const m = body.match(/```([a-zA-Z0-9+#.-]*)\s*\r?\n([\s\S]*?)```/);
  if (m) {
    return { lang: (m[1] || "").trim(), content: m[2].replace(/\s+$/, "") };
  }
  return { lang: "", content: body.replace(/\s+$/, "") };
}

function readCurrentFile(root, rel) {
  const full = path.join(root, rel);
  try {
    if (!fs.existsSync(full)) return { exists: false, content: "" };
    const buf = fs.readFileSync(full);
    if (buf.includes(0)) return { exists: true, binary: true, content: "" };
    return { exists: true, content: buf.toString("utf8") };
  } catch {
    return { exists: false, content: "" };
  }
}

/**
 * @returns {{ path: string, status: 'new'|'modified'|'unchanged', newContent: string, currentContent: string }[]}
 */
function planApply(workspaceRoot, markdown) {
  const root = path.resolve(resolveScaffoldRoot(workspaceRoot));
  const blocks = parseFileBlocks(markdown);
  const plan = [];
  for (const b of blocks) {
    const cur = readCurrentFile(root, b.path);
    let status = "new";
    if (cur.exists) {
      status = cur.content === b.content ? "unchanged" : "modified";
    }
    plan.push({
      path: b.path,
      status,
      newContent: b.content,
      currentContent: cur.content || "",
      binary: !!cur.binary,
      diffSummary:
        status === "unchanged"
          ? { add: 0, del: 0, same: (cur.content || "").split(/\r?\n/).length }
          : summarizeDiff(buildLineDiff(cur.content || "", b.content)),
    });
  }
  return { root, plan, parseCount: blocks.length };
}

/**
 * @param {string} workspaceRoot
 * @param {{ path: string, newContent: string, currentContent: string, status: string }[]} items
 * @param {{ label?: string }} meta
 */
function applyItems(workspaceRoot, items, meta = {}) {
  const root = path.resolve(resolveScaffoldRoot(workspaceRoot));
  const applicable = items.filter((i) => i.status !== "unchanged");
  const snapshot = createSnapshot(workspaceRoot, applicable, {
    label: meta.label || `適用 ${applicable.length} ファイル`,
  });
  const applied = [];
  const errors = [];

  for (const item of applicable) {
    const full = path.join(root, item.path);
    try {
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, item.newContent, "utf8");
      applied.push(item.path);
    } catch (e) {
      errors.push({ path: item.path, message: e.message || String(e) });
    }
  }

  return {
    applied,
    errors,
    snapshotId: snapshot?.id || null,
    snapshotLabel: snapshot?.label || null,
  };
}

function summarizePlan(plan) {
  const counts = { new: 0, modified: 0, unchanged: 0 };
  for (const p of plan) {
    if (counts[p.status] !== undefined) counts[p.status] += 1;
  }
  return counts;
}

module.exports = {
  parseFileBlocks,
  planApply,
  applyItems,
  summarizePlan,
  normalizeRelPath,
};
