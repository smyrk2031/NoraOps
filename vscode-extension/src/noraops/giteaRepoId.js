/** Gitea API の数値リポ ID 正規化 */

function normalizeGiteaRepoId(raw) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

function giteaRepoIdFromProvision(provisioned) {
  if (!provisioned) return null;
  return normalizeGiteaRepoId(
    provisioned.gitea_repo_id ?? provisioned.giteaRepoId ?? provisioned.id
  );
}

module.exports = { normalizeGiteaRepoId, giteaRepoIdFromProvision };
