/**
 * %LOCALAPPDATA%\NoraOps 配下の venv / runner-apps / dev-apps を一覧・削除。
 */
const fs = require("fs");
const path = require("path");
const os = require("os");

const META_FILE = "storage-meta.json";

function noraOpsRoot() {
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  return path.join(base, "NoraOps");
}

function metaPath() {
  return path.join(noraOpsRoot(), META_FILE);
}

function loadMeta() {
  const p = metaPath();
  if (!fs.existsSync(p)) {
    return { favorites: {}, lastUsed: {} };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8"));
    return {
      favorites: raw.favorites || {},
      lastUsed: raw.lastUsed || {},
    };
  } catch {
    return { favorites: {}, lastUsed: {} };
  }
}

function saveMeta(meta) {
  const root = noraOpsRoot();
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(metaPath(), JSON.stringify(meta, null, 2), "utf8");
}

function dirSizeBytes(dirPath) {
  if (!fs.existsSync(dirPath)) return 0;
  let total = 0;
  const stack = [dirPath];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(full);
      else {
        try {
          total += fs.statSync(full).size;
        } catch {
          /* ignore */
        }
      }
    }
  }
  return total;
}

function scanSubdirs(parentDir, kind) {
  if (!fs.existsSync(parentDir)) return [];
  const meta = loadMeta();
  const entries = [];
  for (const name of fs.readdirSync(parentDir)) {
    if (name.startsWith(".")) continue;
    const full = path.join(parentDir, name);
    let st;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    const id = `${kind}:${name}`;
    const sizeBytes = dirSizeBytes(full);
    const mtimeMs = st.mtimeMs;
    const lastUsedMs = meta.lastUsed[id] || mtimeMs;
    entries.push({
      id,
      kind,
      name,
      path: full,
      sizeMb: (sizeBytes / 1048576).toFixed(1),
      sizeBytes,
      mtimeMs,
      lastUsedMs,
      favorite: !!meta.favorites[id],
    });
  }
  entries.sort((a, b) => b.lastUsedMs - a.lastUsedMs);
  return entries;
}

function listStorageEntries() {
  const root = noraOpsRoot();
  const venvs = scanSubdirs(path.join(root, "venvs"), "venv");
  const runner = scanSubdirs(path.join(root, "runner-apps"), "runner");
  const runnerEnv = scanSubdirs(path.join(root, "runner-envs"), "runner-env");
  const dev = scanSubdirs(path.join(root, "dev-apps"), "dev");
  const all = [...venvs, ...runner, ...runnerEnv, ...dev];
  const totalMb = (all.reduce((s, e) => s + e.sizeBytes, 0) / 1048576).toFixed(1);
  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
  const recommended = all.filter((e) => !e.favorite && e.lastUsedMs < cutoff);
  return { root, entries: all, totalMb, recommended };
}

function setFavorite(id, value) {
  const meta = loadMeta();
  if (value) meta.favorites[id] = true;
  else delete meta.favorites[id];
  saveMeta(meta);
}

function touchUsage(id) {
  const meta = loadMeta();
  meta.lastUsed[id] = Date.now();
  saveMeta(meta);
}

function touchRunnerUsage(owner, name) {
  const safe = `${owner}__${name}`.replace(/[^a-zA-Z0-9._-]/g, "_");
  touchUsage(`runner:${safe}`);
}

function touchVenvUsage(workspaceRoot) {
  const { readWorkspaceSession } = require("./pathsMeta");
  const { getPythonEnvStatus } = require("./pythonEnv");
  const st = getPythonEnvStatus(workspaceRoot);
  if (st.venvDir) {
    const name = path.basename(st.venvDir);
    touchUsage(`venv:${name}`);
  }
}

function deleteEntry(id) {
  const { entries } = listStorageEntries();
  const ent = entries.find((e) => e.id === id);
  if (!ent) throw new Error("見つかりません");
  const root = path.resolve(noraOpsRoot());
  const target = path.resolve(ent.path);
  if (!target.startsWith(root + path.sep) && target !== root) {
    throw new Error("安全のため削除を中止しました");
  }
  fs.rmSync(target, { recursive: true, force: true });
  const meta = loadMeta();
  delete meta.favorites[id];
  delete meta.lastUsed[id];
  saveMeta(meta);
  return ent;
}

function deleteEntries(ids) {
  const deleted = [];
  for (const id of ids) {
    deleted.push(deleteEntry(id));
  }
  return deleted;
}

module.exports = {
  noraOpsRoot,
  listStorageEntries,
  setFavorite,
  touchUsage,
  touchRunnerUsage,
  touchVenvUsage,
  deleteEntry,
  deleteEntries,
};
