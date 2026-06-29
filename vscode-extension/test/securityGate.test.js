const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { shouldBlockExecution } = require("../src/noraops/securityGatePolicy");

describe("shouldBlockExecution", () => {
  it("blocks when secErrors exist regardless of online", () => {
    const summary = {
      secErrors: [{ ruleId: "sec.ip_literal", file: "main.py", line: 1 }],
    };
    assert.equal(shouldBlockExecution(summary), true);
  });

  it("allows when no secErrors", () => {
    assert.equal(shouldBlockExecution({ secErrors: [] }), false);
    assert.equal(shouldBlockExecution({ secWarns: [{ ruleId: "x" }] }), false);
  });
});
