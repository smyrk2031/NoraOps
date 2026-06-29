const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { buildChildProcessEnv } = require("../httpEnv");
const { getNoraOpsConfig } = require("../config");
const { fetchPublishedAppDetail } = require("../portalApi");
const { downloadAndExtractArtifact } = require("../artifactDownload");
const { resolveUvExe } = require("../toolInstaller");
const { ensurePythonEnv, uvProjectEnv } = require("../pythonEnv");
const { resolveAppEntry, formatEntryHint } = require("../appEntry");
const { writeLocalArtifactMeta } = require("./runnerArtifactCache");
const { logRunnerActivity } = require("../telemetry");
const { invalidateThumbCache } = require("./runnerThumbnails");
const { appCacheDir, runnerAppsRoot } = require("./runnerPaths");

const { resolvePyproject } = require("../pyprojectResolve");

function findProjectDir(workspaceRoot) {
  const resolved = resolvePyproject(workspaceRoot);
  if (!resolved.ok) return null;
  return {
    projectDir: resolved.projectDir,
    pyproject: resolved.pyprojectPath,
    pyprojectRel: resolved.pyprojectRel,
    source: resolved.source,
    ambiguous: resolved.ambiguous,
  };
}

function appendRunLog(workspaceRoot, line) {
  try {
    const dir = path.join(workspaceRoot, ".nora");
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, "runner-last.log"), `${new Date().toISOString()} ${line}\n`, "utf8");
  } catch {
    /* ignore */
  }
}

/**
 * Launch app detached. GUI (tkinter) must not use windowsHide.
 */
function runDetachedApp(workspaceRoot, projectDir, entry, envMeta) {
  const uv = resolveUvExe() || "uv";
  const venvDir = envMeta?.venvDir;
  const extraEnv = venvDir ? uvProjectEnv(venvDir) : {};

  let args;
  let label;
  if (entry.scriptPath) {
    const rel = path.relative(projectDir, entry.scriptPath);
    const relPosix = rel.split(path.sep).join("/");
    args = ["run", "--directory", projectDir, "python", relPosix];
    label = entry.label;
  } else if (entry.pyprojectScript) {
    const { module, attr } = entry.pyprojectScript;
    args = ["run", "--directory", projectDir, "python", "-m", module];
    if (attr && attr !== "__main__") {
      args = ["run", "--directory", projectDir, "python", "-c", `import ${module}; ${module}.${attr}()`];
    }
    label = entry.label;
  } else {
    throw new Error("entry missing");
  }

  appendRunLog(workspaceRoot, `spawn: ${uv} ${args.join(" ")}`);

  return new Promise((resolve, reject) => {
    const child = spawn(uv, args, {
      cwd: workspaceRoot,
      detached: true,
      stdio: "ignore",
      windowsHide: false,
      env: buildChildProcessEnv(extraEnv),
    });
    child.on("error", (err) => {
      appendRunLog(workspaceRoot, `spawn error: ${err.message}`);
      reject(err);
    });
    child.unref();
    setTimeout(() => resolve({ label, pid: child.pid }), 300);
  });
}

async function createReadSession(serverBaseUrl, deviceLabel) {
  const { createPushSession } = require("../noraopsApi");
  return createPushSession(serverBaseUrl, deviceLabel, "read");
}

async function ensureArtifactWorkspace(detail, log, options = {}) {
  const force = !!options.force;
  const dir = appCacheDir(detail.owner, detail.name);
  const marker = path.join(dir, ".noraops-artifact-ok");
  if (!force && fs.existsSync(marker) && fs.existsSync(dir)) {
    const entries = fs.readdirSync(dir).filter((n) => n !== ".noraops-artifact-ok");
    if (entries.length) return dir;
  }

  const cfg = getNoraOpsConfig();
  log("ソースをダウンロードしています…");
  const session = await createReadSession(cfg.serverBaseUrl, cfg.deviceLabel);
  const token = session.pushToken;
  if (!token) throw new Error("read session token missing");

  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.mkdirSync(path.dirname(dir), { recursive: true });

  await downloadAndExtractArtifact(cfg.serverBaseUrl, detail.owner, detail.name, dir, token, {
    tag: options.tag || detail.selectedTag || detail.latestPublishedTag || "",
    version: options.version || detail.selectedVersion || "",
  });
  const remoteSha = (detail.artifactSha || "").trim();
  writeLocalArtifactMeta(detail.owner, detail.name, remoteSha);
  invalidateThumbCache(detail.owner, detail.name);
  return dir;
}

async function upgradePublishedApp(item, progress) {
  const cfg = getNoraOpsConfig();
  const log = (msg) => progress?.({ message: msg });
  const ownerLogin =
    typeof item.owner === "string" ? item.owner : item.owner?.login || "";
  const full = item.full_name || (ownerLogin ? `${ownerLogin}/${item.name}` : item.name);
  const [owner, name] = full.includes("/") ? full.split("/", 2) : [ownerLogin, full];
  log("最新版を取得しています…");
  const detail = await fetchPublishedAppDetail(cfg.serverBaseUrl, owner, name);
  await ensureArtifactWorkspace(detail, log, { force: true });
  return { ok: true, owner, name, fullName: detail.full_name || full, sha: detail.artifactSha };
}

async function runPublishedApp(item, progress) {
  const cfg = getNoraOpsConfig();
  const log = (msg) => progress?.({ message: msg });

  const ownerLogin =
    typeof item.owner === "string" ? item.owner : item.owner?.login || "";
  const full = item.full_name || (ownerLogin ? `${ownerLogin}/${item.name}` : item.name);
  const [owner, name] = full.includes("/") ? full.split("/", 2) : [ownerLogin, full];

  log("アプリ情報を取得…");
  const detail = await fetchPublishedAppDetail(cfg.serverBaseUrl, owner, name);
  const selectedTag =
    item.publishedTag || item.selectedTag || item.latestPublishedTag || detail.latestPublishedTag || "";
  if (selectedTag) detail.selectedTag = selectedTag;

  const workspaceRoot = await ensureArtifactWorkspace(detail, log, {
    tag: selectedTag,
    version: item.selectedVersion || item.latestPublishedVersion || "",
  });
  const found = findProjectDir(workspaceRoot);
  if (!found) {
    throw new Error(
      "pyproject.toml が見つかりません（ルート・直下 1 階層・nora/packages を探索しました）。"
    );
  }

  const entry = resolveAppEntry(workspaceRoot, found.projectDir);
  if (!entry) {
    throw new Error(formatEntryHint(workspaceRoot));
  }

  log(`起動ファイル: ${entry.label}（${entry.source}）`);

  log("Python 環境を用意…");
  const env = await ensurePythonEnv(workspaceRoot, { log, skipEditorIntegration: true });
  if (!env.ok) {
    throw new Error(env.message || "Python 環境の準備に失敗しました。");
  }

  log("アプリを起動しています…");
  const launched = await runDetachedApp(workspaceRoot, found.projectDir, entry, env.meta);
  appendRunLog(workspaceRoot, `started pid=${launched.pid} entry=${launched.label}`);
  void logRunnerActivity(detail.full_name || full, "launch", {
    entry: entry.label,
    projectDir: found.projectDir,
  });

  return {
    ok: true,
    workspaceRoot,
    projectDir: found.projectDir,
    entry: entry.label,
    fullName: detail.full_name || full,
    owner,
    name,
  };
}

module.exports = {
  runPublishedApp,
  upgradePublishedApp,
  ensureArtifactWorkspace,
  findProjectDir,
  appCacheDir,
  runnerAppsRoot,
};
