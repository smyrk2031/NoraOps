/**
 * Creator メモ帳（ワークスペース単位）
 */

const crypto = require("crypto");
const { readWorkspaceRecord, writeWorkspaceRecord } = require("./workspaceStore");

const MEMO_SCHEMA = "nora.creator-memos/1";

function newMemoId() {
  return crypto.randomBytes(8).toString("hex");
}

function normalizeMemos(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m) => m && typeof m === "object" && String(m.title || "").trim())
    .map((m, i) => ({
      id: String(m.id || newMemoId()),
      title: String(m.title || "").trim().slice(0, 200),
      body: String(m.body || ""),
      order: Number.isFinite(m.order) ? m.order : i,
      createdAt: m.createdAt || new Date().toISOString(),
      updatedAt: m.updatedAt || m.createdAt || new Date().toISOString(),
    }))
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
}

function listMemos(workspaceRoot) {
  const record = readWorkspaceRecord(workspaceRoot);
  return normalizeMemos(record?.creatorMemos);
}

function saveMemos(workspaceRoot, memos) {
  const normalized = normalizeMemos(memos);
  writeWorkspaceRecord(workspaceRoot, { creatorMemos: normalized, creatorMemosSchema: MEMO_SCHEMA });
  return normalized;
}

function addMemo(workspaceRoot, { title, body }) {
  const memos = listMemos(workspaceRoot);
  const now = new Date().toISOString();
  const maxOrder = memos.reduce((m, x) => Math.max(m, x.order), -1);
  const row = {
    id: newMemoId(),
    title: String(title || "無題").trim().slice(0, 200) || "無題",
    body: String(body || ""),
    order: maxOrder + 1,
    createdAt: now,
    updatedAt: now,
  };
  memos.push(row);
  return { memos: saveMemos(workspaceRoot, memos), memo: row };
}

function updateMemo(workspaceRoot, id, patch) {
  const memos = listMemos(workspaceRoot);
  const idx = memos.findIndex((m) => m.id === id);
  if (idx < 0) return null;
  const now = new Date().toISOString();
  memos[idx] = {
    ...memos[idx],
    ...patch,
    id: memos[idx].id,
    title: String(patch.title != null ? patch.title : memos[idx].title).trim().slice(0, 200),
    body: patch.body != null ? String(patch.body) : memos[idx].body,
    updatedAt: now,
  };
  return { memos: saveMemos(workspaceRoot, memos), memo: memos[idx] };
}

function deleteMemo(workspaceRoot, id) {
  const memos = listMemos(workspaceRoot).filter((m) => m.id !== id);
  return saveMemos(workspaceRoot, memos);
}

function reorderMemo(workspaceRoot, id, direction) {
  const memos = listMemos(workspaceRoot);
  const idx = memos.findIndex((m) => m.id === id);
  if (idx < 0) return memos;
  const swap = direction === "up" ? idx - 1 : idx + 1;
  if (swap < 0 || swap >= memos.length) return memos;
  const a = memos[idx];
  const b = memos[swap];
  const oa = a.order;
  a.order = b.order;
  b.order = oa;
  [memos[idx], memos[swap]] = [memos[swap], memos[idx]];
  return saveMemos(workspaceRoot, memos);
}

module.exports = {
  MEMO_SCHEMA,
  listMemos,
  saveMemos,
  addMemo,
  updateMemo,
  deleteMemo,
  reorderMemo,
};
