/**
 * Connect タブ — ユーザー定義 API 接続プロファイル（ワークスペース単位）
 */

const crypto = require("crypto");
const { readWorkspaceRecord, writeWorkspaceRecord } = require("./workspaceStore");

const CONNECT_SCHEMA = "nora.connect-profiles/1";

function newProfileId() {
  return crypto.randomBytes(8).toString("hex");
}

function normalizeHeader(row) {
  if (!row || typeof row !== "object") return null;
  const key = String(row.key || "").trim();
  if (!key) return null;
  return { key: key.slice(0, 120), value: String(row.value ?? "") };
}

function normalizeProfile(raw, index) {
  if (!raw || typeof raw !== "object") return null;
  const name = String(raw.name || "").trim();
  if (!name) return null;
  const method = String(raw.method || "GET").toUpperCase() === "POST" ? "POST" : "GET";
  const headers = Array.isArray(raw.headers)
    ? raw.headers.map(normalizeHeader).filter(Boolean)
    : [];
  return {
    id: String(raw.id || newProfileId()),
    name: name.slice(0, 120),
    method,
    url: String(raw.url || "").trim().slice(0, 2000),
    headers,
    body: method === "POST" ? String(raw.body ?? "") : "",
    contentType: String(raw.contentType || "application/json").trim() || "application/json",
    order: Number.isFinite(raw.order) ? raw.order : index * 10,
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: raw.updatedAt || raw.createdAt || new Date().toISOString(),
  };
}

function listProfiles(workspaceRoot) {
  const record = readWorkspaceRecord(workspaceRoot);
  const raw = record?.connectProfiles;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((p, i) => normalizeProfile(p, i))
    .filter(Boolean)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

function saveProfiles(workspaceRoot, profiles) {
  const normalized = profiles
    .map((p, i) => normalizeProfile(p, i))
    .filter(Boolean)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  writeWorkspaceRecord(workspaceRoot, {
    connectProfiles: normalized,
    connectProfilesSchema: CONNECT_SCHEMA,
  });
  return normalized;
}

function addProfile(workspaceRoot, fields) {
  const list = listProfiles(workspaceRoot);
  const now = new Date().toISOString();
  const profile = normalizeProfile(
    {
      ...fields,
      id: newProfileId(),
      order: list.length ? Math.max(...list.map((p) => p.order)) + 10 : 10,
      createdAt: now,
      updatedAt: now,
    },
    list.length
  );
  if (!profile) throw new Error("名前が必要です");
  list.push(profile);
  saveProfiles(workspaceRoot, list);
  return { profiles: list, profile };
}

function updateProfile(workspaceRoot, id, fields) {
  const list = listProfiles(workspaceRoot);
  const idx = list.findIndex((p) => p.id === id);
  if (idx < 0) throw new Error("プロファイルが見つかりません");
  const merged = normalizeProfile(
    {
      ...list[idx],
      ...fields,
      id: list[idx].id,
      createdAt: list[idx].createdAt,
      updatedAt: new Date().toISOString(),
    },
    idx
  );
  if (!merged) throw new Error("名前が必要です");
  list[idx] = merged;
  const saved = saveProfiles(workspaceRoot, list);
  return { profiles: saved, profile: merged };
}

function deleteProfile(workspaceRoot, id) {
  const list = listProfiles(workspaceRoot);
  const next = list.filter((p) => p.id !== id);
  if (next.length === list.length) throw new Error("プロファイルが見つかりません");
  return saveProfiles(workspaceRoot, next);
}

function reorderProfiles(workspaceRoot, orderedIds) {
  const list = listProfiles(workspaceRoot);
  const map = new Map(list.map((p) => [p.id, p]));
  const next = [];
  let order = 10;
  for (const id of orderedIds || []) {
    const p = map.get(id);
    if (!p) continue;
    next.push({ ...p, order, updatedAt: new Date().toISOString() });
    map.delete(id);
    order += 10;
  }
  for (const p of map.values()) {
    next.push({ ...p, order, updatedAt: new Date().toISOString() });
    order += 10;
  }
  return saveProfiles(workspaceRoot, next);
}

module.exports = {
  CONNECT_SCHEMA,
  listProfiles,
  addProfile,
  updateProfile,
  deleteProfile,
  reorderProfiles,
};
