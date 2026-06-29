const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { MODES, writeCreatorProfile } = require("../src/noraops/creatorWorkflow");
const { ensureImportPublishReady } = require("../src/noraops/importPublishReady");
const { noraJoin } = require("../src/noraops/scaffold");
const { readWorkspaceSession } = require("../src/noraops/pathsMeta");

function withStoreRoot(fn) {
  const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nora-binding-store-"));
  const prev = process.env.NORAOPS_LOCAL_ROOT;
  process.env.NORAOPS_LOCAL_ROOT = storeRoot;
  try {
    fn(storeRoot);
  } finally {
    if (prev === undefined) delete process.env.NORAOPS_LOCAL_ROOT;
    else process.env.NORAOPS_LOCAL_ROOT = prev;
    fs.rmSync(storeRoot, { recursive: true, force: true });
  }
}

describe("ensureImportPublishReady", () => {
  it("skips outside import mode", () => {
    withStoreRoot(() => {
      const ws = fs.mkdtempSync(path.join(os.tmpdir(), "nora-binding-skip-"));
      try {
        writeCreatorProfile(ws, MODES.GREENFIELD);
        const r = ensureImportPublishReady(ws);
        assert.equal(r.skipped, true);
        assert.equal(fs.existsSync(noraJoin(ws, "manifest.json")), false);
      } finally {
        fs.rmSync(ws, { recursive: true, force: true });
      }
    });
  });

  it("creates manifest with appId for import mode", () => {
    withStoreRoot(() => {
      const ws = fs.mkdtempSync(path.join(os.tmpdir(), "nora-binding-create-"));
      try {
        writeCreatorProfile(ws, MODES.IMPORT);
        const r = ensureImportPublishReady(ws);
        assert.equal(r.created, true);
        assert.ok(r.appId);
        const man = JSON.parse(fs.readFileSync(noraJoin(ws, "manifest.json"), "utf8"));
        assert.equal(man.appId, r.appId);
        const session = readWorkspaceSession(ws);
        assert.equal(session.appId, r.appId);
      } finally {
        fs.rmSync(ws, { recursive: true, force: true });
      }
    });
  });

  it("patches manifest missing appId", () => {
    withStoreRoot(() => {
      const ws = fs.mkdtempSync(path.join(os.tmpdir(), "nora-binding-patch-"));
      try {
        writeCreatorProfile(ws, MODES.IMPORT);
        fs.mkdirSync(noraJoin(ws), { recursive: true });
        fs.writeFileSync(
          noraJoin(ws, "manifest.json"),
          JSON.stringify({ schema: "nora.manifest/1", displayName: "Demo" }, null, 2) + "\n",
          "utf8"
        );
        const r = ensureImportPublishReady(ws);
        assert.equal(r.patched, true);
        assert.ok(r.appId);
        const man = JSON.parse(fs.readFileSync(noraJoin(ws, "manifest.json"), "utf8"));
        assert.equal(man.appId, r.appId);
      } finally {
        fs.rmSync(ws, { recursive: true, force: true });
      }
    });
  });
});
