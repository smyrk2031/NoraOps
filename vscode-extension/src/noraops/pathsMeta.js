const fs = require("fs");
const path = require("path");
const {
  noraOpsRoot,
  readWorkspaceSession,
  writeWorkspaceSession,
  workspaceSessionPath,
} = require("./workspaceStore");

function recentIndexPath() {
  return path.join(noraOpsRoot(), "recent-apps.json");
}

/** uv / PEP 508 向け（ASCII のみ。日本語フォルダ名は app-{hash}） */
function packageNameSlug(name) {
  const crypto = require("crypto");
  const raw = String(name || "").trim();
  let s = raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "");
  if (s && /^[a-z0-9]/.test(s) && /[a-z0-9]$/i.test(s)) {
    return s.slice(0, 64);
  }
  const hash = crypto.createHash("sha256").update(raw || "app").digest("hex").slice(0, 8);
  if (s) {
    const merged = `${s}-app-${hash}`.replace(/-+/g, "-").replace(/^[._-]+|[._-]+$/g, "");
    if (/^[a-z0-9]/.test(merged) && /[a-z0-9]$/i.test(merged)) return merged.slice(0, 64);
  }
  return `app-${hash}`;
}

function slugify(name) {
  return packageNameSlug(name);
}

function readRecentApps() {
  const p = recentIndexPath();
  try {
    if (fs.existsSync(p)) {
      const data = JSON.parse(fs.readFileSync(p, "utf8"));
      return Array.isArray(data.apps) ? data.apps : [];
    }
  } catch {
    /* ignore */
  }
  return [];
}

function writeRecentApps(apps) {
  const root = noraOpsRoot();
  fs.mkdirSync(root, { recursive: true });
  const sorted = [...apps].sort((a, b) => (b.lastOpened || "").localeCompare(a.lastOpened || ""));
  fs.writeFileSync(recentIndexPath(), JSON.stringify({ apps: sorted.slice(0, 10) }, null, 2), "utf8");
}

function recordAppAccess(workspaceRoot, extra = {}) {
  const folderName = path.basename(workspaceRoot);
  const prev = readWorkspaceSession(workspaceRoot) || {};
  const appId = extra.appId || prev.appId || `nora.app.${slugify(folderName)}`;
  const displayName = extra.displayName || prev.displayName || folderName;
  const patch = {
    appId,
    displayName,
    workspacePath: workspaceRoot,
  };
  const optionalKeys = [
    "lastSave",
    "lastPushOk",
    "online",
    "secIssues",
    "polIssues",
    "giteaFullName",
    "giteaOwner",
    "giteaName",
    "giteaRepoId",
    "lastPublished",
    "lastPublishedVersion",
    "lastPublishedTag",
    "lastPublishedAt",
    "creatorWorkflow",
    "creatorProfile",
    "importRequirementsPath",
  ];
  for (const k of optionalKeys) {
    if (Object.prototype.hasOwnProperty.call(extra, k)) {
      if (extra[k] != null && extra[k] !== "") patch[k] = extra[k];
      continue;
    }
    if (prev[k] != null && prev[k] !== "") patch[k] = prev[k];
  }

  const session = writeWorkspaceSession(workspaceRoot, patch);

  const apps = readRecentApps().filter((a) => a.workspacePath !== workspaceRoot);
  apps.unshift({
    appId,
    displayName,
    workspacePath: workspaceRoot,
    lastOpened: new Date().toISOString(),
    lastSave: extra.lastSave || session.lastSave,
  });
  writeRecentApps(apps);
  return session;
}

module.exports = {
  noraOpsRoot,
  slugify,
  packageNameSlug,
  readRecentApps,
  recordAppAccess,
  readWorkspaceSession,
  writeWorkspaceSession,
  workspaceSessionPath,
};
