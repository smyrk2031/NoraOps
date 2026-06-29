const fs = require("fs");
const path = require("path");
const { classifyForSave } = require("./workspaceZip");
const { resolveScaffoldRoot } = require("./scaffold");

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * ワークスペース内の全ファイルを Gitea 保存対象かどうか分類する。
 */
function buildSaveInventory(workspaceRoot) {
  const root = path.resolve(resolveScaffoldRoot(workspaceRoot));
  const included = [];
  const excluded = [];

  function walk(dir, relBase) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const rel = relBase ? `${relBase}/${ent.name}` : ent.name;
      const norm = rel.replace(/\\/g, "/");
      const cls = classifyForSave(norm, ent.isDirectory());
      const full = path.join(dir, ent.name);

      if (ent.isDirectory()) {
        if (!cls.included) {
          excluded.push({ rel: norm, kind: "dir", reason: cls.reason });
          continue;
        }
        walk(full, rel);
        continue;
      }

      let size = 0;
      try {
        size = fs.statSync(full).size;
      } catch {
        /* ignore */
      }
      const item = { rel: norm, kind: "file", size, sizeLabel: formatBytes(size) };
      if (cls.included) included.push(item);
      else excluded.push({ ...item, reason: cls.reason });
    }
  }

  walk(root, "");

  included.sort((a, b) => a.rel.localeCompare(b.rel));
  excluded.sort((a, b) => a.rel.localeCompare(b.rel));

  const includedBytes = included.reduce((s, f) => s + (f.size || 0), 0);

  return {
    rootLabel: path.basename(root),
    included,
    excluded,
    summary: {
      includedCount: included.length,
      excludedCount: excluded.length,
      includedBytes,
      includedSizeLabel: formatBytes(includedBytes),
    },
    rules: [
      "保存される: アプリのソース、nora/ 配下の設定、README など",
      "保存されない: .git / .venv / .nora / node_modules などの環境フォルダ",
      "保存されない: .env や秘密鍵ファイル",
      "保存されない: static|media の uploads/ フォルダ（アップロード用・旧 nora/dev 配下も同様）",
      "保存されない: static/media 内の画像・動画など（.js / .css は保存されます）",
    ],
  };
}

module.exports = { buildSaveInventory, formatBytes };
