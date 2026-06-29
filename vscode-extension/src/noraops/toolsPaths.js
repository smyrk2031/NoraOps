const os = require("os");
const path = require("path");

/** @returns {import('./toolsPaths').NoraOpsRuntimePaths} */
function getNoraOpsRuntimePaths(installRootOverride) {
  let base;
  if (installRootOverride && String(installRootOverride).trim()) {
    base = path.resolve(String(installRootOverride).trim());
  } else {
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    base = path.join(local, "NoraOps", "runtime");
  }
  const toolsRoot = path.join(base, "tools");
  return {
    root: base,
    toolsRoot,
    cacheRoot: path.join(base, "cache"),
    logsRoot: path.join(base, "logs"),
    uvExe: path.join(toolsRoot, "uv", "uv.exe"),
    gitExe: path.join(toolsRoot, "portable-git", "cmd", "git.exe"),
    stateFile: path.join(toolsRoot, "tools-state.json"),
  };
}

module.exports = { getNoraOpsRuntimePaths };
