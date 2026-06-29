const { readNoraManifest } = require("./appEntry");
const { getNoraOpsRepoMeta } = require("./repoMeta");

function getAiUsageContext(workspaceRoot) {
  if (!workspaceRoot) {
    return { appId: "", repoOwner: "", repoName: "", repoLabel: "" };
  }
  const manifest = readNoraManifest(workspaceRoot);
  const meta = getNoraOpsRepoMeta(workspaceRoot);
  const appId = String(manifest?.appId || "").trim();
  const repoOwner = String(meta?.owner || "").trim();
  const repoName = String(meta?.name || "").trim();
  const repoLabel = repoOwner && repoName ? `${repoOwner}/${repoName}` : appId || "";
  return { appId, repoOwner, repoName, repoLabel };
}

module.exports = {
  getAiUsageContext,
};
