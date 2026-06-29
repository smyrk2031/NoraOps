const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { resolveAppEntry, readNoraManifest } = require("../src/noraops/appEntry");

describe("resolveAppEntry", () => {
  it("uses manifest entry at workspace root", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nora-entry-"));
    fs.mkdirSync(path.join(root, "nora"), { recursive: true });
    fs.writeFileSync(path.join(root, "main.py"), "print('ok')\n");
    fs.writeFileSync(path.join(root, "main_コピー.py"), "print('copy')\n");
    fs.writeFileSync(
      path.join(root, "nora", "manifest.json"),
      JSON.stringify({ entry: "main.py" })
    );
    const entry = resolveAppEntry(root, root);
    assert.equal(entry.label, "main.py");
    assert.equal(entry.source, "nora/manifest.json");
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("reads module entry from manifest", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nora-mod-"));
    fs.mkdirSync(path.join(root, "nora"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "nora", "manifest.json"),
      JSON.stringify({ entryKind: "module", entryModule: "myapp" })
    );
    const entry = resolveAppEntry(root, root);
    assert.equal(entry.label, "python -m myapp");
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("readNoraManifest", () => {
  it("returns null when missing", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nora-man-"));
    assert.equal(readNoraManifest(root), null);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
