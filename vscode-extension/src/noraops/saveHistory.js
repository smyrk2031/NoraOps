/**
 * 非公開クラウド保存のローカルスナップショット（直近 N 件・ワンクリック復元）
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const { collectFiles } = require("./workspaceZip");
const { workspaceKey } = require("./workspaceStore");

const HISTORY_SCHEMA = "nora.save-history/1";
const MAX_SNAPSHOTS = 2;

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
  return path.join(noraOpsRoot(), "save-history", key);
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
  fs.writeFileSync(
    path.join(base, "manifest.json"),
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
  const sorted = [...snapshots].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const kept = sorted.slice(0, MAX_SNAPSHOTS);
  const drop = sorted.slice(MAX_SNAPSHOTS);
  return { kept, drop };
}

function deleteSnapshotFiles(workspaceRoot, snapshotId) {
  const dir = snapshotDir(workspaceRoot, snapshotId);
  if (dir && fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function formatSnapshotLabel(createdAt, meta = {}) {
  if (meta.label) return meta.label;
  try {
    const d = new Date(createdAt);
    const stamp = d.toLocaleString("ja-JP", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    return `クラウド保存 ${stamp}`;
  } catch {
    return "クラウド保存";
  }
}

/**
 * クラウド保存成功後にワークスペース全体をスナップショット
 */
function createSaveSnapshot(workspaceRoot, meta = {}) {
  const root = path.resolve(workspaceRoot);
  const files = collectFiles(root);
  if (!files.length) return null;

  const id = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = snapshotDir(workspaceRoot, id);
  if (!dir) return null;
  fs.mkdirSync(dir, { recursive: true });

  const relPaths = [];
  for (const f of files) {
    const dest = path.join(dir, f.rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(f.full, dest);
    relPaths.push(f.rel);
  }

  const createdAt = new Date().toISOString();
  const entry = {
    id,
    createdAt,
    label: formatSnapshotLabel(createdAt, meta),
    fullName: meta.fullName || null,
    branch: meta.branch || null,
    files: relPaths,
    fileCount: relPaths.length,
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

function listSaveSnapshots(workspaceRoot) {
  const doc = readManifest(workspaceRoot);
  return doc.snapshots.map((s) => ({
    id: s.id,
    createdAt: s.createdAt,
    label: s.label,
    fullName: s.fullName,
    branch: s.branch,
    fileCount: s.fileCount || (s.files?.length ?? 0),
  }));
}

function restoreSaveSnapshot(workspaceRoot, snapshotId) {
  const root = path.resolve(workspaceRoot);
  const doc = readManifest(workspaceRoot);
  const snap = doc.snapshots.find((s) => s.id === snapshotId);
  if (!snap) return { ok: false, reason: "not_found" };

  const dir = snapshotDir(workspaceRoot, snapshotId);
  if (!dir || !fs.existsSync(dir)) {
    return { ok: false, reason: "snapshot_dir_missing" };
  }

  const snapFiles = new Set(snap.files || []);
  const restored = [];
  const deleted = [];
  const errors = [];

  for (const rel of snap.files || []) {
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

  const currentFiles = collectFiles(root).map((f) => f.rel);
  for (const rel of currentFiles) {
    if (snapFiles.has(rel)) continue;
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
  MAX_SNAPSHOTS,
  createSaveSnapshot,
  listSaveSnapshots,
  restoreSaveSnapshot,
};
