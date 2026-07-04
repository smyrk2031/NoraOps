const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { describe, it, beforeEach, afterEach } = require("node:test");
const { buildExportFileTree } = require("../src/noraops/xllmFileTree");

describe("xllmFileTree", () => {
  /** @type {string} */
  let tmp;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nora-tree-"));
    fs.writeFileSync(path.join(tmp, "main.py"), "x=1\n", "utf8");
    fs.mkdirSync(path.join(tmp, "pkg"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "pkg", "util.py"), "y=2\n", "utf8");
  });

  afterEach(() => {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("builds nested tree excluding ignored files", () => {
    fs.writeFileSync(path.join(tmp, ".env"), "SECRET=1\n", "utf8");
    const tree = buildExportFileTree(tmp);
    assert.ok(tree.fileCount >= 2);
    const names = tree.nodes.map((n) => n.name);
    assert.ok(names.includes("main.py"));
    assert.ok(names.includes("pkg"));
    const pkg = tree.nodes.find((n) => n.name === "pkg");
    assert.equal(pkg.type, "dir");
    assert.ok(pkg.children.some((c) => c.path === "pkg/util.py"));
  });
});
