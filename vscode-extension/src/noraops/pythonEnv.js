const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");
const { buildChildProcessEnv } = require("./httpEnv");
const vscode = require("vscode");
const { resolveUvExe } = require("./toolInstaller");
const { writeWorkspaceSession, readWorkspaceSession, packageNameSlug } = require("./pathsMeta");
const { readPythonEnvMeta, writePythonEnvMeta, writeWorkspaceRecord } = require("./workspaceStore");
const {
  packagesDir,
  pyprojectPath,
  defaultWorkspaceVenvDir,
  venvProbeCandidates,
  venvPythonExe,
  probeExistingVenvDir,
} = require("./projectPaths");
const { runnerEnvDirFromWorkspace } = require("./runner/runnerPaths");

function noraOpsVenvRoot() {
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  return path.join(base, "NoraOps", "venvs");
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** 例: myapp_250519143045 */
function formatVenvDirName(workspaceRoot) {
  const base = path.basename(path.resolve(workspaceRoot));
  const safe = base.replace(/[<>:"/\\|?*]/g, "_").replace(/\s+/g, "_").slice(0, 50) || "app";
  const d = new Date();
  const ts =
    pad2(d.getFullYear() % 100) +
    pad2(d.getMonth() + 1) +
    pad2(d.getDate()) +
    pad2(d.getHours()) +
    pad2(d.getMinutes()) +
    pad2(d.getSeconds());
  return `${safe}_${ts}`;
}

function allocateVenvDir(workspaceRoot) {
  return path.join(noraOpsVenvRoot(), formatVenvDirName(workspaceRoot));
}

/** 既存 venv（meta 記録）があればそのパス、なければ null */
function venvRootFromPythonExe(pythonExe) {
  if (!pythonExe) return null;
  const resolved = path.resolve(pythonExe);
  const scriptsDir = path.dirname(resolved);
  const base = path.basename(scriptsDir).toLowerCase();
  if (base === "scripts" || base === "bin") {
    return path.resolve(scriptsDir, "..");
  }
  return null;
}

function resolveExistingVenvDir(workspaceRoot) {
  const meta = readEnvMeta(workspaceRoot);
  if (meta?.venvDir && fs.existsSync(venvPythonExe(meta.venvDir))) {
    return meta.venvDir;
  }
  const fromExe = venvRootFromPythonExe(meta?.python);
  if (fromExe && fs.existsSync(venvPythonExe(fromExe))) {
    return fromExe;
  }
  return probeExistingVenvDir(workspaceRoot);
}

function collectVenvDirsToRemove(workspaceRoot) {
  const meta = readEnvMeta(workspaceRoot);
  const dirs = new Set();
  if (meta?.venvDir) dirs.add(path.resolve(meta.venvDir));
  const existing = resolveExistingVenvDir(workspaceRoot);
  if (existing) dirs.add(path.resolve(existing));
  const fromExe = venvRootFromPythonExe(meta?.python);
  if (fromExe) dirs.add(path.resolve(fromExe));
  for (const c of venvProbeCandidates(workspaceRoot)) {
    dirs.add(path.resolve(c));
  }
  const runnerEnv = runnerEnvDirFromWorkspace(workspaceRoot);
  if (runnerEnv) dirs.add(path.resolve(runnerEnv));
  return [...dirs];
}

function getDirSizeBytes(dirPath) {
  if (!dirPath || !fs.existsSync(dirPath)) return 0;
  let total = 0;
  const stack = [dirPath];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const full = path.join(current, ent.name);
      if (ent.isDirectory()) stack.push(full);
      else if (ent.isFile()) {
        try {
          total += fs.statSync(full).size;
        } catch {
          /* ignore */
        }
      }
    }
  }
  return total;
}

function formatMb(bytes) {
  return (Number(bytes || 0) / 1048576).toFixed(1);
}

function formatDuration(ms) {
  const n = Math.max(0, Number(ms) || 0);
  if (n < 1000) return `${Math.round(n)} ミリ秒`;
  const sec = Math.round(n / 1000);
  if (sec < 60) return `約 ${sec} 秒`;
  return `約 ${Math.floor(sec / 60)} 分 ${sec % 60} 秒`;
}

function venvDirFor(workspaceRoot) {
  if (isRunnerCacheWorkspace(workspaceRoot)) {
    const runnerEnv = runnerEnvDirFromWorkspace(workspaceRoot);
    if (runnerEnv) {
      const existing = resolveExistingVenvDir(workspaceRoot);
      if (existing && fs.existsSync(venvPythonExe(existing))) return existing;
      return runnerEnv;
    }
    return resolveExistingVenvDir(workspaceRoot) || allocateVenvDir(workspaceRoot);
  }
  const existing = resolveExistingVenvDir(workspaceRoot);
  if (existing && fs.existsSync(venvPythonExe(existing))) return existing;
  return defaultWorkspaceVenvDir(workspaceRoot);
}

/** Runner キャッシュ（%LOCALAPPDATA%\\NoraOps\\runner-apps）では VS Code 連携をしない */
function isRunnerCacheWorkspace(workspaceRoot) {
  const norm = path.resolve(workspaceRoot).replace(/\\/g, "/").toLowerCase();
  return norm.includes("/noraops/runner-apps/");
}

function envMetaPath(workspaceRoot) {
  return path.join(workspaceRoot, ".nora", "python-env.json");
}

function readEnvMeta(workspaceRoot) {
  return readPythonEnvMeta(workspaceRoot);
}

function writeEnvMeta(workspaceRoot, meta) {
  const payload = writePythonEnvMeta(workspaceRoot, meta);
  try {
    writeWorkspaceSession(workspaceRoot, { pythonEnvReady: true, pythonExe: meta.python });
  } catch {
    /* session は補助。失敗しても venv は有効 */
  }
  return payload;
}

function resolveUvExecutable() {
  const fromRuntime = resolveUvExe();
  if (fromRuntime) return fromRuntime;
  return "uv";
}

let activePythonProcess = null;

function getSetupTimeoutMs() {
  const cfg = vscode.workspace.getConfiguration("noraops");
  const minutes = Number(cfg.get("python.setupTimeoutMinutes", 15));
  const safe = Number.isFinite(minutes) && minutes > 0 ? minutes : 15;
  return safe * 60 * 1000;
}

function showPythonOutputChannel() {
  const ch = getPythonOutputChannel();
  if (ch) ch.show(true);
}

function getPythonOutputChannel() {
  const { getPythonOutputChannel: getChannel } = require("./outputChannels");
  return getChannel();
}

function cancelActivePythonSetup() {
  if (activePythonProcess && !activePythonProcess.killed) {
    try {
      activePythonProcess.kill();
    } catch {
      /* ignore */
    }
    activePythonProcess = null;
    const ch = getPythonOutputChannel();
    if (ch) ch.appendLine("[NoraOps] ユーザーによりキャンセルしました。");
  }
}

function runCmdStreaming(exe, args, options = {}) {
  const {
    cwd,
    log,
    timeoutMs = getSetupTimeoutMs(),
    label = "実行中",
    showOutput = true,
    env: extraEnv,
  } = options;
  const channel = getPythonOutputChannel();
  if (!channel) {
    return Promise.reject(new Error("NoraOps Python ログが初期化されていません。ウィンドウを再読み込みしてください。"));
  }
  if (showOutput) channel.show(true);

  return new Promise((resolve, reject) => {
    const started = Date.now();
    channel.appendLine("");
    channel.appendLine(`=== ${label} ===`);
    channel.appendLine(`$ "${exe}" ${args.join(" ")}`);
    channel.appendLine(`cwd: ${cwd || process.cwd()}`);
    if (extraEnv?.UV_PROJECT_ENVIRONMENT) {
      channel.appendLine(`UV_PROJECT_ENVIRONMENT: ${extraEnv.UV_PROJECT_ENVIRONMENT}`);
    }

    const child = spawn(exe, args, {
      cwd,
      windowsHide: true,
      env: buildChildProcessEnv(extraEnv || {}),
    });
    activePythonProcess = child;

    let stdout = "";
    let stderr = "";
    let lastUi = 0;

    const heartbeat = setInterval(() => {
      const sec = Math.round((Date.now() - started) / 1000);
      log?.(`${label}… ${sec} 秒経過（ログ: 出力 → NoraOps Python）`);
    }, 3000);

    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            cancelActivePythonSetup();
            reject(
              new Error(
                `${label}がタイムアウトしました（${Math.round(timeoutMs / 60000)} 分）。` +
                  ` 出力パネル「NoraOps Python」で uv の止まっている箇所を確認してください。`
              )
            );
          }, timeoutMs)
        : null;

    const onData = (chunk, isErr) => {
      const text = chunk.toString();
      if (isErr) stderr += text;
      else stdout += text;
      for (const line of text.split(/\r?\n/)) {
        const t = line.trim();
        if (t) channel.appendLine(t);
      }
      if (log && Date.now() - lastUi > 2500) {
        const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        const tail = lines[lines.length - 1];
        if (tail) log(`${label}: ${tail.slice(0, 100)}`);
        lastUi = Date.now();
      }
    };

    child.stdout?.on("data", (c) => onData(c, false));
    child.stderr?.on("data", (c) => onData(c, true));

    child.on("error", (err) => {
      clearInterval(heartbeat);
      if (timer) clearTimeout(timer);
      activePythonProcess = null;
      reject(err);
    });

    child.on("close", (code) => {
      clearInterval(heartbeat);
      if (timer) clearTimeout(timer);
      activePythonProcess = null;
      const sec = Math.round((Date.now() - started) / 1000);
      channel.appendLine(`--- exit ${code} (${sec}s) ---`);
      if (code === 0) resolve(stdout.trim());
      else {
        const detail = (stderr || stdout || "").trim().slice(0, 3000);
        reject(new Error(detail || `${label} failed (exit ${code})`));
      }
    });
  });
}

function readVsCodeSettings(workspaceRoot) {
  const settingsPath = path.join(workspaceRoot, ".vscode", "settings.json");
  try {
    if (fs.existsSync(settingsPath)) {
      return JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    }
  } catch {
    /* ignore */
  }
  return {};
}

function writeVsCodeSettings(workspaceRoot, patch) {
  const dir = path.join(workspaceRoot, ".vscode");
  fs.mkdirSync(dir, { recursive: true });
  const settingsPath = path.join(dir, "settings.json");
  const current = readVsCodeSettings(workspaceRoot);
  const next = { ...current, ...patch };
  fs.writeFileSync(settingsPath, JSON.stringify(next, null, 2) + "\n", "utf8");
}

function pathsEquivalent(a, b) {
  if (!a || !b) return false;
  try {
    return path.normalize(String(a)) === path.normalize(String(b));
  } catch {
    return String(a).replace(/\\/g, "/").toLowerCase() === String(b).replace(/\\/g, "/").toLowerCase();
  }
}

async function setWorkspaceInterpreter(workspaceRoot, pythonExe, options = {}) {
  const folderUri = vscode.Uri.file(workspaceRoot);
  const abs = path.resolve(pythonExe);
  const venvRoot = noraOpsVenvRoot();

  const settingsPatch = {
    "python.defaultInterpreterPath": abs,
    "python.terminal.activateEnvironment": true,
    "python.venvFolders": [venvRoot],
  };
  writeVsCodeSettings(workspaceRoot, settingsPatch);

  try {
    const pyCfg = vscode.workspace.getConfiguration("python", folderUri);
    await pyCfg.update("defaultInterpreterPath", abs, vscode.ConfigurationTarget.WorkspaceFolder);
    await pyCfg.update("terminal.activateEnvironment", true, vscode.ConfigurationTarget.WorkspaceFolder);
    await pyCfg.update("venvFolders", [venvRoot], vscode.ConfigurationTarget.WorkspaceFolder);
  } catch {
    /* ignore */
  }

  let setViaCommand = false;
  if (options.usePythonCommand !== false) {
    const uri = vscode.Uri.file(abs);
    for (const arg of [uri, abs]) {
      try {
        await vscode.commands.executeCommand("python.setInterpreter", arg);
        setViaCommand = true;
        break;
      } catch {
        /* ms-python optional / コマンドが UI を開く場合もある */
      }
    }
  }

  const prev = readEnvMeta(workspaceRoot) || {};
  writeEnvMeta(workspaceRoot, {
    ...prev,
    python: abs,
    venvDir: prev.venvDir || venvRootFromPythonExe(abs),
    interpreterConfiguredAt: new Date().toISOString(),
  });

  return { ok: true, path: abs, setViaCommand };
}

/** ワークスペースを開いたとき等 — UI を出さず settings だけ当てる */
async function autoConfigureInterpreter(workspaceRoot) {
  const st = getPythonEnvStatus(workspaceRoot);
  if (!st.exists || !st.pythonExe) return { ok: false, reason: "no_venv" };
  if (st.interpreterMatches) return { ok: true, skipped: true };
  return setWorkspaceInterpreter(workspaceRoot, st.pythonExe, { usePythonCommand: false });
}

function uvProjectEnv(venvDir) {
  const base = { UV_PROJECT_ENVIRONMENT: path.resolve(venvDir) };
  try {
    const { getPypiIndexEnv } = require("./packageAllowlist");
    return { ...base, ...getPypiIndexEnv() };
  } catch {
    return base;
  }
}

/** uv sync --python は .venv を作ってしまうため、NoraOps 外部 venv では UV_PROJECT_ENVIRONMENT を使う */
async function removeStrayProjectDotVenv(projectDir, venvDir, log) {
  const stray = path.join(projectDir, ".venv");
  if (!fs.existsSync(stray)) return false;
  if (path.resolve(stray) === path.resolve(venvDir)) return false;
  log?.("プロジェクト内の余分な .venv を削除しています（NoraOps 管理の venv に統一）…");
  await fs.promises.rm(stray, { recursive: true, force: true });
  return true;
}

async function verifyInstalledProjectDeps(workspaceRoot, pythonExe, venvDir, projectDir, uv, log) {
  const { parsePyprojectDependencyNames, normalizePkgName } = require("./pyprojectDeps");
  const declared = parsePyprojectDependencyNames(pyprojectPath(workspaceRoot));
  if (!declared.length) return { missingInstalled: [], declared: [] };

  const listOut = await runCmdStreaming(uv, ["pip", "list", "--python", pythonExe], {
    cwd: projectDir,
    showOutput: false,
    timeoutMs: 120000,
    label: "パッケージ確認",
    env: uvProjectEnv(venvDir),
  });
  const packages = parsePipListOutput(listOut);
  const installed = new Set(packages.map((p) => normalizePkgName(p.name)));
  const missing = declared
    .filter((name) => !installed.has(name))
    .map((name) => ({ importName: name, packageName: name }));
  if (missing.length) {
    log?.(`警告: pyproject の依存が venv に見つかりません: ${missing.map((m) => m.packageName).join(", ")}`);
  }
  return { missingInstalled: missing, declared, packages };
}

function repairPyprojectPackageName(workspaceRoot) {
  const pyPath = pyprojectPath(workspaceRoot);
  if (!fs.existsSync(pyPath)) return null;
  const text = fs.readFileSync(pyPath, "utf8");
  const m = text.match(/^name\s*=\s*"([^"]*)"/m);
  if (!m) return null;
  const current = m[1];
  const fixed = packageNameSlug(current);
  if (current === fixed) return null;
  const next = text.replace(/^name\s*=\s*"[^"]*"/m, `name = "${fixed}"`);
  fs.writeFileSync(pyPath, next, "utf8");
  return { from: current, to: fixed };
}

async function ensurePythonEnv(workspaceRoot, options = {}) {
  const projectDir = packagesDir(workspaceRoot);
  const pyproject = pyprojectPath(workspaceRoot);
  if (!options.skipAllowlistWarn) {
    try {
      const { warnUnapprovedBeforeEnv } = require("./packageAllowlist");
      await warnUnapprovedBeforeEnv(workspaceRoot);
    } catch {
      /* allowlist warn は補助 */
    }
  }
  if (!fs.existsSync(pyproject)) {
    return {
      ok: false,
      reason: "no_pyproject",
      message: `${require("./projectPaths").pyprojectRelPath(workspaceRoot)} がありません。先に保存して雛形を作るか、フォルダを確認してください。`,
    };
  }

  const repaired = repairPyprojectPackageName(workspaceRoot);
  if (repaired) {
    options.log?.(
      `pyproject.toml の name を修正しました: "${repaired.from}" → "${repaired.to}"（uv は ASCII 名のみ）`
    );
  }

  const uv = resolveUvExecutable();
  try {
    await runCmdStreaming(uv, ["--version"], {
      cwd: workspaceRoot,
      label: "uv 確認",
      showOutput: false,
      timeoutMs: 30000,
      log: options.log,
    });
  } catch {
    return {
      ok: false,
      reason: "no_uv",
      message:
        "uv が見つかりません。「NoraOps: ツールをセットアップ（uv）」を実行するか、PATH に uv を追加してください。",
    };
  }

  const t0 = Date.now();
  const venvDir = venvDirFor(workspaceRoot);
  const pythonExe = venvPythonExe(venvDir);
  const createdNew = !fs.existsSync(pythonExe);
  const log = options.log || (() => {});

  fs.mkdirSync(path.dirname(venvDir), { recursive: true });
  if (isRunnerCacheWorkspace(workspaceRoot)) {
    const { runnerEnvsRoot } = require("./runner/runnerPaths");
    fs.mkdirSync(runnerEnvsRoot(), { recursive: true });
  }

  let venvCreateMs = 0;
  if (!fs.existsSync(pythonExe)) {
    log(`仮想環境を作成しています（${path.basename(venvDir)}）…`);
    const tVenv = Date.now();
    await runCmdStreaming(uv, ["venv", venvDir], {
      cwd: workspaceRoot,
      label: `venv 作成 (${path.basename(venvDir)})`,
      log,
    });
    venvCreateMs = Date.now() - tVenv;
  }

  log("パッケージを同期しています (uv sync)…pyproject.toml の dependencies をこのアプリの .venv に入れます");
  if (isRunnerCacheWorkspace(workspaceRoot)) {
    await removeStrayProjectDotVenv(projectDir, venvDir, log);
  }
  const tSync = Date.now();
  await runCmdStreaming(uv, ["sync", "-v"], {
    cwd: projectDir,
    label: "uv sync",
    log,
    env: uvProjectEnv(venvDir),
  });
  const syncMs = Date.now() - tSync;
  const totalMs = Date.now() - t0;

  const { findUndeclaredImportsForWorkspace, findMissingInstalled } = require("./pyprojectDeps");
  const undeclared = findUndeclaredImportsForWorkspace(workspaceRoot, packagesDir, pyprojectPath);
  let missingInstalled = [];
  let installedPackages = [];
  try {
    const verified = await verifyInstalledProjectDeps(
      workspaceRoot,
      pythonExe,
      venvDir,
      projectDir,
      uv,
      log
    );
    missingInstalled = verified.missingInstalled;
    installedPackages = verified.packages || [];
  } catch {
    /* pip list 失敗時は import ベースのみ */
  }
  if (undeclared.length) {
    const fromImports = installedPackages.length
      ? findMissingInstalled(installedPackages, undeclared)
      : undeclared;
    const seen = new Set(missingInstalled.map((m) => m.packageName));
    for (const item of fromImports) {
      if (!seen.has(item.packageName)) {
        missingInstalled.push(item);
        seen.add(item.packageName);
      }
    }
  }

  log("サイズを計測しています…");
  const venvSizeBytes = getDirSizeBytes(venvDir);

  const meta = writeEnvMeta(workspaceRoot, {
    venvDir,
    venvName: path.basename(venvDir),
    python: pythonExe,
    projectDir,
    uv,
    createdNew,
    lastSetupMs: totalMs,
    lastVenvCreateMs: venvCreateMs,
    lastSyncMs: syncMs,
    venvSizeBytes,
    packageCount: installedPackages.length,
  });

  let interpreter = { ok: false, skipped: true };
  const skipEditor = options.skipEditorIntegration || isRunnerCacheWorkspace(workspaceRoot);
  if (!skipEditor) {
    interpreter = await setWorkspaceInterpreter(workspaceRoot, pythonExe, { usePythonCommand: false });
    try {
      const { ensureLaunchConfig } = require("./launchConfig");
      ensureLaunchConfig(workspaceRoot);
    } catch {
      /* launch.json は補助 */
    }
  }
  const result = {
    ok: true,
    meta,
    interpreter,
    stats: {
      totalMs,
      venvCreateMs,
      syncMs,
      venvSizeBytes,
      createdNew,
    },
    undeclaredImports: undeclared,
    missingInstalled,
    installedPackages,
  };
  try {
    const { auditAfterSync } = require("./packageAllowlist");
    await auditAfterSync(workspaceRoot, result);
  } catch {
    /* deps audit は補助 */
  }
  return result;
}

function getPythonEnvStatus(workspaceRoot) {
  const pyproject = pyprojectPath(workspaceRoot);
  const meta = readEnvMeta(workspaceRoot);
  const venvDir = resolveExistingVenvDir(workspaceRoot);
  const pythonExe = venvDir ? venvPythonExe(venvDir) : meta?.python || null;
  const exists = !!(pythonExe && fs.existsSync(pythonExe));
  const hasPyproject = fs.existsSync(pyproject);
  const settings = readVsCodeSettings(workspaceRoot);
  const configuredPath = settings["python.defaultInterpreterPath"] || null;
  const stale = !!(meta && !exists);

  let interpreterMatches = false;
  if (exists && pythonExe) {
    interpreterMatches =
      pathsEquivalent(configuredPath, pythonExe) ||
      pathsEquivalent(readEnvMeta(workspaceRoot)?.python, pythonExe);
  }

  let sizeMb = null;
  let sizeBytes = 0;
  if (exists && venvDir) {
    sizeBytes = meta?.venvSizeBytes || getDirSizeBytes(venvDir);
    sizeMb = formatMb(sizeBytes);
  }

  const setupDurationLabel = meta?.lastSetupMs ? formatDuration(meta.lastSetupMs) : null;
  const venvCreateLabel = meta?.lastVenvCreateMs ? formatDuration(meta.lastVenvCreateMs) : null;
  const syncLabel = meta?.lastSyncMs ? formatDuration(meta.lastSyncMs) : null;

  return {
    ready: exists && hasPyproject,
    exists,
    hasPyproject,
    stale,
    meta: exists ? { ...meta, python: pythonExe, venvDir: venvDir || meta?.venvDir } : meta,
    pythonExe: exists ? pythonExe : null,
    venvDir: exists ? venvDir : null,
    venvName: exists ? meta?.venvName || (venvDir ? path.basename(venvDir) : null) : null,
    sizeMb,
    sizeBytes,
    setupDurationLabel,
    venvCreateLabel,
    syncLabel,
    packageCount: meta?.packageCount ?? null,
    interpreterMatches,
    configuredPath: exists ? configuredPath : null,
    updatedAt: meta?.updatedAt || null,
  };
}

async function removePythonEnv(workspaceRoot, options = {}) {
  const dirs = collectVenvDirsToRemove(workspaceRoot);
  let freedBytes = 0;
  for (const dir of dirs) {
    if (fs.existsSync(dir)) {
      freedBytes += getDirSizeBytes(dir);
      try {
        await fs.promises.rm(dir, { recursive: true, force: true });
      } catch (e) {
        throw new Error(`venv の削除に失敗しました: ${dir}\n${e.message}`);
      }
    }
  }
  const metaFile = envMetaPath(workspaceRoot);
  if (fs.existsSync(metaFile)) {
    await fs.promises.unlink(metaFile);
  }
  writeWorkspaceRecord(workspaceRoot, { pythonEnv: null });
  if (!options.keepInterpreterSetting) {
    const settingsPath = path.join(workspaceRoot, ".vscode", "settings.json");
    if (fs.existsSync(settingsPath)) {
      const current = readVsCodeSettings(workspaceRoot);
      delete current["python.defaultInterpreterPath"];
      fs.writeFileSync(settingsPath, JSON.stringify(current, null, 2) + "\n", "utf8");
    }
    try {
      const pyCfg = vscode.workspace.getConfiguration("python", vscode.Uri.file(workspaceRoot));
      await pyCfg.update("defaultInterpreterPath", undefined, vscode.ConfigurationTarget.Workspace);
    } catch {
      /* ignore */
    }
  }
  try {
    writeWorkspaceSession(workspaceRoot, { pythonEnvReady: false, pythonExe: null });
  } catch {
    /* ignore */
  }
  return { ok: true, freedBytes, removedDirs: dirs };
}

function parsePipListOutput(text) {
  const packages = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("Package") || /^-+$/.test(t.replace(/\s/g, ""))) continue;
    const m = t.match(/^(\S+)\s+(\S+)/);
    if (m) packages.push({ name: m[1], version: m[2] });
  }
  packages.sort((a, b) => a.name.localeCompare(b.name));
  return packages;
}

async function listPythonPackages(workspaceRoot) {
  const st = getPythonEnvStatus(workspaceRoot);
  if (!st.exists || !st.pythonExe) {
    return {
      ok: false,
      message: "Python 環境がありません。先に「用意する」を実行してください。",
      packages: [],
    };
  }
  const uv = resolveUvExecutable();
  const projectDir = packagesDir(workspaceRoot);
  try {
    const output = await runCmdStreaming(uv, ["pip", "list", "--python", st.pythonExe], {
      cwd: projectDir,
      showOutput: false,
      timeoutMs: 120000,
      label: "パッケージ一覧",
      env: st.venvDir ? uvProjectEnv(st.venvDir) : undefined,
    });
    const packages = parsePipListOutput(output);
    return { ok: true, packages, pythonExe: st.pythonExe, count: packages.length };
  } catch (e) {
    return { ok: false, message: String(e.message || e), packages: [] };
  }
}

async function showPythonPackagesQuickPick(workspaceRoot) {
  const result = await listPythonPackages(workspaceRoot);
  if (!result.ok) {
    vscode.window.showWarningMessage(result.message || "パッケージ一覧を取得できませんでした。");
    return result;
  }
  if (!result.packages.length) {
    vscode.window.showInformationMessage("インストールされているパッケージはありません。");
    return result;
  }
  const items = result.packages.map((p) => ({
    label: p.name,
    description: p.version,
    detail: `${p.name}==${p.version}`,
  }));
  await vscode.window.showQuickPick(items, {
    title: `インストール済みパッケージ（${result.count} 件）`,
    placeHolder: "閲覧のみ（選択しても何も起きません）",
    matchOnDescription: true,
    matchOnDetail: true,
  });
  return result;
}

async function recreatePythonEnv(workspaceRoot, options = {}) {
  await removePythonEnv(workspaceRoot, { keepInterpreterSetting: true });
  return ensurePythonEnv(workspaceRoot, options);
}

async function showNoPyprojectGuidance(workspaceRoot) {
  const { buildPyprojectPrompt } = require("./copilotPrompts");
  const promptText = buildPyprojectPrompt(workspaceRoot);

  const pick = await vscode.window.showWarningMessage(
    `まだ ${require("./projectPaths").pyprojectRelPath(workspaceRoot)} がありません。最初は無くて普通です。`,
    { modal: true, detail: "Copilot 等にプロンプトをコピーして渡すと作ってもらえます。できたらもう一度「Python 環境を用意する」を押してください。" },
    "プロンプトをコピー",
    "プロンプトを開く",
    "雛形を自動で入れる"
  );

  if (pick === "プロンプトをコピー") {
    await vscode.env.clipboard.writeText(promptText);
    vscode.window.showInformationMessage(
      "プロンプトをクリップボードにコピーしました。Copilot / Cursor のチャットに貼り付けてください。"
    );
    return { ok: false, reason: "no_pyproject", guided: true };
  }

  if (pick === "プロンプトを開く") {
    const doc = await vscode.workspace.openTextDocument({
      content: `# NoraOps → 生成 AI 用プロンプト\n\n${promptText}\n`,
      language: "markdown",
    });
    await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside });
    const copy = await vscode.window.showInformationMessage(
      "右のタブにプロンプトを表示しました。",
      "全文をコピー"
    );
    if (copy === "全文をコピー") {
      await vscode.env.clipboard.writeText(promptText);
      vscode.window.showInformationMessage("コピーしました。AI チャットに貼り付けてください。");
    }
    return { ok: false, reason: "no_pyproject", guided: true };
  }

  if (pick === "雛形を自動で入れる") {
    const { ensurePyprojectScaffold } = require("./scaffold");
    const r = ensurePyprojectScaffold(workspaceRoot);
    if (r.created.length) {
      vscode.window.showInformationMessage(`雛形を追加しました: ${r.created.join(", ")}`);
    }
    return ensurePythonEnvWithUi(workspaceRoot, { skipNoPyprojectPrompt: true });
  }

  return { ok: false, reason: "no_pyproject", cancelled: true };
}

function formatSetupStats(stats) {
  if (!stats) return "";
  const lines = [
    `合計: ${formatDuration(stats.totalMs)}`,
    stats.venvCreateMs > 0 ? `venv 作成: ${formatDuration(stats.venvCreateMs)}` : null,
    `uv sync: ${formatDuration(stats.syncMs)}`,
    `ディスク使用量: 約 ${formatMb(stats.venvSizeBytes)} MB`,
  ].filter(Boolean);
  return lines.join("\n");
}

async function addPythonPackagesWithUv(workspaceRoot, packageNames, options = {}) {
  const projectDir = packagesDir(workspaceRoot);
  const pyproject = pyprojectPath(workspaceRoot);
  if (!fs.existsSync(pyproject)) {
    return { ok: false, message: `${require("./projectPaths").pyprojectRelPath(workspaceRoot)} がありません。` };
  }
  const uv = resolveUvExecutable();
  const st = getPythonEnvStatus(workspaceRoot);
  const venvDir = st.venvDir || resolveExistingVenvDir(workspaceRoot);
  if (!venvDir) {
    return { ok: false, message: "仮想環境がありません。先に「用意する」を実行してください。" };
  }
  const args = ["add", ...packageNames];
  const log = options.log || (() => {});
  log(`pyproject.toml に追加: ${packageNames.join(", ")}`);
  await runCmdStreaming(uv, args, {
    cwd: projectDir,
    label: "uv add",
    log,
    env: uvProjectEnv(venvDir),
  });
  try {
    const { syncRequirementsFromPyproject } = require("./scaffold");
    syncRequirementsFromPyproject(workspaceRoot);
  } catch {
    /* ignore */
  }
  return { ok: true, packages: packageNames };
}

async function showMissingDepsGuidance(workspaceRoot, result) {
  const missing = result.missingInstalled || result.undeclaredImports || [];
  if (!missing.length) return;

  const names = [...new Set(missing.map((m) => m.packageName))];
  const pyRel = require("./projectPaths").pyprojectRelPath(workspaceRoot);
  const detail =
    `main.py で import している ${names.join(", ")} は、pyproject.toml の dependencies に書かないと uv sync では入りません。\n\n` +
    `対処: ${pyRel} に追加するか、下のボタンで自動追加してください。`;

  const pick = await vscode.window.showWarningMessage(
    `パッケージが未インストールです: ${names.join(", ")}`,
    { modal: true, detail },
    "pyproject に追加して同期",
    "手順を表示",
    "閉じる"
  );

  if (pick === "pyproject に追加して同期") {
    showPythonOutputChannel();
    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "NoraOps: パッケージ追加",
        cancellable: false,
      },
      async (progress) => {
        const report = (msg) => progress.report({ message: msg });
        try {
          await addPythonPackagesWithUv(workspaceRoot, names, { log: report });
          const again = await ensurePythonEnv(workspaceRoot, { log: report });
          if (again.ok) await showPythonEnvResult(workspaceRoot, again);
          return again;
        } catch (e) {
          vscode.window.showErrorMessage(`パッケージ追加に失敗: ${e.message}`, "ログを開く").then((p) => {
            if (p === "ログを開く") showPythonOutputChannel();
          });
          return { ok: false, message: String(e.message || e) };
        }
      }
    );
  }

  if (pick === "手順を表示") {
    const doc = await vscode.workspace.openTextDocument({
      content: `# numpy / scipy を使う手順（NoraOps）

1. **${pyRel}** を開く
2. \`dependencies\` に追加:
   \`\`\`toml
   dependencies = ["numpy", "scipy"]
   \`\`\`
3. NoraOps ホームの **「パッケージ同期」** を押す（= uv sync）
4. **F5** または NoraOps の launch で **main.py** を実行

※ main.py に \`import numpy\` だけ書いても、pyproject に無ければ入りません。
`,
      language: "markdown",
    });
    await vscode.window.showTextDocument(doc, { preview: false });
  }
}

async function showPythonEnvResult(workspaceRoot, result) {
  if (!result.ok) return result;

  await showMissingDepsGuidance(workspaceRoot, result);
  if (result.missingInstalled?.length) return result;

  const py = result.meta.python;
  const statsText = formatSetupStats(result.stats);
  const interp = result.interpreter?.setViaCommand
    ? "エディタの Python インタプリタを設定しました。"
    : "`.vscode/settings.json` に Python パスを書き込みました（Python 拡張があれば選択が反映されます）。";

  const pick = await vscode.window.showInformationMessage(
    `Python 環境の準備が完了しました。\n${interp}`,
    { modal: true, detail: `${statsText}\n\n${py}` },
    "パスをコピー",
    "インタプリタを再設定",
    "閉じる"
  );
  if (pick === "パスをコピー") {
    await vscode.env.clipboard.writeText(py);
    vscode.window.showInformationMessage("python.exe のパスをコピーしました。");
  }
  if (pick === "インタプリタを再設定") {
    await setWorkspaceInterpreter(workspaceRoot, py);
    vscode.window.showInformationMessage("インタプリタを設定しました。");
  }
  return result;
}

async function ensurePythonEnvWithUi(workspaceRoot, options = {}) {
  const pyproject = pyprojectPath(workspaceRoot);
  if (!fs.existsSync(pyproject) && !options.skipNoPyprojectPrompt) {
    return showNoPyprojectGuidance(workspaceRoot);
  }

  const { postPythonProgress } = options;
  showPythonOutputChannel();
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "NoraOps: Python 環境",
      cancellable: true,
    },
    async (progress, token) => {
      const report = (msg) => {
        progress.report({ message: msg });
        postPythonProgress?.({ message: msg });
      };
      token.onCancellationRequested(() => cancelActivePythonSetup());
      try {
        const result = await ensurePythonEnv(workspaceRoot, { log: report });
        if (!result.ok) {
          if (result.reason === "no_pyproject" && !options.skipNoPyprojectPrompt) {
            return showNoPyprojectGuidance(workspaceRoot);
          }
          vscode.window.showErrorMessage(result.message || "Python 環境の準備に失敗しました。", {
            modal: true,
          });
          return result;
        }
        await showPythonEnvResult(workspaceRoot, result);
        return result;
      } catch (e) {
        if (token.isCancellationRequested) {
          vscode.window.showWarningMessage("Python 環境のセットアップをキャンセルしました。");
          return { ok: false, cancelled: true };
        }
        const msg = String(e.message || e);
        vscode.window.showErrorMessage(`Python 環境の準備に失敗: ${msg}`, "ログを開く").then((pick) => {
          if (pick === "ログを開く") showPythonOutputChannel();
        });
        return { ok: false, message: msg };
      }
    }
  );
}

async function copyPythonPath(workspaceRoot) {
  const st = getPythonEnvStatus(workspaceRoot);
  if (!st.pythonExe) {
    vscode.window.showWarningMessage("まだ Python 環境がありません。「用意する」を実行してください。");
    return false;
  }
  await vscode.env.clipboard.writeText(st.pythonExe);
  vscode.window.showInformationMessage(`コピーしました:\n${st.pythonExe}`);
  return true;
}

async function removePythonEnvWithConfirm(workspaceRoot) {
  const st = getPythonEnvStatus(workspaceRoot);
  if (!st.exists && !st.meta && !st.stale) {
    vscode.window.showInformationMessage("削除する Python 環境がありません。");
    return { ok: false, notice: "削除する環境がありません" };
  }
  const sizeHint = st.sizeMb ? `（約 ${st.sizeMb} MB）` : "";
  const pick = await vscode.window.showWarningMessage(
    `このワークスペース用の仮想環境（venv）を削除しますか？${sizeHint}`,
    { modal: true, detail: st.venvDir || st.meta?.python || "" },
    "削除",
    "キャンセル"
  );
  if (pick !== "削除") return { ok: false, cancelled: true };
  const removed = await removePythonEnv(workspaceRoot);
  const freed = formatMb(removed.freedBytes);
  const notice = `削除しました（解放: 約 ${freed} MB）`;
  vscode.window.showInformationMessage(`${notice}。「用意する」で再作成できます。`);
  return { ok: true, notice, freedBytes: removed.freedBytes };
}

async function recreatePythonEnvWithUi(workspaceRoot, options = {}) {
  const { postPythonProgress } = options;
  const pick = await vscode.window.showWarningMessage(
    "仮想環境を作り直します（削除 → 新しい名前で venv → uv sync）。",
    { modal: true },
    "作り直す",
    "キャンセル"
  );
  if (pick !== "作り直す") return { ok: false, cancelled: true };

  showPythonOutputChannel();
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "NoraOps: Python 環境を作り直し",
      cancellable: true,
    },
    async (progress, token) => {
      const report = (msg) => {
        progress.report({ message: msg });
        postPythonProgress?.({ message: msg });
      };
      token.onCancellationRequested(() => cancelActivePythonSetup());
      try {
        report("既存環境を削除…");
        await removePythonEnv(workspaceRoot, { keepInterpreterSetting: true });
        report("新しい venv を作成…");
        const result = await ensurePythonEnv(workspaceRoot, { log: report });
        if (!result.ok) {
          vscode.window.showErrorMessage(result.message || "作り直しに失敗しました。", { modal: true });
          return result;
        }
        await showPythonEnvResult(workspaceRoot, result);
        return result;
      } catch (e) {
        if (token.isCancellationRequested) {
          vscode.window.showWarningMessage("作り直しをキャンセルしました。");
          return { ok: false, cancelled: true };
        }
        vscode.window.showErrorMessage(String(e.message || e), "ログを開く").then((pick) => {
          if (pick === "ログを開く") showPythonOutputChannel();
        });
        return { ok: false, message: String(e.message || e) };
      }
    }
  );
}

module.exports = {
  ensurePythonEnv,
  ensurePythonEnvWithUi,
  uvProjectEnv,
  getPythonEnvStatus,
  setWorkspaceInterpreter,
  autoConfigureInterpreter,
  removePythonEnv,
  removePythonEnvWithConfirm,
  recreatePythonEnv,
  recreatePythonEnvWithUi,
  copyPythonPath,
  venvDirFor,
  resolveExistingVenvDir,
  allocateVenvDir,
  formatVenvDirName,
  formatMb,
  formatDuration,
  showPythonOutputChannel,
  cancelActivePythonSetup,
  listPythonPackages,
  showPythonPackagesQuickPick,
  addPythonPackagesWithUv,
  noraOpsVenvRoot,
  pyprojectPath,
};
