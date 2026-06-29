/** 公開版 / ローカル版の表示用情報 */

const fs = require("fs");
const path = require("path");
const { readVersion } = require("./versionUtil");
const { readWorkspaceSession } = require("./pathsMeta");
const { hasNoraOpsRepoBinding } = require("./repoSetup");

function parseVersionParts(v) {
  const raw = String(v || "0.0.0").replace(/^v/i, "");
  const parts = raw.split(".").map((n) => parseInt(n, 10) || 0);
  while (parts.length < 3) parts.push(0);
  return parts.slice(0, 3);
}

function compareVersion(a, b) {
  const pa = parseVersionParts(a);
  const pb = parseVersionParts(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

function readManifestVersion(workspaceRoot) {
  const p = path.join(workspaceRoot, "nora", "manifest.json");
  if (!fs.existsSync(p)) return null;
  try {
    const man = JSON.parse(fs.readFileSync(p, "utf8"));
    return man.version ? String(man.version) : null;
  } catch {
    return null;
  }
}

function readReadmeExcerpt(workspaceRoot, maxLen = 200) {
  const p = path.join(workspaceRoot, "README.md");
  if (!fs.existsSync(p)) return "";
  try {
    const text = fs.readFileSync(p, "utf8").trim();
    return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
  } catch {
    return "";
  }
}

function buildReleaseInfo(workspaceRoot) {
  if (!workspaceRoot) {
    return {
      localVersion: null,
      publishedVersion: null,
      publishedTag: null,
      publishedAt: null,
      hasUnpublishedChanges: false,
      bound: false,
      readmeExcerpt: "",
    };
  }

  const session = readWorkspaceSession(workspaceRoot) || {};
  const pyVer = readVersion(workspaceRoot);
  const manVer = readManifestVersion(workspaceRoot);
  const localVersion = manVer || pyVer || "0.1.0";
  const publishedVersion = session.lastPublishedVersion || null;
  const publishedTag = session.lastPublishedTag || (publishedVersion ? `v${publishedVersion.replace(/^v/i, "")}` : null);
  const publishedAt = session.lastPublishedAt || null;
  const bound = hasNoraOpsRepoBinding(workspaceRoot);

  let hasUnpublishedChanges = false;
  if (publishedVersion && localVersion) {
    hasUnpublishedChanges = compareVersion(localVersion, publishedVersion) > 0;
  } else if (bound && session.lastPushOk && !publishedVersion) {
    hasUnpublishedChanges = true;
  }

  return {
    localVersion,
    publishedVersion,
    publishedTag,
    publishedAt,
    lastSave: session.lastSave || null,
    lastPushOk: session.lastPushOk === true,
    giteaFullName: session.giteaFullName || null,
    hasUnpublishedChanges,
    bound,
    readmeExcerpt: readReadmeExcerpt(workspaceRoot),
  };
}

module.exports = {
  buildReleaseInfo,
  compareVersion,
  parseVersionParts,
};
