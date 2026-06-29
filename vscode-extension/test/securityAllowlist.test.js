const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { getSecurityAllowlist } = require("../src/noraops/securityAllowlist");

describe("getSecurityAllowlist", () => {
  it("merges server allowlist with defaults including 8.8.8.8", () => {
    const allow = getSecurityAllowlist({ allowlist: { ips: ["127.0.0.1"], ipv6: [] } });
    assert.ok(allow.ips.includes("8.8.8.8"));
    assert.ok(allow.ips.includes("127.0.0.1"));
  });
});
