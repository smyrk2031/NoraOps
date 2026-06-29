const fs = require("fs");
const path = require("path");

/** アプリがアップロードした実行時データを置くサブフォルダ（Gitea / zip から除外） */
const RUNTIME_SUBDIRS = new Set(["uploads", "_runtime", "_uploads", "cache", "tmp", "temp"]);

/** ソースとして保存に含める拡張子（static/media 内でも常に含める） */
const SOURCE_EXTS = new Set([
  ".py",
  ".js",
  ".mjs",
  ".cjs",
  ".css",
  ".html",
  ".htm",
  ".json",
  ".txt",
  ".md",
  ".svg",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".map",
  ".xml",
  ".yaml",
  ".yml",
  ".toml",
  ".vue",
  ".ts",
  ".tsx",
  ".jsx",
  ".scss",
  ".less",
  ".wasm",
  ".webmanifest",
  ".jinja",
  ".jinja2",
  ".tpl",
]);

/** 実行時アップロードとみなして除外するバイナリ拡張子 */
const BINARY_MEDIA_EXTS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".tif",
  ".tiff",
  ".mp4",
  ".mov",
  ".avi",
  ".webm",
  ".mkv",
  ".mp3",
  ".wav",
  ".ogg",
  ".flac",
  ".pdf",
  ".zip",
  ".7z",
  ".db",
  ".sqlite",
  ".sqlite3",
  ".parquet",
]);

function matchRuntimeMediaPath(norm) {
  return norm.match(/^(?:nora\/dev\/)?(static|media)\/(.+)$/);
}

/**
 * static|media 配下で Gitea 保存（zip）から除外すべきか。
 * - uploads/ 等のランタイム用サブフォルダは常に除外
 * - .js 等のソース拡張子は常に含める（手置きの静的ファイルを守る）
 * - 画像・動画などは除外（アップロードデータ想定）
 * - 旧 nora/dev/static|media も互換読み取り
 */
function isDevRuntimeDataPath(relPath) {
  const norm = String(relPath).replace(/\\/g, "/");
  const m = matchRuntimeMediaPath(norm);
  if (!m) return false;

  const parts = m[2].split("/");
  if (RUNTIME_SUBDIRS.has(parts[0])) return true;

  const base = parts[parts.length - 1] || "";
  if (base === ".gitkeep" || base === ".gitignore") return false;

  const ext = path.extname(base).toLowerCase();
  if (SOURCE_EXTS.has(ext)) return false;
  if (BINARY_MEDIA_EXTS.has(ext)) return true;

  return false;
}

module.exports = {
  isDevRuntimeDataPath,
  RUNTIME_SUBDIRS,
  SOURCE_EXTS,
  BINARY_MEDIA_EXTS,
};
