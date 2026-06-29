const fs = require("fs");
const path = require("path");

/**
 * Resolve the Python entry script for Runner / F5.
 * Priority: nora/manifest.json entry (workspace-relative) → common paths → pyproject [project.scripts]
 */
function readNoraManifest(workspaceRoot) {
  const { noraJoin } = require("./scaffold");
  const p = noraJoin(workspaceRoot, "manifest.json");
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function parsePyprojectScript(workspaceRoot, projectDir) {
  const pyPath = fs.existsSync(path.join(workspaceRoot, "pyproject.toml"))
    ? path.join(workspaceRoot, "pyproject.toml")
    : path.join(projectDir, "pyproject.toml");
  if (!fs.existsSync(pyPath)) return null;
  try {
    const text = fs.readFileSync(pyPath, "utf8");
    const block = text.match(/\[project\.scripts\][\s\S]*?(?=\n\[|\n*$)/);
    if (!block) return null;
    const line = block[0].match(/^\s*([a-zA-Z0-9_.-]+)\s*=\s*"([^"]+)"/m);
    if (!line) return null;
    const target = line[2];
    if (target.includes(":")) {
      const [mod, fn] = target.split(":");
      return { kind: "module", module: mod, attr: fn, label: `scripts:${line[1]}` };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function resolveAppEntry(workspaceRoot, projectDir) {
  const root = path.resolve(workspaceRoot);
  const proj = path.resolve(projectDir || root);
  const tried = [];
  const manifest = readNoraManifest(root);

  const pushCandidate = (rel) => {
    if (!rel) return;
    const norm = String(rel).replace(/\\/g, "/").replace(/^\.\//, "");
    tried.push(
      path.join(root, norm),
      path.join(proj, norm),
      path.join(root, path.basename(norm))
    );
    if (manifest?.packagesProject) {
      tried.push(path.join(root, manifest.packagesProject, norm));
      tried.push(path.join(root, manifest.packagesProject, path.basename(norm)));
    }
  };

  if (manifest?.entryKind === "module" && manifest.entryModule) {
    return {
      scriptPath: null,
      pyprojectScript: {
        kind: "module",
        module: manifest.entryModule,
        attr: "__main__",
      },
      label: `python -m ${manifest.entryModule}`,
      source: "nora/manifest.json (module)",
    };
  }

  if (manifest?.entry) pushCandidate(manifest.entry);

  for (const rel of [
    "main.py",
    "nora/dev/main.py",
    "app.py",
    "run.py",
    "src/main.py",
    "nora/packages/main.py",
  ]) {
    pushCandidate(rel);
  }

  const seen = new Set();
  for (const abs of tried) {
    const key = path.resolve(abs);
    if (seen.has(key)) continue;
    seen.add(key);
    if (fs.existsSync(key) && fs.statSync(key).isFile()) {
      return {
        scriptPath: key,
        label: path.relative(root, key).replace(/\\/g, "/"),
        source: manifest?.entry ? "nora/manifest.json" : "fallback",
      };
    }
  }

  const script = parsePyprojectScript(root, proj);
  if (script) {
    return { scriptPath: null, pyprojectScript: script, label: script.label, source: "pyproject.scripts" };
  }

  return null;
}

function formatEntryHint(workspaceRoot) {
  return (
    "起動用の .py が見つかりません。\n" +
    "nora/manifest.json の \"entry\" にワークスペースからの相対パス（例: main.py）を書いて保存してください。"
  );
}

module.exports = { readNoraManifest, resolveAppEntry, formatEntryHint };
