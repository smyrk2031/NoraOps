const fs = require("fs");
const path = require("path");
const { packageNameSlug } = require("./pathsMeta");
const { normalizeAppId, newAppId } = require("./appIdentity");
const { getCachedRuntimeConfig } = require("./runtimeConfig");

const EXTENSION_ROOT = path.join(__dirname, "..", "..");

const NORA_CHILD_DIRS = new Set(["dev", "mock", "packages", "assets"]);

/**
 * nora/ 以下を置くアプリのルート（ワークスペースフォルダ）を返す。
 * VS Code で nora/dev 等だけを開いていると nora/dev/nora/dev になるのを防ぐ。
 */
function resolveScaffoldRoot(workspaceRoot) {
  if (!workspaceRoot) return workspaceRoot;
  const abs = path.resolve(workspaceRoot);
  let cur = abs;
  for (let i = 0; i < 16; i++) {
    const base = path.basename(cur);
    if (base === "nora") {
      return path.dirname(cur);
    }
    if (NORA_CHILD_DIRS.has(base) && path.basename(path.dirname(cur)) === "nora") {
      return path.dirname(path.dirname(cur));
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return abs;
}

/** アプリルートからの nora/ 以下パス（例: noraJoin(ws, "dev", "main.py")） */
function noraJoin(workspaceRoot, ...segments) {
  return path.join(resolveScaffoldRoot(workspaceRoot), "nora", ...segments);
}

function writeIfMissing(filePath, content) {
  if (fs.existsSync(filePath)) return false;
  const norm = filePath.replace(/\\/g, "/");
  if (/\/nora\/(dev|mock|packages|assets)\/nora\//.test(norm)) {
    throw new Error(`不正な nora パス（二重階層）: ${filePath}`);
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
  return true;
}

function applyTemplate(relPath, vars) {
  const tplPath = path.join(EXTENSION_ROOT, "resources", "templates", relPath);
  let text = fs.readFileSync(tplPath, "utf8");
  for (const [k, v] of Object.entries(vars)) {
    text = text.split(`{{${k}}}`).join(String(v));
  }
  return text;
}

function readManifest(workspaceRoot) {
  const p = noraJoin(workspaceRoot, "manifest.json");
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    /* ignore */
  }
  return null;
}

function manifestVarsForProfile(vars, _profile) {
  return { ...vars, entry: "main.py", packagesProject: "." };
}

function buildScaffoldVars(workspaceRoot, options = {}) {
  const root = resolveScaffoldRoot(workspaceRoot);
  const folderName = path.basename(root);
  const man = readManifest(workspaceRoot);
  const displayName = options.displayName || man?.displayName || folderName;
  const appSlug = options.appSlug || packageNameSlug(displayName);
  const appIdFull = normalizeAppId(options.appId || man?.appId) || newAppId();
  const runtime = getCachedRuntimeConfig() || {};
  const pypiUrl = (runtime.pypiIndexUrl || "").trim();
  const pypiIndexBlock = pypiUrl
    ? `[[tool.uv.index]]\nurl = "${pypiUrl}"\ndefault = true\n\n[[tool.uv.index]]\nname = "pypi"\nurl = "https://pypi.org/simple"\n`
    : "# [[tool.uv.index]]\n# url = \"https://intranet/NoraOps/pypi/simple/\"\n# default = true\n";
  const base = { appId: appIdFull, displayName, appSlug, pypiIndexBlock };
  const { readCreatorProfile } = require("./creatorWorkflow");
  const profile = options.profile || readCreatorProfile(workspaceRoot);
  return manifestVarsForProfile(base, profile);
}

function ensureGitignoreAndReadme(workspaceRoot, vars) {
  const root = resolveScaffoldRoot(workspaceRoot);
  const created = [];
  const gitignoreTpl = path.join(EXTENSION_ROOT, "resources", "templates", "gitignore.default");
  if (writeIfMissing(path.join(root, ".gitignore"), fs.readFileSync(gitignoreTpl, "utf8"))) {
    created.push(".gitignore");
  }
  const readme = `# ${vars.displayName}\n\nこのアプリの説明を書いてください。\n`;
  if (writeIfMissing(path.join(root, "README.md"), readme)) created.push("README.md");
  return created;
}

function ensureRootAssetsDir(workspaceRoot) {
  const root = resolveScaffoldRoot(workspaceRoot);
  const assetsDir = path.join(root, "assets");
  const created = [];
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
    created.push("assets/");
  }
  const legacyAssets = noraJoin(workspaceRoot, "assets");
  if (!fs.existsSync(legacyAssets) && !created.length) {
    /* 旧 nora/assets のみ存在する場合は触らない */
  }
  return created;
}

function ensureRootPyproject(workspaceRoot, options = {}) {
  const { hasPyproject } = require("./projectPaths");
  const root = resolveScaffoldRoot(workspaceRoot);
  if (hasPyproject(workspaceRoot)) return { created: [] };
  const vars = buildScaffoldVars(workspaceRoot, options);
  const created = [];
  const pyPath = path.join(root, "pyproject.toml");
  if (writeIfMissing(pyPath, applyTemplate("pyproject.toml", vars))) {
    created.push("pyproject.toml");
  }
  return { created, ...vars };
}

/** 旧 nora/packages レイアウト（互換・既存リポ向け） */
function ensureLegacyPackagesScaffold(workspaceRoot, options = {}) {
  if (!workspaceRoot || !fs.existsSync(workspaceRoot)) {
    throw new Error("ワークスペースのパスが無効です。フォルダを開き直してください。");
  }
  const vars = buildScaffoldVars(workspaceRoot, options);
  const created = [];
  if (
    writeIfMissing(
      noraJoin(workspaceRoot, "packages", "pyproject.toml"),
      applyTemplate("nora/packages/pyproject.toml", vars)
    )
  ) {
    created.push("nora/packages/pyproject.toml");
  }
  const packagesDirPath = noraJoin(workspaceRoot, "packages");
  if (!fs.existsSync(packagesDirPath)) {
    fs.mkdirSync(packagesDirPath, { recursive: true });
  }
  return { created, ...vars };
}

/** 環境タブ・uv 用（ルート pyproject 優先、launch のみ） */
function ensurePyprojectScaffold(workspaceRoot, options = {}) {
  if (!workspaceRoot || !fs.existsSync(workspaceRoot)) {
    throw new Error("ワークスペースのパスが無効です。フォルダを開き直してください。");
  }
  const { readCreatorProfile, MODES } = require("./creatorWorkflow");
  const { hasPyproject } = require("./projectPaths");
  const profile = options.profile || readCreatorProfile(workspaceRoot);
  const created = [];

  let vars = buildScaffoldVars(workspaceRoot, options);
  if (!hasPyproject(workspaceRoot)) {
    const rootResult = ensureRootPyproject(workspaceRoot, { ...options, profile });
    created.push(...rootResult.created);
    vars = rootResult;
  }

  const { ensureLaunchConfig } = require("./launchConfig");
  const launch = ensureLaunchConfig(workspaceRoot);
  if (launch.updated) created.push(".vscode/launch.json");
  return { created, ...vars };
}

/** @deprecated alias */
function ensurePackagesScaffold(workspaceRoot, options = {}) {
  return ensurePyprojectScaffold(workspaceRoot, options);
}

/** クラウド保存用（manifest + ルート assets） */
function ensureManifestScaffold(workspaceRoot, options = {}) {
  if (!workspaceRoot || !fs.existsSync(workspaceRoot)) {
    throw new Error("ワークスペースのパスが無効です。フォルダを開き直してください。");
  }
  const { readCreatorProfile } = require("./creatorWorkflow");
  const profile = options.profile || readCreatorProfile(workspaceRoot);
  const vars = buildScaffoldVars(workspaceRoot, { ...options, profile });
  const manifestVars = manifestVarsForProfile(vars, profile);
  const created = [];
  if (
    writeIfMissing(
      noraJoin(workspaceRoot, "manifest.json"),
      applyTemplate("nora/manifest.json", manifestVars)
    )
  ) {
    created.push("nora/manifest.json");
  }
  created.push(...ensureRootAssetsDir(workspaceRoot));
  return { created, ...vars };
}

/** 保存時の最小 scaffold（プロファイル別） */
function ensurePublishScaffold(workspaceRoot, options = {}) {
  const { readCreatorProfile, MODES } = require("./creatorWorkflow");
  const profile = options.profile || readCreatorProfile(workspaceRoot);
  const vars = buildScaffoldVars(workspaceRoot, { ...options, profile });
  const created = [];
  created.push(...ensureManifestScaffold(workspaceRoot, { ...options, profile }).created);
  if (profile !== MODES.VENV_ONLY) {
    created.push(...ensureGitignoreAndReadme(workspaceRoot, vars));
  }
  return { created, ...vars };
}

/** import / fork 向け（dev・mock なし） */
function ensureImportScaffold(workspaceRoot, options = {}) {
  if (!workspaceRoot || !fs.existsSync(workspaceRoot)) {
    throw new Error("ワークスペースのパスが無効です。フォルダを開き直してください。");
  }
  const { MODES } = require("./creatorWorkflow");
  const profile = options.profile || MODES.IMPORT;
  const vars = buildScaffoldVars(workspaceRoot, { ...options, profile });
  const created = [];
  created.push(...ensureGitignoreAndReadme(workspaceRoot, vars));
  created.push(...ensureManifestScaffold(workspaceRoot, { ...options, profile }).created);
  created.push(...ensureRootPyproject(workspaceRoot, { ...options, profile }).created);
  const { ensureLaunchConfig } = require("./launchConfig");
  const launch = ensureLaunchConfig(workspaceRoot);
  if (launch.updated) created.push(".vscode/launch.json");
  return { created, ...vars };
}

/** greenfield（0→1）フル scaffold */
function ensureGreenfieldScaffold(workspaceRoot, options = {}) {
  if (!workspaceRoot || !fs.existsSync(workspaceRoot)) {
    throw new Error("ワークスペースのパスが無効です。フォルダを開き直してください。");
  }
  const { MODES } = require("./creatorWorkflow");
  const profile = options.profile || MODES.GREENFIELD;
  const vars = buildScaffoldVars(workspaceRoot, { ...options, profile });
  const created = [];

  created.push(...ensureGitignoreAndReadme(workspaceRoot, vars));
  created.push(...ensureManifestScaffold(workspaceRoot, { ...options, profile }).created);
  created.push(...ensureMockScaffold(workspaceRoot));
  created.push(...ensureDevScaffold(workspaceRoot, vars));
  created.push(...ensurePyprojectScaffold(workspaceRoot, { ...options, profile }).created);

  return { created, appId: vars.appId, displayName: vars.displayName, appSlug: vars.appSlug };
}

/** プロファイルに応じた scaffold 入口 */
function ensureScaffoldForProfile(workspaceRoot, options = {}) {
  const { readCreatorProfile, MODES, PROFILES } = require("./creatorWorkflow");
  const profile = options.profile || readCreatorProfile(workspaceRoot);
  if (profile === MODES.VENV_ONLY) {
    return { created: [], skipped: true, profile };
  }
  if (profile === MODES.IMPORT || profile === PROFILES.FORK) {
    return ensureImportScaffold(workspaceRoot, { ...options, profile: MODES.IMPORT });
  }
  return ensureGreenfieldScaffold(workspaceRoot, { ...options, profile: MODES.GREENFIELD });
}

/** @deprecated use ensureGreenfieldScaffold or ensureScaffoldForProfile */
function ensureWorkspaceScaffold(workspaceRoot, options = {}) {
  return ensureScaffoldForProfile(workspaceRoot, options);
}

function ensureDevScaffold(workspaceRoot, vars = {}) {
  const created = [];
  const root = resolveScaffoldRoot(workspaceRoot);
  const displayName = vars.displayName || path.basename(root);
  const tplVars = { displayName };
  for (const sub of ["logs", "media", "static"]) {
    const d = path.join(root, sub);
    if (!fs.existsSync(d)) {
      fs.mkdirSync(d, { recursive: true });
      created.push(`${sub}/`);
    }
  }
  for (const sub of ["static/uploads", "media/uploads"]) {
    const d = path.join(root, ...sub.split("/"));
    if (!fs.existsSync(d)) {
      fs.mkdirSync(d, { recursive: true });
      created.push(`${sub}/`);
    }
    const keep = path.join(d, ".gitkeep");
    if (writeIfMissing(keep, "")) created.push(`${sub}/.gitkeep`);
  }
  if (writeIfMissing(path.join(root, "main.py"), applyTemplate("main.py", tplVars))) {
    created.push("main.py");
  }
  return created;
}

function ensureMockScaffold(workspaceRoot) {
  const created = [];
  if (
    writeIfMissing(
      noraJoin(workspaceRoot, "mock", "index.html"),
      applyTemplate("nora/mock/index.html", {})
    )
  ) {
    created.push("nora/mock/index.html");
  }
  if (
    writeIfMissing(
      noraJoin(workspaceRoot, "mock", "spec.json"),
      applyTemplate("nora/mock/spec.json", {})
    )
  ) {
    created.push("nora/mock/spec.json");
  }
  const mockDir = noraJoin(workspaceRoot, "mock");
  if (!fs.existsSync(mockDir)) {
    fs.mkdirSync(mockDir, { recursive: true });
  }
  return created;
}

/** @deprecated use ensureWorkspaceScaffold */
function scaffoldWorkspace(workspaceRoot, opts) {
  return ensureWorkspaceScaffold(workspaceRoot, opts).created;
}

const SCAFFOLD_REL_PATHS = [
  "nora/manifest.json",
  "pyproject.toml",
  "main.py",
  "nora/packages/pyproject.toml",
  "nora/packages/main.py",
  "nora/packages/requirements.txt",
  "nora/mock/index.html",
  "nora/mock/spec.json",
  "nora/dev/main.py",
  ".vscode/launch.json",
];

function removeEmptyDirIfEmpty(dirPath) {
  try {
    if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory() && fs.readdirSync(dirPath).length === 0) {
      fs.rmdirSync(dirPath);
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

function removeWorkspaceScaffold(workspaceRoot) {
  const root = resolveScaffoldRoot(workspaceRoot);
  const removed = [];
  const skipped = [];
  for (const rel of SCAFFOLD_REL_PATHS) {
    const p = path.join(root, rel);
    if (!fs.existsSync(p)) continue;
    try {
      fs.unlinkSync(p);
      removed.push(rel);
    } catch (e) {
      skipped.push({ rel, error: e.message });
    }
  }
  const noraRoot = noraJoin(workspaceRoot);
  for (const sub of ["mock", "dev", "packages", "assets"]) {
    if (removeEmptyDirIfEmpty(path.join(noraRoot, sub))) removed.push(`nora/${sub}/`);
  }
  if (removeEmptyDirIfEmpty(noraRoot)) removed.push("nora/");
  const vscodeDir = path.join(root, ".vscode");
  if (removeEmptyDirIfEmpty(vscodeDir)) removed.push(".vscode/");
  return { removed, skipped };
}

function syncRequirementsFromPyproject(workspaceRoot) {
  const { pyprojectPath, packagesDir } = require("./projectPaths");
  const pyPath = pyprojectPath(workspaceRoot);
  const reqPath = path.join(packagesDir(workspaceRoot), "requirements.txt");
  if (!fs.existsSync(pyPath)) {
    return {
      ok: false,
      message: "pyproject.toml がありません。「Python 環境を用意する」から AI 用プロンプトをコピーできます。",
    };
  }
  const text = fs.readFileSync(pyPath, "utf8");
  const deps = [];
  const block = text.match(/dependencies\s*=\s*\[([\s\S]*?)\]/);
  if (block) {
    const inner = block[1];
    for (const m of inner.matchAll(/"([^"]+)"/g)) deps.push(m[1]);
  }
  const header =
    "# NoraOps: pyproject.toml から自動生成（uv の正本は pyproject.toml）\n";
  const body = deps.length ? deps.join("\n") + "\n" : "# （依存なし）\n";
  fs.mkdirSync(path.dirname(reqPath), { recursive: true });
  fs.writeFileSync(reqPath, header + body, "utf8");
  return { ok: true, count: deps.length };
}

module.exports = {
  scaffoldWorkspace,
  ensureWorkspaceScaffold,
  ensureGreenfieldScaffold,
  ensureImportScaffold,
  ensurePublishScaffold,
  ensureScaffoldForProfile,
  ensureManifestScaffold,
  ensurePackagesScaffold,
  ensurePyprojectScaffold,
  ensureMockScaffold,
  ensureDevScaffold,
  buildScaffoldVars,
  resolveScaffoldRoot,
  noraJoin,
  removeWorkspaceScaffold,
  SCAFFOLD_REL_PATHS,
  syncRequirementsFromPyproject,
};
