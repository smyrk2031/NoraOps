const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { describe, it, beforeEach, afterEach } = require("node:test");

describe("saveHistory", () => {
  let tmp;
  let storeRoot;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nora-save-hist-"));
    storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nora-store-"));
    process.env.NORAOPS_LOCAL_ROOT = storeRoot;
    fs.writeFileSync(path.join(tmp, "main.py"), "v1\n", "utf8");
    fs.mkdirSync(path.join(tmp, "nora"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "nora", "manifest.json"), '{"appId":"test"}\n', "utf8");
  });

  afterEach(() => {
    delete process.env.NORAOPS_LOCAL_ROOT;
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
      fs.rmSync(storeRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("creates snapshot after save and lists it", () => {
    const { createSaveSnapshot, listSaveSnapshots } = require("../src/noraops/saveHistory");
    const entry = createSaveSnapshot(tmp, { fullName: "team/app" });
    assert.ok(entry);
    assert.equal(entry.fullName, "team/app");
    assert.ok(entry.fileCount >= 2);
    const list = listSaveSnapshots(tmp);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, entry.id);
  });

  it("keeps at most MAX_SNAPSHOTS entries", () => {
    const { createSaveSnapshot, listSaveSnapshots, MAX_SNAPSHOTS } = require("../src/noraops/saveHistory");
    for (let i = 0; i < MAX_SNAPSHOTS + 2; i++) {
      fs.writeFileSync(path.join(tmp, "main.py"), `v${i}\n`, "utf8");
      createSaveSnapshot(tmp, { label: `save ${i}` });
    }
    const list = listSaveSnapshots(tmp);
    assert.equal(list.length, MAX_SNAPSHOTS);
    assert.match(list[0].label, /save 3/);
  });

  it("restores workspace files from snapshot", () => {
    const { createSaveSnapshot, restoreSaveSnapshot, listSaveSnapshots } = require("../src/noraops/saveHistory");
    createSaveSnapshot(tmp, { label: "before" });
    fs.writeFileSync(path.join(tmp, "main.py"), "v2\n", "utf8");
    fs.writeFileSync(path.join(tmp, "extra.py"), "new\n", "utf8");
    const id = listSaveSnapshots(tmp)[0].id;
    const result = restoreSaveSnapshot(tmp, id);
    assert.equal(result.ok, true);
    assert.equal(fs.readFileSync(path.join(tmp, "main.py"), "utf8"), "v1\n");
    assert.equal(fs.existsSync(path.join(tmp, "extra.py")), false);
  });

  it("returns not_found for unknown snapshot id", () => {
    const { restoreSaveSnapshot } = require("../src/noraops/saveHistory");
    const result = restoreSaveSnapshot(tmp, "missing-id");
    assert.equal(result.ok, false);
    assert.equal(result.reason, "not_found");
  });
});
