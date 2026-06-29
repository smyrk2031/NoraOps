/**
 * pyproject.toml の探索・優先度（Creator / Runner / ポリシー共通）
 *
 * 探索範囲: ワークスペースルート + 直下 1 階層（レガシー nora/packages は互換で明示）
 * 優先度:
 *   1. nora/manifest.json packagesProject（存在する場合）
 *   2. ルート pyproject.toml
 *   3. nora/packages/pyproject.toml（旧レイアウト）
 *   4. 直下サブディレクトリ（app, backend, src … → その他は名前順）
 *
 * @see NoraOps/互換方針.md
 */

const fs = require("fs");
const path = require("path");
const { resolveScaffoldRoot } = require("./scaffold");

const PYPROJECT_FILE = "pyproject.toml";
const LEGACY_PACKAGES_REL = "nora/packages";

/** 探索しない直下フォルダ */
const SKIP_SUBDIRS = new Set([
  ".git",
  ".nora",
  ".venv",
  "venv",
  "node_modules",
  "__pycache__",
  "dist",
  "build",
  ".vscode",
  "static",
  "media",
  "logs",
  "assets",
]);

/** 同階層で複数あるときの優先サブディレクトリ名 */
const PREFERRED_SUBDIRS = ["app", "backend", "server", "src", "api", "web", "python"];

const PRIORITY = {
  manifest: 0,
  root: 10,
  legacy: 20,
  shallowBase: 30,
};

function normalizeRelPosix(rel) {
  if (!rel || rel === "." || rel === "./") return ".";
  return String(rel).replace(/\\/g, "/").replace(/\/+$/, "");
}

function packagesProjectRel(manifest) {
  const raw = manifest?.packagesProject;
  if (raw == null || raw === "" || raw === ".") return ".";
  return normalizeRelPosix(raw);
}

function projectDirFromRel(appRoot, rel) {
  if (rel === ".") return appRoot;
  return path.join(appRoot, rel);
}

function pyprojectRelFromDirRel(dirRel) {
  return dirRel === "." ? PYPROJECT_FILE : `${dirRel}/${PYPROJECT_FILE}`;
}

function shallowSubdirPriority(name) {
  const lower = name.toLowerCase();
  const idx = PREFERRED_SUBDIRS.indexOf(lower);
  return idx >= 0 ? idx : 1000;
}

/**
 * @param {string} workspaceRoot
 * @param {{ manifest?: object | null, readManifest?: boolean }} [options]
 * @returns {Array<{ dirRel: string, pyprojectRel: string, source: string, priority: number }>}
 */
function discoverPyprojectCandidates(workspaceRoot, options = {}) {
  const appRoot = resolveScaffoldRoot(workspaceRoot);
  if (!appRoot || !fs.existsSync(appRoot)) return [];

  let manifest = options.manifest;
  if (manifest === undefined && options.readManifest !== false) {
    try {
      const { readNoraManifest } = require("./appEntry");
      manifest = readNoraManifest(appRoot);
    } catch {
      manifest = null;
    }
  }

  const candidates = [];
  const seen = new Set();

  const push = (dirRel, source, priority) => {
    const norm = normalizeRelPosix(dirRel);
    const dir = projectDirFromRel(appRoot, norm);
    const py = path.join(dir, PYPROJECT_FILE);
    if (!fs.existsSync(py)) return;
    const key = norm;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({
      dirRel: norm,
      pyprojectRel: pyprojectRelFromDirRel(norm),
      source,
      priority,
    });
  };

  if (manifest?.packagesProject != null && String(manifest.packagesProject).trim() !== "") {
    push(packagesProjectRel(manifest), "manifest", PRIORITY.manifest);
  }

  push(".", "root", PRIORITY.root);
  push(LEGACY_PACKAGES_REL, "legacy", PRIORITY.legacy);

  let entries;
  try {
    entries = fs.readdirSync(appRoot, { withFileTypes: true });
  } catch {
    entries = [];
  }

  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    if (SKIP_SUBDIRS.has(ent.name)) continue;
    if (ent.name === "nora") continue;
    const subPriority = PRIORITY.shallowBase + shallowSubdirPriority(ent.name);
    push(ent.name, "shallow", subPriority);
  }

  candidates.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.dirRel.localeCompare(b.dirRel);
  });

  return candidates;
}

/**
 * @param {string} workspaceRoot
 * @param {{ manifest?: object | null, readManifest?: boolean }} [options]
 */
function resolvePyproject(workspaceRoot, options = {}) {
  const appRoot = resolveScaffoldRoot(workspaceRoot);
  const candidates = discoverPyprojectCandidates(workspaceRoot, options);

  if (!candidates.length) {
    return {
      ok: false,
      appRoot,
      projectDir: appRoot,
      pyprojectPath: path.join(appRoot, PYPROJECT_FILE),
      pyprojectRel: PYPROJECT_FILE,
      source: null,
      candidates: [],
      ambiguous: false,
    };
  }

  const chosen = candidates[0];
  const projectDir = projectDirFromRel(appRoot, chosen.dirRel);

  return {
    ok: true,
    appRoot,
    projectDir,
    pyprojectPath: path.join(projectDir, PYPROJECT_FILE),
    pyprojectRel: chosen.pyprojectRel,
    source: chosen.source,
    candidates,
    ambiguous: candidates.length > 1,
    alternateRels: candidates.slice(1).map((c) => c.pyprojectRel),
  };
}

function hasResolvedPyproject(workspaceRoot, options = {}) {
  return resolvePyproject(workspaceRoot, options).ok;
}

module.exports = {
  PYPROJECT_FILE,
  LEGACY_PACKAGES_REL,
  SKIP_SUBDIRS,
  PREFERRED_SUBDIRS,
  PRIORITY,
  packagesProjectRel,
  discoverPyprojectCandidates,
  resolvePyproject,
  hasResolvedPyproject,
};
