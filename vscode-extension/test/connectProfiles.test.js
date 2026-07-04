const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { describe, it, beforeEach, afterEach } = require("node:test");

const {
  listProfiles,
  addProfile,
  updateProfile,
  deleteProfile,
  reorderProfiles,
} = require("../src/noraops/connectProfiles");
const { isTextContentType, parseContentDisposition } = require("../src/noraops/connectRequestUtil");

describe("connectProfiles", () => {
  /** @type {string} */
  let tmp;
  /** @type {string | undefined} */
  let prevRoot;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nora-conn-"));
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

  function ws(name = "proj") {
    const p = path.join(tmp, name);
    fs.mkdirSync(p, { recursive: true });
    return p;
  }

  it("CRUD and reorder profiles", () => {
    const root = ws();
    const a = addProfile(root, { name: "Health", method: "GET", url: "http://127.0.0.1:8000/api/health" });
    assert.equal(listProfiles(root).length, 1);
    const b = addProfile(root, { name: "Echo", method: "POST", url: "http://127.0.0.1:8000/echo", body: "{}" });
    assert.equal(listProfiles(root).length, 2);
    updateProfile(root, a.profile.id, { url: "http://localhost:8000/api/health" });
    assert.match(listProfiles(root)[0].url, /localhost/);
    const ids = listProfiles(root).map((p) => p.id);
    reorderProfiles(root, [ids[1], ids[0]]);
    assert.equal(listProfiles(root)[0].name, "Echo");
    deleteProfile(root, b.profile.id);
    assert.equal(listProfiles(root).length, 1);
  });
});

describe("connectRequest helpers", () => {
  it("parses content disposition filename", () => {
    assert.equal(parseContentDisposition('attachment; filename="report.pdf"'), "report.pdf");
    assert.equal(parseContentDisposition("attachment; filename*=UTF-8''data%2Ejson"), "data.json");
  });

  it("detects text content types", () => {
    assert.equal(isTextContentType("application/json"), true);
    assert.equal(isTextContentType("application/octet-stream"), false);
  });
});
