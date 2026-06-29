const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { getNoraOpsRepoMeta, bindNoraOpsRepo } = require("../src/noraops/repoMeta");
const { deleteWorkspaceRecord } = require("../src/noraops/workspaceStore");

describe("getNoraOpsRepoMeta", () => {
  it("reads giteaFullName from AppData workspace session", () => {
    const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nora-meta-store-"));
    const prev = process.env.NORAOPS_LOCAL_ROOT;
    process.env.NORAOPS_LOCAL_ROOT = storeRoot;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nora-meta-"));
    try {
      bindNoraOpsRepo(root, {
        owner: "team",
        name: "my-app",
        fullName: "team/my-app",
      });
      const meta = getNoraOpsRepoMeta(root);
      assert.equal(meta.fullName, "team/my-app");
      assert.equal(meta.source, "nora-session");
    } finally {
      deleteWorkspaceRecord(root);
      if (prev === undefined) delete process.env.NORAOPS_LOCAL_ROOT;
      else process.env.NORAOPS_LOCAL_ROOT = prev;
      fs.rmSync(storeRoot, { recursive: true, force: true });
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
