/**
 * Runner — 手動 ZIP 取込アプリのレジストリ
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { noraOpsLocalRoot } = require("./runner/runnerPaths");

const REGISTRY_FILE = "local-runner-apps.json";
const LOCAL_OWNER = "local";

function registryPath() {
  return path.join(noraOpsLocalRoot(), REGISTRY_FILE);
}

function slugify(name) {
  const base = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return base || `app-${crypto.randomBytes(4).toString("hex")}`;
}

function uniqueSlug(name, existing) {
  const used = new Set((existing || []).map((e) => e.slug));
  let slug = slugify(name);
  if (!used.has(slug)) return slug;
  for (let i = 2; i < 100; i++) {
    const cand = `${slug}-${i}`;
    if (!used.has(cand)) return cand;
  }
  return `${slug}-${crypto.randomBytes(3).toString("hex")}`;
}

function loadRegistry() {
  const p = registryPath();
  if (!fs.existsSync(p)) return { apps: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8"));
    return { apps: Array.isArray(raw.apps) ? raw.apps : [] };
  } catch {
    return { apps: [] };
  }
}

function saveRegistry(data) {
  fs.mkdirSync(noraOpsLocalRoot(), { recursive: true });
  fs.writeFileSync(registryPath(), JSON.stringify({ apps: data.apps || [] }, null, 2), "utf8");
}

function listLocalApps() {
  return loadRegistry().apps
    .map((a) => ({
      ...a,
      owner: LOCAL_OWNER,
      slug: a.slug,
      name: a.slug,
      displayName: a.displayName || a.slug,
      fullName: `local/${a.slug}`,
      key: `local/${a.slug}`,
      description: a.displayName || a.slug,
      local: true,
      source: "zip",
    }))
    .sort((a, b) => (b.importedAt || "").localeCompare(a.importedAt || ""));
}

function registerLocalApp({ displayName, slug, sourceZip }) {
  const reg = loadRegistry();
  const entry = {
    slug,
    displayName: String(displayName || slug).slice(0, 120),
    importedAt: new Date().toISOString(),
    sourceZip: sourceZip ? path.basename(sourceZip) : null,
  };
  reg.apps = [entry, ...reg.apps.filter((a) => a.slug !== slug)];
  saveRegistry(reg);
  return entry;
}

function removeLocalApp(slug) {
  const reg = loadRegistry();
  const before = reg.apps.length;
  reg.apps = reg.apps.filter((a) => a.slug !== slug);
  if (reg.apps.length === before) return false;
  saveRegistry(reg);
  return true;
}

function isLocalRunnerItem(item) {
  if (!item) return false;
  if (item.local || item.source === "zip") return true;
  const owner = typeof item.owner === "string" ? item.owner : item.owner?.login || "";
  return owner === LOCAL_OWNER;
}

function toRunnerItem(entry) {
  return {
    owner: LOCAL_OWNER,
    slug: entry.slug,
    name: entry.displayName || entry.slug,
    fullName: `local/${entry.slug}`,
    key: `local/${entry.slug}`,
    description: entry.displayName || entry.slug,
    local: true,
    source: "zip",
    artifactSha: entry.importedAt || "local",
  };
}

module.exports = {
  LOCAL_OWNER,
  slugify,
  uniqueSlug,
  listLocalApps,
  registerLocalApp,
  removeLocalApp,
  isLocalRunnerItem,
  toRunnerItem,
};
