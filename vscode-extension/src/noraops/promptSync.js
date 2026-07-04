/**
 * 基本プロンプトのサーバー同期
 */

const { getNoraOpsConfig } = require("./config");
const { requestJson } = require("./noraopsApi");
const { getCatalogVersion } = require("./builtinPromptCatalog");
const { isCatalogVersionNewer } = require("./catalogVersion");
const { mergeRemoteCatalog, getSyncStatus } = require("./creatorPrompts");

function isRemoteCatalogNewer(remoteVersion) {
  return isCatalogVersionNewer(remoteVersion, getCatalogVersion());
}

/**
 * リモートカタログを取得（オフライン時は null）
 */
async function fetchRemoteBuiltinCatalog() {
  const cfg = getNoraOpsConfig();
  if (!cfg?.serverBaseUrl) return null;
  try {
    const localVer = encodeURIComponent(getCatalogVersion());
    const { status, json } = await requestJson(
      "GET",
      `${cfg.serverBaseUrl}/api/v1/noraops/prompts/builtin-catalog?local_version=${localVer}`
    );
    if (status === 200 && json && Array.isArray(json.prompts)) return json;
  } catch {
    /* offline */
  }
  return null;
}

/**
 * @param {string} workspaceRoot
 * @param {{ apply?: boolean }} [opts]
 */
async function checkBuiltinPromptUpdates(workspaceRoot, opts = {}) {
  const remote = await fetchRemoteBuiltinCatalog();
  const status = getSyncStatus(workspaceRoot);
  if (!remote) {
    return { ...status, online: false, applied: false, updatedCount: 0 };
  }
  const remoteNewer = isRemoteCatalogNewer(remote.version);
  let updatedCount = 0;
  if (opts.apply && workspaceRoot) {
    const r = mergeRemoteCatalog(workspaceRoot, remote);
    updatedCount = r.updated;
  }
  return {
    ...getSyncStatus(workspaceRoot),
    online: true,
    remoteVersion: remote.version,
    hasUpdate: remoteNewer || status.pendingRemote,
    applied: !!opts.apply,
    updatedCount,
    remote,
  };
}

/**
 * @param {string} workspaceRoot
 */
async function applyBuiltinPromptUpdates(workspaceRoot) {
  return checkBuiltinPromptUpdates(workspaceRoot, { apply: true });
}

module.exports = {
  fetchRemoteBuiltinCatalog,
  checkBuiltinPromptUpdates,
  applyBuiltinPromptUpdates,
  isRemoteCatalogNewer,
};
