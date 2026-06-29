const fs = require("fs");
const { execFile } = require("child_process");
const { ToolManager, compareSemver, formatToolProgress } = require("../toolManager");
const { getNoraOpsConfig } = require("./config");
const { getNoraOpsRuntimePaths } = require("./toolsPaths");

function createToolManager() {
  const cfg = getNoraOpsConfig();
  const paths = getNoraOpsRuntimePaths(cfg.toolsInstallRoot);
  return new ToolManager({
    config: {
      manifestUrl: cfg.toolsManifestUrl,
      authToken: cfg.toolsAuthToken,
      channel: "stable",
      installRoot: paths.root,
    },
    paths,
    log: (m) => console.log(`[NoraOps tools] ${m}`),
  });
}

/** %LOCALAPPDATA%\\NoraOps\\runtime\\tools\\uv\\uv.exe の実在 + 実行可否 */
function probeUvExe(uvExe) {
  return new Promise((resolve) => {
    const path = uvExe || getNoraOpsRuntimePaths(getNoraOpsConfig().toolsInstallRoot).uvExe;
    if (!fs.existsSync(path)) {
      resolve({ installed: false, path, version: null, error: "ファイルがありません" });
      return;
    }
    execFile(path, ["--version"], { timeout: 10000, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        resolve({
          installed: false,
          path,
          version: null,
          error: (stderr || err.message || "実行できません").trim(),
        });
        return;
      }
      const line = String(stdout || "")
        .trim()
        .split(/\r?\n/)[0];
      resolve({ installed: true, path, version: line || "OK" });
    });
  });
}

async function fetchToolsStatus() {
  const tm = createToolManager();
  const paths = tm.paths;
  const local = await probeUvExe(paths.uvExe);

  let manifest = null;
  let online = false;
  let manifestError = null;
  try {
    manifest = await tm.fetchManifest();
    online = true;
  } catch (e) {
    manifestError = e.message || String(e);
  }

  const state = online ? await tm.readState() : null;
  const gitFile = fs.existsSync(paths.gitExe);
  const gitVer = state?.git || null;
  const wantUv = manifest?.uv?.version;
  const wantGit = manifest?.portableGit?.version;

  let forceUpdate = false;
  if (online && manifest) {
    try {
      forceUpdate = await tm.shouldForceUpdate(manifest);
    } catch {
      forceUpdate = false;
    }
  }

  const stateUvVer = state?.uv || null;
  const versionDrift = online && wantUv && stateUvVer && stateUvVer !== wantUv;
  const updateNeeded = local.installed && online && (forceUpdate || versionDrift || (wantUv && !stateUvVer));

  return {
    /** uv.exe が存在し --version が通る = 利用可能 */
    ok: local.installed,
    online,
    error: manifestError,
    manifest: manifest || undefined,
    state,
    paths,
    uv: {
      installed: local.installed,
      path: local.path,
      version: local.version,
      required: wantUv,
      updateNeeded,
      error: local.error || "",
    },
    git: {
      installed: gitFile,
      version: gitVer,
      required: wantGit,
      optional: true,
      updateNeeded: online && wantGit ? !gitFile || gitVer !== wantGit : false,
    },
    forceUpdate,
  };
}

async function ensureNoraOpsTools(progressCb) {
  const tm = createToolManager();
  return tm.ensureInstalled((p) => {
    const msg = formatToolProgress(p) || p?.message || "";
    progressCb?.({ ...p, message: msg });
  });
}

function resolveGitExe() {
  const paths = getNoraOpsRuntimePaths(getNoraOpsConfig().toolsInstallRoot);
  if (fs.existsSync(paths.gitExe)) return paths.gitExe;
  return "git";
}

function resolveUvExe() {
  const paths = getNoraOpsRuntimePaths(getNoraOpsConfig().toolsInstallRoot);
  if (fs.existsSync(paths.uvExe)) return paths.uvExe;
  return null;
}

module.exports = {
  createToolManager,
  probeUvExe,
  fetchToolsStatus,
  ensureNoraOpsTools,
  resolveGitExe,
  resolveUvExe,
  compareSemver,
  formatToolProgress,
};
