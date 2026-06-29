const fs = require("fs");
const path = require("path");
const { getPythonEnvStatus } = require("./pythonEnv");
const { isMockReady } = require("./mockPrompts");
const { resolveScaffoldRoot, noraJoin } = require("./scaffold");
const { pyprojectPath, hasPyproject } = require("./projectPaths");

function detectCreatorProgress(workspaceRoot) {
  if (!workspaceRoot) {
    return {
      scaffold: false,
      hasDeps: false,
      pythonReady: false,
      hasLaunch: false,
      readme: false,
      mockReady: false,
      hasDevMain: false,
    };
  }
  const root = resolveScaffoldRoot(workspaceRoot);
  const manifestPath = noraJoin(workspaceRoot, "manifest.json");
  const pyPath = hasPyproject(workspaceRoot) ? pyprojectPath(workspaceRoot) : null;
  const launchPath = path.join(root, ".vscode", "launch.json");
  const readmePath = path.join(root, "README.md");

  const scaffold =
    fs.existsSync(manifestPath) ||
    fs.existsSync(noraJoin(workspaceRoot, "mock", "spec.json")) ||
    fs.existsSync(path.join(root, "main.py")) ||
    fs.existsSync(noraJoin(workspaceRoot, "dev", "main.py")) ||
    !!pyPath;
  let hasDeps = false;
  let depCount = 0;
  let depNames = [];
  if (pyPath) {
    const parsed = parsePyprojectDependencies(pyPath);
    depCount = parsed.count;
    depNames = parsed.names;
    hasDeps = depCount > 0;
  }

  const py = getPythonEnvStatus(workspaceRoot);
  const mockReady = isMockReady(workspaceRoot);
  const { devMainPath } = require("./devPrompts");
  const devMainFile = devMainPath(workspaceRoot);
  let hasDevMain = false;
  if (fs.existsSync(devMainFile)) {
    try {
      const t = fs.readFileSync(devMainFile, "utf8");
      hasDevMain =
        t.trim().length > 80 &&
        !/AI が生成したコードでこのファイルを置き換え/.test(t);
    } catch {
      /* ignore */
    }
  }
  return {
    scaffold,
    hasDeps,
    depCount,
    depNames,
    pyprojectPath: pyPath ? path.relative(workspaceRoot, pyPath).replace(/\\/g, "/") : null,
    pythonReady: py.ready,
    hasLaunch: fs.existsSync(launchPath),
    readme: fs.existsSync(readmePath),
    mockReady,
    hasDevMain,
  };
}

/** pyproject.toml の dependencies を数える（1行/multiline 両対応） */
function parsePyprojectDependencies(pyPath) {
  const names = [];
  try {
    const text = fs.readFileSync(pyPath, "utf8");
    const quoted = [...text.matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
    let inDeps = false;
    let depth = 0;
    for (const line of text.split(/\r?\n/)) {
      if (!inDeps && /^\s*dependencies\s*=/.test(line)) {
        inDeps = true;
        depth += bracketDelta(line);
        extractDepNamesFromLine(line, names);
        if (depth <= 0 && line.includes("]")) {
          inDeps = false;
        }
        continue;
      }
      if (inDeps) {
        extractDepNamesFromLine(line, names);
        depth += bracketDelta(line);
        if (depth <= 0) inDeps = false;
      }
    }
    if (!names.length) {
      const block = text.match(/dependencies\s*=\s*\[([\s\S]*?)\]/);
      if (block) extractDepNamesFromLine(block[1], names);
    }
  } catch {
    /* ignore */
  }
  const uniq = [...new Set(names.map((n) => n.split(/[<>=!\[\]]/)[0].trim()).filter(Boolean))];
  return { count: uniq.length, names: uniq };
}

function bracketDelta(line) {
  return (line.match(/\[/g) || []).length - (line.match(/\]/g) || []).length;
}

function extractDepNamesFromLine(line, out) {
  for (const m of line.matchAll(/["']([a-zA-Z0-9_.-]+)/g)) {
    const pkg = m[1];
    if (pkg && !pkg.startsWith("#")) out.push(pkg);
  }
}

module.exports = { detectCreatorProgress, parsePyprojectDependencies };
