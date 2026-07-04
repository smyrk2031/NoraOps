const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { describe, it, beforeEach, afterEach } = require("node:test");

const { listMemos, addMemo, updateMemo, deleteMemo, reorderMemo } = require("../src/noraops/creatorMemos");

describe("creatorMemos", () => {
  /** @type {string} */
  let tmp;
  /** @type {string} */
  let prevRoot;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nora-memo-"));
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

  it("adds and lists memos", () => {
    const ws = path.join(tmp, "proj");
    fs.mkdirSync(ws, { recursive: true });
    const { memos, memo } = addMemo(ws, { title: "プロンプト", body: "hello" });
    assert.equal(memos.length, 1);
    assert.equal(memo.title, "プロンプト");
    assert.equal(listMemos(ws).length, 1);
  });

  it("updates and deletes memo", () => {
    const ws = path.join(tmp, "proj2");
    fs.mkdirSync(ws, { recursive: true });
    const { memo } = addMemo(ws, { title: "A", body: "1" });
    const r = updateMemo(ws, memo.id, { body: "2" });
    assert.equal(r.memo.body, "2");
    const after = deleteMemo(ws, memo.id);
    assert.equal(after.length, 0);
  });

  it("reorders memos", () => {
    const ws = path.join(tmp, "proj3");
    fs.mkdirSync(ws, { recursive: true });
    const a = addMemo(ws, { title: "A", body: "" }).memo;
    const b = addMemo(ws, { title: "B", body: "" }).memo;
    const memos = reorderMemo(ws, b.id, "up");
    const ids = memos.map((m) => m.id);
    assert.deepEqual(ids, [b.id, a.id]);
  });
});
