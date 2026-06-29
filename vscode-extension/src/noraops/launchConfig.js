const fs = require("fs");
const path = require("path");

const NORAOPS_PREFIX = "NoraOps:";

/** ユーザーのコード位置を優先。NoraOps は見つかった入口を F5 に使うだけ */
function detectPythonEntry(workspaceRoot) {
  const { resolveScaffoldRoot } = require("./scaffold");
  const scaffoldRoot = resolveScaffoldRoot(workspaceRoot);
  const wsFolder = path.resolve(workspaceRoot);
  const candidates = [
    { rel: "main.py", label: "main.py" },
    { rel: "nora/dev/main.py", label: "nora/dev/main.py" },
    { rel: "nora/packages/main.py", label: "nora/packages/main.py" },
    { rel: "src/main.py", label: "src/main.py" },
  ];
  for (const c of candidates) {
    const absEntry = path.join(scaffoldRoot, c.rel);
    if (!fs.existsSync(absEntry)) continue;
    const relFromWs = path.relative(wsFolder, absEntry).replace(/\\/g, "/");
    const program = `\${workspaceFolder}/${relFromWs}`;
    const entryDir = path.dirname(absEntry);
    let cwdRel = path.relative(wsFolder, entryDir).replace(/\\/g, "/");
    if (!cwdRel || cwdRel === ".") {
      return {
        program,
        cwd: "${workspaceFolder}",
        label: c.label,
        canonical: c.rel.startsWith("nora/"),
      };
    }
    return {
      program,
      cwd: `\${workspaceFolder}/${cwdRel}`,
      label: c.label,
      canonical: c.rel.startsWith("nora/"),
    };
  }
  return null;
}

function readLaunchJson(launchPath) {
  try {
    if (fs.existsSync(launchPath)) {
      return JSON.parse(fs.readFileSync(launchPath, "utf8"));
    }
  } catch {
    /* ignore */
  }
  return { version: "0.2.0", configurations: [] };
}

function buildNoraOpsConfigurations(entry) {
  const main = {
    name: `${NORAOPS_PREFIX} アプリを実行 (F5)`,
    type: "debugpy",
    request: "launch",
    program: entry.program,
    cwd: entry.cwd,
    console: "integratedTerminal",
    justMyCode: true,
  };
  const currentFile = {
    name: `${NORAOPS_PREFIX} 現在のファイル (F5)`,
    type: "debugpy",
    request: "launch",
    program: "${file}",
    cwd: "${fileDirname}",
    console: "integratedTerminal",
    justMyCode: true,
  };
  return [main, currentFile];
}

/**
 * NoraOps 用 launch 構成を先頭に置く（既存の Attach 専用構成は残す）。
 * @returns {{ updated: boolean, entry: string | null }}
 */
function ensureLaunchConfig(workspaceRoot) {
  const { resolveScaffoldRoot } = require("./scaffold");
  const root = resolveScaffoldRoot(workspaceRoot);
  const entry = detectPythonEntry(workspaceRoot);
  if (!entry) return { updated: false, entry: null };

  const vscodeDir = path.join(root, ".vscode");
  const launchPath = path.join(vscodeDir, "launch.json");
  const json = readLaunchJson(launchPath);
  const configs = Array.isArray(json.configurations) ? json.configurations : [];

  const withoutNora = configs.filter((c) => !String(c?.name || "").startsWith(NORAOPS_PREFIX));
  const noraConfigs = buildNoraOpsConfigurations(entry);
  json.configurations = [...noraConfigs, ...withoutNora];
  json.version = "0.2.0";

  fs.mkdirSync(vscodeDir, { recursive: true });
  fs.writeFileSync(launchPath, JSON.stringify(json, null, 2) + "\n", "utf8");
  return { updated: true, entry: entry.label };
}

function isLikelyNoraOpsWorkspace(workspaceRoot) {
  const { resolveScaffoldRoot, noraJoin } = require("./scaffold");
  const { readPythonEnvMeta } = require("./workspaceStore");
  const root = resolveScaffoldRoot(workspaceRoot);
  return (
    fs.existsSync(noraJoin(workspaceRoot, "manifest.json")) ||
    !!readPythonEnvMeta(workspaceRoot) ||
    fs.existsSync(path.join(root, ".nora", "python-env.json")) ||
    fs.existsSync(noraJoin(workspaceRoot, "packages", "pyproject.toml")) ||
    (fs.existsSync(path.join(root, "main.py")) && fs.existsSync(path.join(root, "pyproject.toml")))
  );
}

module.exports = { detectPythonEntry, ensureLaunchConfig, isLikelyNoraOpsWorkspace };
