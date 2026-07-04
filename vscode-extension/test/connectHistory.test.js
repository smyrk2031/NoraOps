const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { describe, it, beforeEach, afterEach } = require("node:test");

const { appendHistory, listHistory, clearHistory } = require("../src/noraops/connectHistory");
const { buildCurlCommand } = require("../src/noraops/connectCurl");

describe("connectHistory", () => {
  let tmp;
  let prevRoot;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nora-ch-"));
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

  function ws() {
    const p = path.join(tmp, "proj");
    fs.mkdirSync(p, { recursive: true });
    return p;
  }

  it("appends and lists history per profile", () => {
    const root = ws();
    appendHistory(root, {
      profileId: "p1",
      profileName: "Health",
      request: { method: "GET", url: "http://127.0.0.1/health", headers: [] },
      result: { ok: true, status: 200, bodyText: '{"ok":true}' },
    });
    appendHistory(root, {
      profileId: "p2",
      profileName: "Other",
      request: { method: "GET", url: "http://127.0.0.1/x", headers: [] },
      result: { ok: true, status: 200, bodyText: "x" },
    });
    assert.equal(listHistory(root, "p1").length, 1);
    assert.equal(listHistory(root).length, 2);
    clearHistory(root, "p1");
    assert.equal(listHistory(root, "p1").length, 0);
    assert.equal(listHistory(root).length, 1);
  });
});

describe("connectCurl", () => {
  it("builds GET curl", () => {
    const cmd = buildCurlCommand({
      method: "GET",
      url: "http://127.0.0.1:8000/api/health",
      headers: [{ key: "Accept", value: "application/json" }],
    });
    assert.match(cmd, /curl -sS -X GET/);
    assert.match(cmd, /Accept: application\/json/);
  });

  it("builds POST curl with body", () => {
    const cmd = buildCurlCommand({
      method: "POST",
      url: "http://127.0.0.1/echo",
      contentType: "application/json",
      body: '{"a":1}',
      headers: [],
    });
    assert.match(cmd, /-X POST/);
    assert.match(cmd, /Content-Type: application\/json/);
    assert.match(cmd, /-d '\{"a":1\}'/);
  });
});
