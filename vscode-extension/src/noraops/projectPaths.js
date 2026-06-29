/**
 * ワークスpace内 pyproject / venv の解決（ルート優先、旧 nora/packages 互換）
 * @see NoraOps/互換方針.md
 * @see pyprojectResolve.js
 */

const fs = require("fs");
const path = require("path");
const { resolveScaffoldRoot } = require("./scaffold");
const { resolvePyproject, LEGACY_PACKAGES_REL } = require("./pyprojectResolve");

function workspaceAppRoot(workspaceRoot) {
  return resolveScaffoldRoot(workspaceRoot);
}

/** uv プロジェクトディレクトリ（pyproject.toml の所在） */
function packagesDir(workspaceRoot) {
  const resolved = resolvePyproject(workspaceRoot);
  if (resolved.ok) return resolved.projectDir;
  return workspaceAppRoot(workspaceRoot);
}

function pyprojectPath(workspaceRoot) {
  const resolved = resolvePyproject(workspaceRoot);
  if (resolved.ok) return resolved.pyprojectPath;
  return path.join(workspaceAppRoot(workspaceRoot), "pyproject.toml");
}

function hasPyproject(workspaceRoot) {
  return resolvePyproject(workspaceRoot).ok;
}

/** 新規 venv の既定位置（Creator） */
function defaultWorkspaceVenvDir(workspaceRoot) {
  return path.join(workspaceAppRoot(workspaceRoot), ".venv");
}

/** 既存 venv を探す候補（優先順） */
function venvProbeCandidates(workspaceRoot) {
  const root = workspaceAppRoot(workspaceRoot);
  return [
    path.join(root, ".venv"),
    path.join(root, LEGACY_PACKAGES_REL, ".venv"),
  ];
}

function venvPythonExe(venvDir) {
  const sub = process.platform === "win32" ? ["Scripts", "python.exe"] : ["bin", "python"];
  return path.join(venvDir, ...sub);
}

/** 最初に python.exe が見つかった venv、なければ null */
function probeExistingVenvDir(workspaceRoot) {
  for (const dir of venvProbeCandidates(workspaceRoot)) {
    const exe = venvPythonExe(dir);
    if (fs.existsSync(exe)) return dir;
  }
  return null;
}

/** UI 表示用（ルート優先の相対パス） */
function pyprojectRelPath(workspaceRoot) {
  const root = workspaceAppRoot(workspaceRoot);
  const resolved = resolvePyproject(workspaceRoot);
  if (!resolved.ok) return "pyproject.toml";
  return path.relative(root, resolved.pyprojectPath).replace(/\\/g, "/");
}

module.exports = {
  workspaceAppRoot,
  packagesDir,
  pyprojectPath,
  hasPyproject,
  pyprojectRelPath,
  defaultWorkspaceVenvDir,
  venvProbeCandidates,
  venvPythonExe,
  probeExistingVenvDir,
  LEGACY_PACKAGES_REL,
};
