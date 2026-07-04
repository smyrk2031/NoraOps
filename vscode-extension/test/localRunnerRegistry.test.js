const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { describe, it, beforeEach, afterEach } = require("node:test");

const { slugify, uniqueSlug, listLocalApps, toRunnerItem } = require("../src/noraops/localRunnerRegistry");

describe("localRunnerRegistry", () => {
  let tmp;
  let prevRoot;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nora-local-runner-"));
    prevRoot = process.env.NORAOPS_LOCAL_ROOT;
    process.env.NORAOPS_LOCAL_ROOT = tmp;
  });

  afterEach(() => {
    if (prevRoot == null) delete process.env.NORAOPS_LOCAL_ROOT;
    else process.env.NORAOPS_LOCAL_ROOT = prevRoot;
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("slugify and uniqueSlug", () => {
    assert.equal(slugify("My App!"), "my-app");
    assert.equal(uniqueSlug("My App", [{ slug: "my-app" }]), "my-app-2");
  });

  it("toRunnerItem marks local", () => {
    const item = toRunnerItem({ slug: "demo", displayName: "デモ" });
    assert.equal(item.owner, "local");
    assert.equal(item.slug, "demo");
    assert.equal(item.local, true);
    assert.equal(listLocalApps().length, 0);
  });
});
