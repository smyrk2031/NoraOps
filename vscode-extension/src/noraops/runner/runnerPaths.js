const path = require("path");
const os = require("os");

function noraOpsLocalRoot() {
  const override = process.env.NORAOPS_LOCAL_ROOT;
  if (override && String(override).trim()) {
    return path.resolve(String(override).trim());
  }
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  return path.join(base, "NoraOps");
}

function runnerAppsRoot() {
  return path.join(noraOpsLocalRoot(), "runner-apps");
}

function runnerEnvsRoot() {
  return path.join(noraOpsLocalRoot(), "runner-envs");
}

function cacheKey(owner, name) {
  return `${owner}__${name}`.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function appCacheDir(owner, name) {
  return path.join(runnerAppsRoot(), cacheKey(owner, name));
}

function runnerEnvDir(owner, name) {
  return path.join(runnerEnvsRoot(), cacheKey(owner, name));
}

/** runner-apps 展開先パスから owner/name を推定 */
function parseRunnerCacheFromWorkspace(workspaceRoot) {
  if (!workspaceRoot) return null;
  const norm = path.resolve(workspaceRoot).replace(/\\/g, "/").toLowerCase();
  const marker = "/noraops/runner-apps/";
  const idx = norm.indexOf(marker);
  if (idx < 0) return null;
  const key = norm.slice(idx + marker.length).replace(/\/$/, "");
  if (!key) return null;
  const sep = key.indexOf("__");
  if (sep <= 0) return { owner: key, name: key, cacheKey: key };
  return {
    owner: key.slice(0, sep),
    name: key.slice(sep + 2),
    cacheKey: key,
  };
}

function runnerEnvDirFromWorkspace(workspaceRoot) {
  const parsed = parseRunnerCacheFromWorkspace(workspaceRoot);
  if (!parsed) return null;
  return runnerEnvDir(parsed.owner, parsed.name);
}

module.exports = {
  noraOpsLocalRoot,
  runnerAppsRoot,
  runnerEnvsRoot,
  cacheKey,
  appCacheDir,
  runnerEnvDir,
  parseRunnerCacheFromWorkspace,
  runnerEnvDirFromWorkspace,
};
