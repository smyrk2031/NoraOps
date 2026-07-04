/**
 * xLLM エクスポート対象のファイルツリー（チェック UI 用）
 */

const path = require("path");
const { collectFiles } = require("./workspaceZip");
const { resolveScaffoldRoot } = require("./scaffold");

/**
 * @param {string} workspaceRoot
 * @returns {{ rootLabel: string, nodes: Array<{ type: 'dir'|'file', name: string, path: string, children?: unknown[] }>, fileCount: number }}
 */
function buildExportFileTree(workspaceRoot) {
  const root = path.resolve(resolveScaffoldRoot(workspaceRoot));
  const files = collectFiles(root);
  const tree = {};

  for (const f of files) {
    const rel = String(f.rel || "").replace(/\\/g, "/");
    if (!rel) continue;
    const parts = rel.split("/");
    let node = tree;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isFile = i === parts.length - 1;
      if (isFile) {
        if (!node._files) node._files = [];
        node._files.push({ name: part, path: rel });
      } else {
        if (!node._dirs) node._dirs = {};
        if (!node._dirs[part]) node._dirs[part] = {};
        node = node._dirs[part];
      }
    }
  }

  return {
    rootLabel: path.basename(root),
    nodes: buildNodes(tree, ""),
    fileCount: files.length,
  };
}

function buildNodes(node, parentPath) {
  const children = [];
  for (const [name, sub] of Object.entries(node._dirs || {}).sort(([a], [b]) => a.localeCompare(b))) {
    const dirPath = parentPath ? `${parentPath}/${name}` : name;
    children.push({
      type: "dir",
      name,
      path: dirPath,
      children: buildNodes(sub, dirPath),
    });
  }
  for (const f of (node._files || []).sort((a, b) => a.name.localeCompare(b.name))) {
    children.push({ type: "file", name: f.name, path: f.path });
  }
  return children;
}

/** @param {Array<{ type: string, children?: unknown[] }>} nodes */
function collectFilePathsFromTree(nodes, acc = []) {
  for (const n of nodes || []) {
    if (n.type === "file" && n.path) acc.push(n.path);
    else if (n.type === "dir" && n.children) collectFilePathsFromTree(n.children, acc);
  }
  return acc;
}

module.exports = { buildExportFileTree, collectFilePathsFromTree };
