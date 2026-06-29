/** import（公開）モード: manifest / appId をユーザー操作なしで整える */

const fs = require("fs");
const path = require("path");
const { readNoraManifest } = require("./appEntry");
const { readWorkspaceSession, writeWorkspaceSession, recordAppAccess } = require("./pathsMeta");
const { newAppId, normalizeAppId } = require("./appIdentity");
const { ensurePublishScaffold, noraJoin, resolveScaffoldRoot } = require("./scaffold");

function syncSessionFromManifest(workspaceRoot, appId) {
  const session = readWorkspaceSession(workspaceRoot);
  if (session?.appId === appId) return;
  writeWorkspaceSession(workspaceRoot, { appId });
  recordAppAccess(workspaceRoot, { appId });
}

function ensureImportPublishReady(workspaceRoot, options = {}) {
  const { readCreatorProfile, MODES } = require("./creatorWorkflow");
  if (readCreatorProfile(workspaceRoot) !== MODES.IMPORT) {
    return { ok: true, skipped: true, reason: "not_import" };
  }

  let manifest = readNoraManifest(workspaceRoot);
  if (manifest?.appId) {
    syncSessionFromManifest(workspaceRoot, manifest.appId);
    return { ok: true, skipped: true, appId: manifest.appId };
  }

  const manPath = noraJoin(workspaceRoot, "manifest.json");
  const root = resolveScaffoldRoot(workspaceRoot);
  const session = readWorkspaceSession(workspaceRoot);
  const displayName =
    options.displayName || manifest?.displayName || session?.displayName || path.basename(root);
  const appId = normalizeAppId(options.appId) || newAppId();

  if (!fs.existsSync(manPath)) {
    ensurePublishScaffold(workspaceRoot, { appId, displayName });
    writeWorkspaceSession(workspaceRoot, { appId, displayName });
    recordAppAccess(workspaceRoot, { appId, displayName });
    return { ok: true, created: true, appId };
  }

  manifest = manifest || {};
  const updated = {
    ...manifest,
    appId,
    displayName: manifest.displayName || displayName,
    schema: manifest.schema || "nora.manifest/1",
  };
  fs.mkdirSync(path.dirname(manPath), { recursive: true });
  fs.writeFileSync(manPath, JSON.stringify(updated, null, 2) + "\n", "utf8");
  writeWorkspaceSession(workspaceRoot, { appId, displayName: updated.displayName });
  recordAppAccess(workspaceRoot, { appId, displayName: updated.displayName });
  return { ok: true, patched: true, appId };
}

module.exports = { ensureImportPublishReady };
