const fs = require("fs");
const path = require("path");
const { appCacheDir } = require("./runnerPaths");

function markerPath(owner, name) {
  return path.join(appCacheDir(owner, name), ".noraops-artifact-ok");
}

function readLocalArtifactMeta(owner, name) {
  const mp = markerPath(owner, name);
  if (!fs.existsSync(mp)) return { sha: null, downloadedAt: null };
  try {
    const raw = fs.readFileSync(mp, "utf8").trim();
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.sha) {
      return {
        sha: String(parsed.sha),
        downloadedAt: parsed.downloadedAt || null,
      };
    }
    // 旧形式: ISO 日時のみ → ローカル版不明
    if (raw && /^\d{4}-\d{2}-\d{2}T/.test(raw)) {
      return { sha: null, downloadedAt: raw, legacy: true };
    }
  } catch {
    /* ignore */
  }
  return { sha: null, downloadedAt: null };
}

function writeLocalArtifactMeta(owner, name, sha) {
  const mp = markerPath(owner, name);
  fs.mkdirSync(path.dirname(mp), { recursive: true });
  fs.writeFileSync(
    mp,
    JSON.stringify({ sha: sha || "", downloadedAt: new Date().toISOString() }, null, 0),
    "utf8"
  );
}

function hasLocalCache(owner, name) {
  const dir = appCacheDir(owner, name);
  const mp = markerPath(owner, name);
  if (!fs.existsSync(dir) || !fs.existsSync(mp)) return false;
  const entries = fs.readdirSync(dir).filter((n) => n !== ".noraops-artifact-ok");
  return entries.length > 0;
}

module.exports = {
  readLocalArtifactMeta,
  writeLocalArtifactMeta,
  hasLocalCache,
  markerPath,
};
