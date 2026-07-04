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
const { writeLocalArtifactMeta, hasLocalCache } = require("./runnerArtifactCache");
const { logRunnerActivity } = require("../telemetry");
const { invalidateThumbCache } = require("./runnerThumbnails");
const { appCacheDir, runnerAppsRoot } = require("./runnerPaths");
const { isLocalRunnerItem } = require("../localRunnerRegistry");
const { LOCAL_OWNER } = require("../localRunnerRegistry");

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

async function launchFromWorkspaceRoot(workspaceRoot, meta, progress) {
  const log = (msg) => progress?.({ message: msg });
  const { syncRunnerAppEnv } = require("./runnerAppEnv");
  const envSync = syncRunnerAppEnv(workspaceRoot, meta.owner, meta.name);
  if (envSync.applied && envSync.source === "store") {
    log(".env を Runner 用ストアから適用しました。");
  }
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
  return {
    ok: true,
    workspaceRoot,
    projectDir: found.projectDir,
    entry: launched.label,
    fullName: meta.fullName,
    owner: meta.owner,
    name: meta.name,
  };
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
  if (!cfg.serverBaseUrl) {
    throw new Error("サーバー URL が未設定です。オフラインの場合は先に ZIP を取り込むか、一度オンラインで取得してください。");
  }
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

function resolveOwnerName(item) {
  const ownerLogin =
    typeof item.owner === "string" ? item.owner : item.owner?.login || "";
  const full = item.full_name || item.fullName || (ownerLogin ? `${ownerLogin}/${item.name}` : item.name);
  const [owner, name] = full.includes("/") ? full.split("/", 2) : [ownerLogin, full];
  return { owner, name, full };
}

async function runRunnerItem(item, progress) {
  const { owner, name, full } = resolveOwnerName(item);
  if (isLocalRunnerItem(item) || owner === LOCAL_OWNER) {
    const dir = appCacheDir(owner, name);
    if (!hasLocalCache(owner, name)) {
      throw new Error("ローカルアプリが見つかりません。ZIP を再取り込みしてください。");
    }
    const result = await launchFromWorkspaceRoot(dir, { owner, name, fullName: full }, progress);
    void logRunnerActivity(full, "launch-local", { entry: result.entry });
    return result;
  }

  const cfg = getNoraOpsConfig();
  const log = (msg) => progress?.({ message: msg });
  const cached = hasLocalCache(owner, name);

  let detail = null;
  if (cfg.serverBaseUrl) {
    try {
      log("アプリ情報を取得…");
      detail = await fetchPublishedAppDetail(cfg.serverBaseUrl, owner, name);
    } catch (e) {
      if (!cached) throw e;
      log("オフライン — ローカルキャッシュから起動します…");
    }
  } else if (!cached) {
    throw new Error("サーバー URL が未設定で、ローカルキャッシュもありません。");
  }

  let workspaceRoot;
  if (detail) {
    const selectedTag =
      item.publishedTag || item.selectedTag || item.latestPublishedTag || detail.latestPublishedTag || "";
    if (selectedTag) detail.selectedTag = selectedTag;
    workspaceRoot = await ensureArtifactWorkspace(detail, log, {
      tag: selectedTag,
      version: item.selectedVersion || item.latestPublishedVersion || "",
    });
  } else {
    workspaceRoot = appCacheDir(owner, name);
  }

  const result = await launchFromWorkspaceRoot(
    workspaceRoot,
    { owner, name, fullName: detail?.full_name || full },
    progress
  );
  void logRunnerActivity(detail?.full_name || full, "launch", {
    entry: result.entry,
    projectDir: result.projectDir,
  });
  return result;
}

async function upgradePublishedApp(item, progress) {
  const cfg = getNoraOpsConfig();
  const log = (msg) => progress?.({ message: msg });
  const { owner, name, full } = resolveOwnerName(item);
  if (isLocalRunnerItem(item) || owner === LOCAL_OWNER) {
    throw new Error("ローカル ZIP アプリはサーバー更新の対象外です。ZIP を差し替えて再取り込みしてください。");
  }
  log("最新版を取得しています…");
  const detail = await fetchPublishedAppDetail(cfg.serverBaseUrl, owner, name);
  await ensureArtifactWorkspace(detail, log, { force: true });
  return { ok: true, owner, name, fullName: detail.full_name || full, sha: detail.artifactSha };
}

module.exports = {
  runPublishedApp: runRunnerItem,
  runRunnerItem,
  upgradePublishedApp,
  ensureArtifactWorkspace,
  findProjectDir,
  appCacheDir,
  runnerAppsRoot,
  launchFromWorkspaceRoot,
};
