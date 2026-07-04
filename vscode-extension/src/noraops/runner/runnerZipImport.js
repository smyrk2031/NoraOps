const fs = require("fs");
const os = require("os");
const path = require("path");
const { expandZip } = require("../artifactDownload");
const { resolvePyproject } = require("../pyprojectResolve");
const { resolveAppEntry } = require("../appEntry");
const { classifyForSave } = require("../workspaceZip");
const { appCacheDir } = require("./runnerPaths");
const { writeLocalArtifactMeta } = require("./runnerArtifactCache");
const { LOCAL_OWNER, uniqueSlug, registerLocalApp, toRunnerItem } = require("../localRunnerRegistry");

const MAX_ZIP_BYTES = 50 * 1024 * 1024;

function scanExtractedTree(rootDir) {
  const issues = [];
  let hasPyproject = false;
  function walk(dir, relBase) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const rel = relBase ? `${relBase}/${ent.name}` : ent.name;
      const posix = rel.replace(/\\/g, "/");
      const verdict = classifyForSave(posix, ent.isDirectory());
      if (!verdict.included) {
        issues.push(`${posix}: ${verdict.reason}`);
        continue;
      }
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full, rel);
      else if (ent.name === "pyproject.toml") hasPyproject = true;
    }
  }
  walk(rootDir, "");
  return { issues, hasPyproject };
}

function assertZipFile(zipPath) {
  if (!zipPath || !fs.existsSync(zipPath)) {
    throw new Error("ZIP ファイルが見つかりません。");
  }
  const stat = fs.statSync(zipPath);
  if (!stat.isFile()) throw new Error("ZIP ではありません。");
  if (stat.size > MAX_ZIP_BYTES) {
    throw new Error(`ZIP が大きすぎます（上限 ${MAX_ZIP_BYTES / (1024 * 1024)}MB）。`);
  }
  if (stat.size < 32) throw new Error("ZIP が空に近いです。");
}

/**
 * @param {string} zipPath
 * @param {string} displayName
 */
async function importRunnerZip(zipPath, displayName) {
  assertZipFile(zipPath);
  const title = String(displayName || path.basename(zipPath, ".zip")).trim();
  if (!title) throw new Error("表示名が必要です。");

  const slug = uniqueSlug(title, require("../localRunnerRegistry").listLocalApps());
  const dest = appCacheDir(LOCAL_OWNER, slug);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "noraops-import-"));

  try {
    await expandZip(zipPath, tmp);
    const scan = scanExtractedTree(tmp);
    if (scan.issues.length) {
      throw new Error(`ZIP に含めてはいけないファイルがあります:\n${scan.issues.slice(0, 5).join("\n")}`);
    }
    const resolved = resolvePyproject(tmp);
    if (!resolved.ok) {
      throw new Error("pyproject.toml が見つかりません（ルート・直下 1 階層・nora/packages を探索）。");
    }
    const entry = resolveAppEntry(tmp, resolved.projectDir);
    if (!entry) {
      throw new Error("nora/manifest.json の起動エントリが見つかりません。");
    }

    if (fs.existsSync(dest)) {
      fs.rmSync(dest, { recursive: true, force: true });
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(tmp, dest);
    writeLocalArtifactMeta(LOCAL_OWNER, slug, `local:${Date.now()}`);

    const reg = registerLocalApp({ displayName: title, slug, sourceZip: zipPath });
    return {
      ok: true,
      slug,
      workspaceRoot: dest,
      entry: entry.label,
      item: toRunnerItem(reg),
    };
  } finally {
    try {
      if (fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

module.exports = {
  importRunnerZip,
  MAX_ZIP_BYTES,
};
