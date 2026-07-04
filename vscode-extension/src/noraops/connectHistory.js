/**
 * Connect 実行履歴（ワークスペース単位）
 */

const crypto = require("crypto");
const { readWorkspaceRecord, writeWorkspaceRecord } = require("./workspaceStore");

const HISTORY_SCHEMA = "nora.connect-history/1";
const MAX_HISTORY = 50;
const MAX_BODY_PREVIEW = 12000;

function newHistoryId() {
  return crypto.randomBytes(6).toString("hex");
}

function trimPreview(text) {
  const s = String(text ?? "");
  if (s.length <= MAX_BODY_PREVIEW) return s;
  return s.slice(0, MAX_BODY_PREVIEW) + "\n…（履歴では省略）";
}

function normalizeEntry(raw) {
  if (!raw || typeof raw !== "object") return null;
  const profileId = String(raw.profileId || "").trim();
  if (!profileId) return null;
  const req = raw.request && typeof raw.request === "object" ? raw.request : {};
  const res = raw.result && typeof raw.result === "object" ? raw.result : {};
  const method = String(req.method || "GET").toUpperCase() === "POST" ? "POST" : "GET";
  const headers = Array.isArray(req.headers)
    ? req.headers
        .filter((h) => h && h.key)
        .map((h) => ({ key: String(h.key), value: String(h.value ?? "") }))
    : [];
  return {
    id: String(raw.id || newHistoryId()),
    profileId,
    profileName: String(raw.profileName || "").slice(0, 120),
    executedAt: raw.executedAt || new Date().toISOString(),
    request: {
      method,
      url: String(req.url || "").slice(0, 2000),
      headers,
      body: method === "POST" ? String(req.body ?? "") : "",
      contentType: String(req.contentType || "application/json"),
    },
    result: {
      ok: !!res.ok,
      status: Number(res.status) || 0,
      statusText: String(res.statusText || ""),
      durationMs: Number(res.durationMs) || 0,
      contentType: String(res.contentType || ""),
      bodySize: res.bodySize != null ? Number(res.bodySize) : null,
      isBinary: !!res.isBinary,
      suggestedFilename: res.suggestedFilename ? String(res.suggestedFilename) : null,
      truncated: !!res.truncated,
      error: res.error ? String(res.error) : null,
      bodyText: res.isBinary ? null : trimPreview(res.bodyText),
    },
  };
}

function listHistory(workspaceRoot, profileId) {
  const record = readWorkspaceRecord(workspaceRoot);
  const raw = record?.connectHistory;
  if (!Array.isArray(raw)) return [];
  const all = raw.map(normalizeEntry).filter(Boolean);
  all.sort((a, b) => String(b.executedAt).localeCompare(String(a.executedAt)));
  if (profileId) return all.filter((e) => e.profileId === profileId).slice(0, 10);
  return all.slice(0, MAX_HISTORY);
}

function saveHistory(workspaceRoot, entries) {
  const normalized = entries.map(normalizeEntry).filter(Boolean).slice(0, MAX_HISTORY);
  writeWorkspaceRecord(workspaceRoot, {
    connectHistory: normalized,
    connectHistorySchema: HISTORY_SCHEMA,
  });
  return normalized;
}

function appendHistory(workspaceRoot, entry) {
  const norm = normalizeEntry(entry);
  if (!norm) return [];
  const record = readWorkspaceRecord(workspaceRoot);
  const prev = Array.isArray(record?.connectHistory) ? record.connectHistory : [];
  const merged = [norm, ...prev.map(normalizeEntry).filter(Boolean)]
    .sort((a, b) => String(b.executedAt).localeCompare(String(a.executedAt)))
    .slice(0, MAX_HISTORY);
  return saveHistory(workspaceRoot, merged);
}

function clearHistory(workspaceRoot, profileId) {
  if (!profileId) {
    saveHistory(workspaceRoot, []);
    return [];
  }
  const record = readWorkspaceRecord(workspaceRoot);
  const prev = Array.isArray(record?.connectHistory) ? record.connectHistory : [];
  const next = prev.map(normalizeEntry).filter(Boolean).filter((e) => e.profileId !== profileId);
  return saveHistory(workspaceRoot, next);
}

module.exports = {
  HISTORY_SCHEMA,
  MAX_HISTORY,
  listHistory,
  appendHistory,
  clearHistory,
};
