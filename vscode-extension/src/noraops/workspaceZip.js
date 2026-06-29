const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

const { isDevRuntimeDataPath, RUNTIME_SUBDIRS } = require("./runtimeDataFilter");

const EXCLUDE_DIRS = new Set([
  ".git",
  ".venv",
  "venv",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  "node_modules",
  ".nora",
]);
const EXCLUDE_FILES = new Set([".env", ".env.local", ".env.production"]);

function classifyForSave(relPath, isDir) {
  const norm = String(relPath).replace(/\\/g, "/");
  const parts = norm.split("/").filter(Boolean);
  for (const p of parts) {
    if (EXCLUDE_DIRS.has(p)) {
      return { included: false, reason: `除外フォルダ「${p}」` };
    }
  }
  if (isDir) return { included: true, reason: null };

  const base = parts[parts.length - 1] || norm;
  if (EXCLUDE_FILES.has(base) || base.startsWith(".env.")) {
    return { included: false, reason: "秘密情報 (.env)" };
  }
  if (base.endsWith(".pem") || base.endsWith(".key") || base.endsWith(".p12")) {
    return { included: false, reason: "秘密鍵ファイル" };
  }
  if (isDevRuntimeDataPath(norm)) {
    const sub = norm.match(/^nora\/dev\/(static|media)\/([^/]+)/);
    if (sub && RUNTIME_SUBDIRS.has(sub[2])) {
      return { included: false, reason: "アップロード用フォルダ (uploads/ 等)" };
    }
    return { included: false, reason: "実行時データ (static/media のバイナリ)" };
  }
  return { included: true, reason: null };
}

function shouldSkip(relPath, isDir) {
  return !classifyForSave(relPath, isDir).included;
}

function collectFiles(workspaceRoot) {
  const files = [];
  function walk(dir, relBase) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const rel = relBase ? `${relBase}/${ent.name}` : ent.name;
      if (shouldSkip(rel, ent.isDirectory())) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full, rel);
      else files.push({ rel: rel.replace(/\\/g, "/"), full });
    }
  }
  walk(workspaceRoot, "");
  return files;
}

function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true }
    );
    let err = "";
    child.stderr.on("data", (c) => (err += c));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(err.trim() || `PowerShell exit ${code}`));
    });
  });
}

/**
 * Create workspace zip (excludes .git, .venv, .env, etc.).
 */
async function createWorkspaceZip(workspaceRoot) {
  const root = path.resolve(workspaceRoot);
  const files = collectFiles(root);
  if (!files.length) {
    return { ok: false, reason: "empty_workspace", message: "アップロードするファイルがありません。" };
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "noraops-ws-"));
  const staging = path.join(tmpDir, "stage");
  fs.mkdirSync(staging, { recursive: true });
  for (const f of files) {
    const dest = path.join(staging, f.rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(f.full, dest);
  }

  const zipPath = path.join(tmpDir, "workspace.zip");
  const stagingEsc = staging.replace(/'/g, "''");
  const zipEsc = zipPath.replace(/'/g, "''");
  const script = `Compress-Archive -Path '${stagingEsc}\\*' -DestinationPath '${zipEsc}' -Force`;
  try {
    await runPowerShell(script);
  } catch (e) {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    return { ok: false, reason: "zip_failed", message: e.message || String(e) };
  }

  return { ok: true, zipPath, tmpDir, fileCount: files.length };
}

function removeWorkspaceZip(result) {
  if (!result?.tmpDir) return;
  try {
    fs.rmSync(result.tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

module.exports = {
  createWorkspaceZip,
  removeWorkspaceZip,
  collectFiles,
  shouldSkip,
  classifyForSave,
  EXCLUDE_DIRS,
};
