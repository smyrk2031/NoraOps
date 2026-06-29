const fs = require("fs");
const path = require("path");
const { readNoraManifest } = require("./appEntry");
const { noraJoin, resolveScaffoldRoot } = require("./scaffold");

/** manifest の thumbnail（ワークスペースルート相対） */
const THUMB_REL = "assets/thumbnail.png";

/** 旧: nora/manifest から見た相対パス（v1 互換） */
const THUMB_REL_LEGACY_NORA = "assets/thumbnail.png";

function legacyThumbnailAbsPath(workspaceRoot) {
  return noraJoin(workspaceRoot, "assets", "thumbnail.png");
}

function rootThumbnailAbsPath(workspaceRoot) {
  return path.join(resolveScaffoldRoot(workspaceRoot), "assets", "thumbnail.png");
}

/** 読取: ルート assets → 旧 nora/assets */
function resolveThumbnailAbsPath(workspaceRoot) {
  const rootPath = rootThumbnailAbsPath(workspaceRoot);
  if (fs.existsSync(rootPath)) return rootPath;
  const legacyPath = legacyThumbnailAbsPath(workspaceRoot);
  if (fs.existsSync(legacyPath)) return legacyPath;
  return rootPath;
}

function thumbnailAbsPath(workspaceRoot) {
  return resolveThumbnailAbsPath(workspaceRoot);
}

function ensureAssetsDir(workspaceRoot) {
  const dir = path.join(resolveScaffoldRoot(workspaceRoot), "assets");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function updateManifestThumbnail(workspaceRoot) {
  const manPath = noraJoin(workspaceRoot, "manifest.json");
  fs.mkdirSync(path.dirname(manPath), { recursive: true });
  let man = readNoraManifest(workspaceRoot) || { schema: "nora.manifest/1", language: "python" };
  man.thumbnail = THUMB_REL;
  fs.writeFileSync(manPath, JSON.stringify(man, null, 2) + "\n", "utf8");
}

function readThumbnailPreview(workspaceRoot) {
  const p = resolveThumbnailAbsPath(workspaceRoot);
  if (!fs.existsSync(p)) return null;
  try {
    const buf = fs.readFileSync(p);
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

function applyThumbnailBuffer(workspaceRoot, buf) {
  if (!buf || !buf.length) throw new Error("画像データが空です");
  ensureAssetsDir(workspaceRoot);
  const out = rootThumbnailAbsPath(workspaceRoot);
  fs.writeFileSync(out, buf);
  updateManifestThumbnail(workspaceRoot);
  return out;
}

function applyThumbnailPng(workspaceRoot, dataUrlOrBase64) {
  const m = String(dataUrlOrBase64).match(/^data:image\/\w+;base64,(.+)$/s);
  const b64 = m ? m[1] : dataUrlOrBase64;
  const buf = Buffer.from(b64, "base64");
  return applyThumbnailBuffer(workspaceRoot, buf);
}

function applyThumbnailFile(workspaceRoot, sourcePath) {
  if (!fs.existsSync(sourcePath)) throw new Error("画像ファイルが見つかりません");
  const buf = fs.readFileSync(sourcePath);
  return applyThumbnailBuffer(workspaceRoot, buf);
}

function hasThumbnail(workspaceRoot) {
  return fs.existsSync(rootThumbnailAbsPath(workspaceRoot)) || fs.existsSync(legacyThumbnailAbsPath(workspaceRoot));
}

module.exports = {
  applyThumbnailPng,
  applyThumbnailBuffer,
  applyThumbnailFile,
  readThumbnailPreview,
  thumbnailAbsPath,
  rootThumbnailAbsPath,
  legacyThumbnailAbsPath,
  resolveThumbnailAbsPath,
  hasThumbnail,
  THUMB_REL,
  THUMB_REL_LEGACY_NORA,
};
