/** 既存アプリ公開（import）モード用チェックリスト */

const fs = require("fs");
const path = require("path");
const { detectCreatorProgress } = require("./creatorProgress");
const { resolveScaffoldRoot } = require("./scaffold");
const { hasNoraOpsRepoBinding } = require("./repoSetup");
const { readNoraManifest, resolveAppEntry } = require("./appEntry");
const { pyprojectPath, hasPyproject, packagesDir } = require("./projectPaths");

function hasEntryPoint(workspaceRoot) {
  const root = resolveScaffoldRoot(workspaceRoot);  const proj = packagesDir(workspaceRoot);
  const entry = resolveAppEntry(root, proj);
  if (!entry?.scriptPath || !fs.existsSync(entry.scriptPath)) return false;
  try {
    const t = fs.readFileSync(entry.scriptPath, "utf8");
    return t.trim().length > 40;
  } catch {
    return false;
  }
}

function entryDisplayPath(workspaceRoot) {
  const root = resolveScaffoldRoot(workspaceRoot);
  const man = readNoraManifest(root);
  if (man?.entry) return String(man.entry).replace(/\\/g, "/");
  const proj = packagesDir(workspaceRoot);
  const entry = resolveAppEntry(root, proj);
  if (entry?.scriptPath) {
    return path.relative(root, entry.scriptPath).replace(/\\/g, "/");
  }
  return "main.py";
}

function pyprojectDisplayPath(workspaceRoot) {
  const root = resolveScaffoldRoot(workspaceRoot);
  if (!hasPyproject(workspaceRoot)) return "pyproject.toml";
  return path.relative(root, pyprojectPath(workspaceRoot)).replace(/\\/g, "/");
}

function buildImportWizardState(workspaceRoot) {
  if (!workspaceRoot) {
    return { items: [], requiredDone: 0, requiredTotal: 0, ready: false };
  }

  const progress = detectCreatorProgress(workspaceRoot);
  const bound = hasNoraOpsRepoBinding(workspaceRoot);  const entryPath = entryDisplayPath(workspaceRoot);
  const pyPath = pyprojectDisplayPath(workspaceRoot);

  const items = [
    {
      id: "main",
      label: "起動用 Python ファイル",
      path: entryPath,
      desc: entryPath + " が読み取れること",
      required: true,
      ok: hasEntryPoint(workspaceRoot),
      action: null,
    },
    {
      id: "pyproject",
      label: "依存パッケージ",
      path: pyPath,
      desc: "pyproject.toml（Python から取得 · 手書き · AI どれでも可）",
      required: true,
      ok: hasPyproject(workspaceRoot) && progress.hasDeps,
      action: null,
    },
    {
      id: "readme",
      label: "README.md",
      path: "README.md",
      desc: "アプリの説明（公開時に表示されます）",
      required: true,
      ok: progress.readme,
      action: "openReadme",
    },
    {
      id: "python",
      label: "仮想環境",
      path: null,
      desc: "uv で .venv を用意",
      required: true,
      ok: progress.pythonReady,
      action: null,
    },
  ];

  const required = items.filter((it) => it.required);
  const requiredDone = required.filter((it) => it.ok).length;

  return {
    items,
    entryReady: hasEntryPoint(workspaceRoot),
    requiredDone,
    requiredTotal: required.length,
    ready: required.every((it) => it.ok),
    cloudBound: bound,
    summary:
      requiredDone === required.length
        ? "準備完了 — 保存タブから Gitea へ送れます"
        : `あと ${required.length - requiredDone} 項目 — 下の手順を進めてください`,
  };
}

module.exports = { buildImportWizardState };
