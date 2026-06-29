/**
 * xLLM 適用スナップショット（簡易ローカル履歴・切り戻し）
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const { resolveScaffoldRoot } = require("./scaffold");
const { workspaceKey } = require("./workspaceStore");

const HISTORY_SCHEMA = "nora.xllm-history/1";
const MAX_UNPINNED = 10;

function noraOpsRoot() {
  const override = process.env.NORAOPS_LOCAL_ROOT;
  if (override && String(override).trim()) {
    return path.resolve(String(override).trim());
  }
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  return path.join(base, "NoraOps");
}

function historyBaseDir(workspaceRoot) {
  const key = workspaceKey(workspaceRoot);
  if (!key) return null;
  return path.join(noraOpsRoot(), "xllm-history", key);
}

function manifestPath(workspaceRoot) {
  const base = historyBaseDir(workspaceRoot);
  return base ? path.join(base, "manifest.json") : null;
}

function readManifest(workspaceRoot) {
  const mp = manifestPath(workspaceRoot);
  if (!mp) return { schema: HISTORY_SCHEMA, snapshots: [] };
  try {
    if (fs.existsSync(mp)) {
      const data = JSON.parse(fs.readFileSync(mp, "utf8"));
      return {
        schema: data.schema || HISTORY_SCHEMA,
        workspacePath: data.workspacePath || "",
        snapshots: Array.isArray(data.snapshots) ? data.snapshots : [],
      };
    }
  } catch {
    /* ignore */
  }
  return { schema: HISTORY_SCHEMA, snapshots: [] };
}

function writeManifest(workspaceRoot, doc) {
  const base = historyBaseDir(workspaceRoot);
  if (!base) return;
  fs.mkdirSync(base, { recursive: true });
  const mp = path.join(base, "manifest.json");
  fs.writeFileSync(
    mp,
    JSON.stringify(
      {
        schema: HISTORY_SCHEMA,
        workspacePath: workspaceRoot,
        updatedAt: new Date().toISOString(),
        snapshots: doc.snapshots || [],
      },
      null,
      2
    ),
    "utf8"
  );
}

function snapshotDir(workspaceRoot, snapshotId) {
  const base = historyBaseDir(workspaceRoot);
  return base ? path.join(base, "snapshots", snapshotId) : null;
}

function pruneSnapshots(snapshots) {
  const pinned = snapshots.filter((s) => s.pinned);
  const unpinned = snapshots
    .filter((s) => !s.pinned)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const keptUnpinned = unpinned.slice(0, MAX_UNPINNED);
  const drop = unpinned.slice(MAX_UNPINNED);
  return {
    kept: [...pinned, ...keptUnpinned].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
    drop,
  };
}

function deleteSnapshotFiles(workspaceRoot, snapshotId) {
  const dir = snapshotDir(workspaceRoot, snapshotId);
  if (dir && fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * 適用直前の状態をスナップショット保存
 * @param {{ path: string, status: string, currentContent?: string }[]} items
 */
function createSnapshot(workspaceRoot, items, meta = {}) {
  const applicable = (items || []).filter((i) => i.status === "modified" || i.status === "new");
  if (!applicable.length) return null;

  const id = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = snapshotDir(workspaceRoot, id);
  if (!dir) return null;
  fs.mkdirSync(dir, { recursive: true });

  const modified = [];
  const created = [];

  for (const item of applicable) {
    if (item.status === "modified") {
      const dest = path.join(dir, item.path);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, item.currentContent ?? "", "utf8");
      modified.push(item.path);
    } else if (item.status === "new") {
      created.push(item.path);
    }
  }

  const entry = {
    id,
    createdAt: new Date().toISOString(),
    label: meta.label || `適用 ${applicable.length} ファイル`,
    pinned: false,
    modified,
    created,
    appliedPaths: applicable.map((i) => i.path),
  };

  const doc = readManifest(workspaceRoot);
  doc.snapshots.unshift(entry);
  const { kept, drop } = pruneSnapshots(doc.snapshots);
  for (const d of drop) {
    deleteSnapshotFiles(workspaceRoot, d.id);
  }
  doc.snapshots = kept;
  writeManifest(workspaceRoot, doc);
  return entry;
}

function listSnapshots(workspaceRoot) {
  const doc = readManifest(workspaceRoot);
  return doc.snapshots.map((s) => ({
    ...s,
    fileCount: (s.modified?.length || 0) + (s.created?.length || 0),
  }));
}

function togglePin(workspaceRoot, snapshotId) {
  const doc = readManifest(workspaceRoot);
  const snap = doc.snapshots.find((s) => s.id === snapshotId);
  if (!snap) return { ok: false, reason: "not_found" };
  snap.pinned = !snap.pinned;
  const { kept, drop } = pruneSnapshots(doc.snapshots);
  for (const d of drop) {
    deleteSnapshotFiles(workspaceRoot, d.id);
  }
  doc.snapshots = kept;
  writeManifest(workspaceRoot, doc);
  return { ok: true, pinned: snap.pinned };
}

function restoreSnapshot(workspaceRoot, snapshotId) {
  const root = path.resolve(resolveScaffoldRoot(workspaceRoot));
  const doc = readManifest(workspaceRoot);
  const snap = doc.snapshots.find((s) => s.id === snapshotId);
  if (!snap) return { ok: false, reason: "not_found" };

  const dir = snapshotDir(workspaceRoot, snapshotId);
  if (!dir || !fs.existsSync(dir)) {
    return { ok: false, reason: "snapshot_dir_missing" };
  }

  const restored = [];
  const deleted = [];
  const errors = [];

  for (const rel of snap.modified || []) {
    const src = path.join(dir, rel);
    const dest = path.join(root, rel);
    try {
      if (!fs.existsSync(src)) {
        errors.push({ path: rel, message: "スナップショットにファイルがありません" });
        continue;
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      restored.push(rel);
    } catch (e) {
      errors.push({ path: rel, message: e.message || String(e) });
    }
  }

  for (const rel of snap.created || []) {
    const dest = path.join(root, rel);
    try {
      if (fs.existsSync(dest)) {
        fs.unlinkSync(dest);
        deleted.push(rel);
      }
    } catch (e) {
      errors.push({ path: rel, message: e.message || String(e) });
    }
  }

  return {
    ok: errors.length === 0,
    restored,
    deleted,
    errors,
    snapshotId,
    label: snap.label,
  };
}

module.exports = {
  HISTORY_SCHEMA,
  MAX_UNPINNED,
  createSnapshot,
  listSnapshots,
  togglePin,
  restoreSnapshot,
};
