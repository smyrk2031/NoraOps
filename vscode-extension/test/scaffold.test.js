const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { resolveScaffoldRoot, noraJoin } = require("../src/noraops/scaffold");

describe("resolveScaffoldRoot", () => {
  it("keeps normal project root", () => {
    const root = path.resolve("/projects/myapp");
    assert.equal(resolveScaffoldRoot(root), root);
  });

  it("lifts nora/dev workspace to app root", () => {
    const ws = path.resolve("/projects/myapp/nora/dev");
    assert.equal(resolveScaffoldRoot(ws), path.resolve("/projects/myapp"));
  });

  it("lifts nora/mock workspace to app root", () => {
    const ws = path.resolve("/projects/myapp/nora/mock");
    assert.equal(resolveScaffoldRoot(ws), path.resolve("/projects/myapp"));
  });

  it("lifts nora folder workspace to parent", () => {
    const ws = path.resolve("/projects/myapp/nora");
    assert.equal(resolveScaffoldRoot(ws), path.resolve("/projects/myapp"));
  });
});

describe("noraJoin", () => {
  it("does not double nora/dev when workspace is nora/dev", () => {
    const ws = path.resolve("/projects/myapp/nora/dev");
    const main = noraJoin(ws, "dev", "main.py");
    assert.equal(main, path.resolve("/projects/myapp/nora/dev/main.py"));
    assert.ok(!main.includes(`${path.sep}nora${path.sep}dev${path.sep}nora${path.sep}`));
  });
});
