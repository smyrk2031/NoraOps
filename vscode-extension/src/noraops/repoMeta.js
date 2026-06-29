const { readWorkspaceSession, writeWorkspaceSession } = require("./pathsMeta");
const { normalizeGiteaRepoId } = require("./giteaRepoId");

/**
 * NoraOps が紐づけた Gitea リポ（AppData session のみ）。
 * ローカル git の origin は参照しない（別プロジェクトの残骸で誤 push するため）。
 */
function getNoraOpsRepoMeta(workspaceRoot) {
  const session = readWorkspaceSession(workspaceRoot);
  if (!session) return null;

  const giteaRepoId = normalizeGiteaRepoId(session.giteaRepoId);

  if (session.giteaFullName && String(session.giteaFullName).includes("/")) {
    const [owner, name] = String(session.giteaFullName).split("/", 2);
    if (owner && name) {
      return {
        owner: owner.trim(),
        name: name.trim(),
        fullName: `${owner.trim()}/${name.trim()}`,
        giteaRepoId,
        source: "nora-session",
      };
    }
  }
  if (session.giteaOwner && session.giteaName) {
    const owner = String(session.giteaOwner).trim();
    const name = String(session.giteaName).trim();
    return { owner, name, fullName: `${owner}/${name}`, giteaRepoId, source: "nora-session" };
  }
  return null;
}

/** @deprecated use getNoraOpsRepoMeta */
async function parseOriginOwnerName(workspaceRoot) {
  return getNoraOpsRepoMeta(workspaceRoot);
}

function bindNoraOpsRepo(workspaceRoot, { owner, name, fullName, cloneUrl, appId, giteaRepoId }) {
  const fn = fullName || `${owner}/${name}`;
  const patch = {
    giteaFullName: fn,
    giteaOwner: owner,
    giteaName: name,
    cloneUrl: cloneUrl || null,
    appId: appId || undefined,
  };
  const gid = normalizeGiteaRepoId(giteaRepoId);
  if (gid) patch.giteaRepoId = gid;
  return writeWorkspaceSession(workspaceRoot, patch);
}

async function parseGitOriginRemote(workspaceRoot) {
  try {
    const { runGit } = require("./gitExec");
    const url = (await runGit(workspaceRoot, ["remote", "get-url", "origin"])).trim();
    const m = url.match(/[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
    if (!m) return null;
    const owner = m[1];
    const name = m[2].replace(/\.git$/, "");
    return { owner, name, fullName: `${owner}/${name}`, url };
  } catch {
    return null;
  }
}

/**
 * 別プロジェクトの .git が残っていると true（保存先誤りの原因）。
 */
async function detectForeignGitOrigin(workspaceRoot) {
  const bound = getNoraOpsRepoMeta(workspaceRoot);
  const git = await parseGitOriginRemote(workspaceRoot);
  if (!git) return { foreign: false, bound, git: null };
  if (!bound) {
    return {
      foreign: true,
      bound: null,
      git,
      reason: "git-only",
      message: `このフォルダの Git origin は「${git.fullName}」ですが、NoraOps の保存先は未登録です。別プロジェクトの .git が残っている可能性があります。`,
    };
  }
  const same =
    bound.owner.toLowerCase() === git.owner.toLowerCase() &&
    bound.name.toLowerCase() === git.name.toLowerCase();
  if (same) return { foreign: false, bound, git };
  return {
    foreign: true,
    bound,
    git,
    reason: "mismatch",
    message:
      `NoraOps の保存先は「${bound.fullName}」ですが、Git origin は「${git.fullName}」のままです。別リポに送らないよう注意してください。`,
  };
}

module.exports = {
  getNoraOpsRepoMeta,
  parseOriginOwnerName,
  bindNoraOpsRepo,
  parseGitOriginRemote,
  detectForeignGitOrigin,
};
