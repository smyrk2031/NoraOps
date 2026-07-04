const { fetchPublishedAppDetail } = require("../portalApi");
const { readLocalArtifactMeta, hasLocalCache } = require("./runnerArtifactCache");

const { LOCAL_OWNER, isLocalRunnerItem } = require("../localRunnerRegistry");

/**
 * お気に入り・最近のアプリについて、サーバー artifactSha とローカルキャッシュを比較。
 * @returns {Promise<Array<{ key, owner, name, fullName, remoteSha, localSha, needsUpdate }>>}
 */
async function checkRunnerAppUpdates(serverBaseUrl, entries) {
  const updates = [];
  for (const ent of entries || []) {
    const owner = ent.owner || "";
    const name = ent.name || "";
    const key = ent.key || ent.fullName || `${owner}/${name}`;
    if (!owner || !name) continue;
    if (ent.local || owner === LOCAL_OWNER) continue;
    try {
      const detail = await fetchPublishedAppDetail(serverBaseUrl, owner, name);
      const remoteSha = (detail.artifactSha || "").trim();
      if (!remoteSha) continue;
      const local = readLocalArtifactMeta(owner, name);
      const localSha = (local.sha || "").trim();
      const cached = hasLocalCache(owner, name);
      const needsUpdate =
        cached && (!localSha || localSha !== remoteSha) || (local.legacy && cached);
      if (needsUpdate) {
        updates.push({
          key,
          owner,
          name,
          fullName: ent.fullName || `${owner}/${name}`,
          remoteSha,
          localSha: localSha || null,
        });
      }
    } catch {
      /* skip unreachable apps */
    }
  }
  return updates;
}

module.exports = { checkRunnerAppUpdates };
