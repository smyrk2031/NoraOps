const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const {
  fingerprint,
  suppressFingerprints,
  markReviewed,
  canPublishToRunner,
  getActivePublishBlockingWarns,
} = require("../src/noraops/securityWarnStore");

describe("securityWarnStore", () => {
  function withIsolatedStore(fn) {
    const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nora-warn-store-"));
    const prev = process.env.NORAOPS_LOCAL_ROOT;
    process.env.NORAOPS_LOCAL_ROOT = storeRoot;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nora-warn-"));
    try {
      fn(root);
    } finally {
      const { deleteWorkspaceRecord } = require("../src/noraops/workspaceStore");
      deleteWorkspaceRecord(root);
      if (prev === undefined) delete process.env.NORAOPS_LOCAL_ROOT;
      else process.env.NORAOPS_LOCAL_ROOT = prev;
      fs.rmSync(storeRoot, { recursive: true, force: true });
      fs.rmSync(root, { recursive: true, force: true });
    }
  }

  it("fingerprint is stable for same finding", () => {
    const f = { ruleId: "sec.email_literal", file: "a.py", line: 2, snippet: "x@y.com" };
    assert.equal(fingerprint(f), fingerprint(f));
  });

  it("suppress and reviewed clear publish blockers", () => {
    withIsolatedStore((root) => {
      const summary = {
      secPublishWarns: [
        {
          ruleId: "sec.email_literal",
          file: "a.py",
          line: 1,
          snippet: "a@b.co",
          blocksPublish: true,
          severity: "warn",
          category: "security",
        },
      ],
      secWarns: [
        {
          ruleId: "sec.email_literal",
          file: "a.py",
          line: 1,
          snippet: "a@b.co",
          blocksPublish: true,
          severity: "warn",
          category: "security",
        },
      ],
    };
    assert.equal(canPublishToRunner(root, summary), false);
    const fp = fingerprint(summary.secWarns[0]);
    markReviewed(root, [fp]);
    assert.equal(canPublishToRunner(root, summary), true);
    });
  });

  it("suppress hides warn from active list", () => {
    withIsolatedStore((root) => {
      const f = {
      ruleId: "sec.password_assignment",
      file: "b.py",
      line: 3,
      snippet: 'password="secret"',
      blocksPublish: true,
      severity: "warn",
      category: "security",
    };
    const summary = { secWarns: [f], secPublishWarns: [f] };
    const fp = fingerprint(f);
    suppressFingerprints(root, [fp]);
    assert.equal(getActivePublishBlockingWarns(root, summary).length, 0);
    });
  });
});
