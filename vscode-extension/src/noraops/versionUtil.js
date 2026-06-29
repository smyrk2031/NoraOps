const fs = require("fs");
const path = require("path");

function packagesDir(workspaceRoot) {
  return path.join(workspaceRoot, "nora", "packages");
}

function pyprojectPath(workspaceRoot) {
  return path.join(packagesDir(workspaceRoot), "pyproject.toml");
}

function readVersion(workspaceRoot) {
  const p = pyprojectPath(workspaceRoot);
  if (!fs.existsSync(p)) return "0.1.0";
  const text = fs.readFileSync(p, "utf8");
  const m = text.match(/^version\s*=\s*"([^"]+)"/m);
  return m ? m[1] : "0.1.0";
}

function bumpProjectPatchVersion(workspaceRoot) {
  const p = pyprojectPath(workspaceRoot);
  let version = readVersion(workspaceRoot);
  const parts = version.split(".").map((n) => parseInt(n, 10) || 0);
  while (parts.length < 3) parts.push(0);
  parts[2] += 1;
  version = parts.join(".");
  if (fs.existsSync(p)) {
    let text = fs.readFileSync(p, "utf8");
    if (/^version\s*=/m.test(text)) {
      text = text.replace(/^version\s*=\s*"[^"]*"/m, `version = "${version}"`);
    } else {
      text += `\nversion = "${version}"\n`;
    }
    fs.writeFileSync(p, text, "utf8");
  }
  const manifestPath = path.join(workspaceRoot, "nora", "manifest.json");
  if (fs.existsSync(manifestPath)) {
    try {
      const man = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      man.version = version;
      fs.writeFileSync(manifestPath, JSON.stringify(man, null, 2), "utf8");
    } catch {
      /* ignore */
    }
  }
  const tag = version.startsWith("v") ? version : `v${version}`;
  return { version, tag };
}

function writeProjectVersion(workspaceRoot, version) {
  const raw = String(version || "").trim().replace(/^v/i, "");
  if (!raw) return readVersion(workspaceRoot);
  const p = pyprojectPath(workspaceRoot);
  if (fs.existsSync(p)) {
    let text = fs.readFileSync(p, "utf8");
    if (/^version\s*=/m.test(text)) {
      text = text.replace(/^version\s*=\s*"[^"]*"/m, `version = "${raw}"`);
    } else {
      text += `\nversion = "${raw}"\n`;
    }
    fs.writeFileSync(p, text, "utf8");
  }
  const manifestPath = path.join(workspaceRoot, "nora", "manifest.json");
  if (fs.existsSync(manifestPath)) {
    try {
      const man = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      man.version = raw;
      fs.writeFileSync(manifestPath, JSON.stringify(man, null, 2), "utf8");
    } catch {
      /* ignore */
    }
  }
  const tag = raw.startsWith("v") ? raw : `v${raw}`;
  return { version: raw, tag };
}

module.exports = { bumpProjectPatchVersion, readVersion, writeProjectVersion };
