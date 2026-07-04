/**
 * Runner 用: お気に入り・最近使ったアプリ（利用者のホーム画面用）。
 */
const fs = require("fs");
const path = require("path");
const os = require("os");

const PREFS_FILE = "runner-app-prefs.json";
const MAX_RECENT = 16;

function noraOpsRoot() {
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  return path.join(base, "NoraOps");
}

function prefsPath() {
  return path.join(noraOpsRoot(), PREFS_FILE);
}

function loadPrefs() {
  const p = prefsPath();
  if (!fs.existsSync(p)) return { pinned: {}, recent: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8"));
    return { pinned: raw.pinned || {}, recent: Array.isArray(raw.recent) ? raw.recent : [] };
  } catch {
    return { pinned: {}, recent: [] };
  }
}

function savePrefs(prefs) {
  fs.mkdirSync(noraOpsRoot(), { recursive: true });
  fs.writeFileSync(prefsPath(), JSON.stringify(prefs, null, 2), "utf8");
}

function appKey(item) {
  const owner =
    typeof item.owner === "string" ? item.owner : item.owner?.login || item.owner?.name || "";
  const name = item.name || "";
  if (owner && name) return `${owner}/${name}`;
  return item.full_name || item.fullName || name || "";
}

const { LOCAL_OWNER } = require("./localRunnerRegistry");

function snapshotItem(item) {
  const owner =
    typeof item.owner === "string" ? item.owner : item.owner?.login || item.owner?.name || "";
  const name = item.name || "";
  const fullName = item.full_name || item.fullName || (owner && name ? `${owner}/${name}` : name);
  const local = item.local === true || owner === LOCAL_OWNER || item.source === "zip";
  return {
    fullName,
    name: name || fullName.split("/").pop(),
    owner: owner || fullName.split("/")[0] || "",
    description: (item.description || item.displayName || "").slice(0, 500),
    artifactSha: item.artifactSha || "",
    thumbnailUrl: item.thumbnailUrl || "",
    hasThumbnail: !!item.hasThumbnail,
    local,
    source: item.source || (local ? "zip" : "catalog"),
  };
}

function updatePinnedArtifactMeta(item) {
  const key = appKey(item) || snapshotItem(item).fullName;
  if (!key) return;
  const prefs = loadPrefs();
  if (!prefs.pinned[key]) return;
  const snap = snapshotItem(item);
  prefs.pinned[key] = { ...prefs.pinned[key], ...snap };
  savePrefs(prefs);
}

function recordRunnerAppRun(item) {
  const snap = snapshotItem(item);
  const key = appKey(item) || snap.fullName;
  if (!key) return;
  const prefs = loadPrefs();
  const now = Date.now();
  prefs.recent = [
    { ...snap, key, lastUsedMs: now },
    ...prefs.recent.filter((r) => r.key !== key),
  ].slice(0, MAX_RECENT);
  if (prefs.pinned[key]) {
    prefs.pinned[key] = { ...prefs.pinned[key], ...snap, lastUsedMs: now };
  }
  savePrefs(prefs);
}

function toggleRunnerPin(item) {
  const key = appKey(item) || snapshotItem(item).fullName;
  if (!key) return false;
  const prefs = loadPrefs();
  if (prefs.pinned[key]) {
    delete prefs.pinned[key];
    savePrefs(prefs);
    return false;
  }
  prefs.pinned[key] = { ...snapshotItem(item), key, pinnedAt: Date.now(), lastUsedMs: Date.now() };
  savePrefs(prefs);
  return true;
}

function isPinned(item) {
  const key = appKey(item);
  return !!loadPrefs().pinned[key];
}

function getRunnerHomeLists() {
  const prefs = loadPrefs();
  const pinned = Object.values(prefs.pinned).sort(
    (a, b) => (b.lastUsedMs || b.pinnedAt || 0) - (a.lastUsedMs || a.pinnedAt || 0)
  );
  const pinnedKeys = new Set(pinned.map((p) => p.key));
  const recent = prefs.recent
    .filter((r) => r.key && !pinnedKeys.has(r.key))
    .slice(0, 8);
  return { pinned, recent };
}

module.exports = {
  recordRunnerAppRun,
  toggleRunnerPin,
  isPinned,
  getRunnerHomeLists,
  appKey,
  snapshotItem,
  updatePinnedArtifactMeta,
};
