const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { bindNoraOpsRepo, getNoraOpsRepoMeta } = require("../src/noraops/repoMeta");
const { normalizeGiteaRepoId, giteaRepoIdFromProvision } = require("../src/noraops/giteaRepoId");
const { deleteWorkspaceRecord } = require("../src/noraops/workspaceStore");

describe("giteaRepoId", () => {
  it("normalizeGiteaRepoId accepts positive integers", () => {
    assert.equal(normalizeGiteaRepoId(42), 42);
    assert.equal(normalizeGiteaRepoId("42"), 42);
    assert.equal(normalizeGiteaRepoId(0), null);
    assert.equal(normalizeGiteaRepoId("x"), null);
  });

  it("giteaRepoIdFromProvision reads snake_case and camelCase", () => {
    assert.equal(giteaRepoIdFromProvision({ gitea_repo_id: 10 }), 10);
    assert.equal(giteaRepoIdFromProvision({ giteaRepoId: 11 }), 11);
    assert.equal(giteaRepoIdFromProvision({ id: 12 }), 12);
  });
});

describe("bindNoraOpsRepo giteaRepoId", () => {
  it("persists giteaRepoId in AppData session", () => {
    const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nora-gitea-id-store-"));
    const prev = process.env.NORAOPS_LOCAL_ROOT;
    process.env.NORAOPS_LOCAL_ROOT = storeRoot;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nora-gitea-id-ws-"));
    try {
      bindNoraOpsRepo(root, {
        owner: "team",
        name: "app",
        fullName: "team/app",
        giteaRepoId: 123,
        appId: "nora.app.test",
      });
      const meta = getNoraOpsRepoMeta(root);
      assert.equal(meta.giteaRepoId, 123);
      assert.equal(meta.fullName, "team/app");
    } finally {
      deleteWorkspaceRecord(root);
      if (prev === undefined) delete process.env.NORAOPS_LOCAL_ROOT;
      else process.env.NORAOPS_LOCAL_ROOT = prev;
      fs.rmSync(storeRoot, { recursive: true, force: true });
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
