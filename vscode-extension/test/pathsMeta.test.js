const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { packageNameSlug, recordAppAccess, readWorkspaceSession } = require("../src/noraops/pathsMeta");
const { bindNoraOpsRepo } = require("../src/noraops/repoMeta");

describe("packageNameSlug", () => {
  it("accepts ascii folder names", () => {
    assert.equal(packageNameSlug("My App"), "my-app");
    assert.equal(packageNameSlug("test01"), "test01");
  });

  it("maps japanese names to app-hash", () => {
    const s = packageNameSlug("テスト開発");
    assert.match(s, /^app-[a-f0-9]{8}$/);
    assert.equal(packageNameSlug("テスト開発"), s);
  });
});

describe("recordAppAccess", () => {
  it("keeps gitea binding when push fails", () => {
    const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nora-pathsmeta-"));
    const prev = process.env.NORAOPS_LOCAL_ROOT;
    process.env.NORAOPS_LOCAL_ROOT = storeRoot;
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "nora-ws-"));
    try {
      bindNoraOpsRepo(ws, { owner: "alice", name: "my-app", fullName: "alice/my-app" });
      recordAppAccess(ws, { lastSave: "12:00", lastPushOk: false, giteaFullName: undefined });
      const session = readWorkspaceSession(ws);
      assert.equal(session.giteaFullName, "alice/my-app");
    } finally {
      if (prev === undefined) delete process.env.NORAOPS_LOCAL_ROOT;
      else process.env.NORAOPS_LOCAL_ROOT = prev;
      fs.rmSync(storeRoot, { recursive: true, force: true });
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });
});
