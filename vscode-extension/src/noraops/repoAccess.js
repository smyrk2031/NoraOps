const { getNoraOpsConfig } = require("./config");
const {
  fetchAccessibleRepos,
  fetchRepoMembers,
  addRepoMember,
  removeRepoMember,
} = require("./noraopsApi");

function requireServerBaseUrl() {
  const cfg = getNoraOpsConfig();
  const base = (cfg.serverBaseUrl || "").trim();
  if (!base) {
    throw new Error("ポータル URL が未設定です。Setting でサーバーを設定してください。");
  }
  return base;
}

async function listAccessibleRepos() {
  return fetchAccessibleRepos(requireServerBaseUrl());
}

async function listRepoMembers(owner, name) {
  return fetchRepoMembers(requireServerBaseUrl(), owner, name);
}

async function inviteRepoMember(owner, name, email, permission = "write") {
  return addRepoMember(requireServerBaseUrl(), owner, name, email, permission);
}

async function revokeRepoMember(owner, name, username) {
  return removeRepoMember(requireServerBaseUrl(), owner, name, username);
}

module.exports = {
  listAccessibleRepos,
  listRepoMembers,
  inviteRepoMember,
  revokeRepoMember,
};
