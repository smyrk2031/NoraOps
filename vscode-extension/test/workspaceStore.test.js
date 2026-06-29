const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const {
  workspaceKey,
  readWorkspaceSession,
  writeWorkspaceSession,
  readPythonEnvMeta,
  writePythonEnvMeta,
  readSecurityWarnStateRecord,
  workspaceRecordPath,
  deleteWorkspaceRecord,
} = require("../src/noraops/workspaceStore");

function withStoreRoot(fn) {
  const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nora-ws-store-"));
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

describe("workspaceStore", () => {
  it("workspaceKey is stable for same path", () => {
    const ws = path.resolve("/projects/my-app");
    assert.equal(workspaceKey(ws), workspaceKey(ws));
    assert.equal(workspaceKey(ws).length, 32);
  });

  it("writes session to AppData not .nora", () => {
    withStoreRoot(() => {
      const ws = fs.mkdtempSync(path.join(os.tmpdir(), "nora-ws-ws-"));
      try {
        writeWorkspaceSession(ws, { appId: "nora.app.test", giteaFullName: "team/app" });
        const session = readWorkspaceSession(ws);
        assert.equal(session.appId, "nora.app.test");
        assert.equal(session.giteaFullName, "team/app");
        assert.ok(fs.existsSync(workspaceRecordPath(ws)));
        assert.equal(fs.existsSync(path.join(ws, ".nora", "session.json")), false);
      } finally {
        deleteWorkspaceRecord(ws);
        fs.rmSync(ws, { recursive: true, force: true });
      }
    });
  });

  it("migrates legacy .nora/session.json on first read", () => {
    withStoreRoot(() => {
      const ws = fs.mkdtempSync(path.join(os.tmpdir(), "nora-ws-legacy-"));
      try {
        const noraDir = path.join(ws, ".nora");
        fs.mkdirSync(noraDir, { recursive: true });
        fs.writeFileSync(
          path.join(noraDir, "session.json"),
          JSON.stringify({ appId: "nora.app.legacy", giteaFullName: "o/n" }, null, 2)
        );
        const session = readWorkspaceSession(ws);
        assert.equal(session.appId, "nora.app.legacy");
        assert.ok(fs.existsSync(workspaceRecordPath(ws)));
      } finally {
        deleteWorkspaceRecord(ws);
        fs.rmSync(ws, { recursive: true, force: true });
      }
    });
  });

  it("migrates legacy python-env.json into pythonEnv block", () => {
    withStoreRoot(() => {
      const ws = fs.mkdtempSync(path.join(os.tmpdir(), "nora-ws-py-"));
      try {
        const noraDir = path.join(ws, ".nora");
        fs.mkdirSync(noraDir, { recursive: true });
        fs.writeFileSync(
          path.join(noraDir, "python-env.json"),
          JSON.stringify({ venvDir: "C:/ws/.venv", python: "C:/ws/.venv/Scripts/python.exe" }, null, 2)
        );
        const meta = readPythonEnvMeta(ws);
        assert.equal(meta.venvDir, "C:/ws/.venv");
        writePythonEnvMeta(ws, { venvDir: "D:/new/.venv", python: "D:/new/.venv/Scripts/python.exe" });
        assert.equal(readPythonEnvMeta(ws).venvDir, "D:/new/.venv");
        assert.equal(fs.existsSync(path.join(noraDir, "python-env.json")), true);
      } finally {
        deleteWorkspaceRecord(ws);
        fs.rmSync(ws, { recursive: true, force: true });
      }
    });
  });

  it("security warn state round-trips via AppData", () => {
    withStoreRoot(() => {
      const ws = fs.mkdtempSync(path.join(os.tmpdir(), "nora-ws-sec-"));
      try {
        const { writeSecurityWarnStateRecord } = require("../src/noraops/workspaceStore");
        writeSecurityWarnStateRecord(ws, { suppressed: ["abc"], reviewed: [] });
        const st = readSecurityWarnStateRecord(ws);
        assert.deepEqual(st.suppressed, ["abc"]);
      } finally {
        deleteWorkspaceRecord(ws);
        fs.rmSync(ws, { recursive: true, force: true });
      }
    });
  });
});
