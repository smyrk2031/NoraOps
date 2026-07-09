const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

describe("ensureDocsReadme", () => {
  let tmp;

  it("creates docs/README.md from template when missing", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nora-docs-"));
    const { ensureDocsReadme } = require("../src/noraops/scaffold");
    const first = ensureDocsReadme(tmp);
    assert.equal(first.created, true);
    assert.ok(fs.existsSync(first.path));
    const text = fs.readFileSync(first.path, "utf8");
    assert.match(text, /## 概要/);
    assert.match(text, /## 背景・課題/);
    const second = ensureDocsReadme(tmp);
    assert.equal(second.created, false);
  });
});
