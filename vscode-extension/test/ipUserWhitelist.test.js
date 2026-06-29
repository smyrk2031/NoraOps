const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  validateIpAddress,
  isUserIpWhitelisted,
  normalizeList,
} = require("../src/noraops/ipUserWhitelist");

describe("ipUserWhitelist", () => {
  it("validates IPv4", () => {
    assert.equal(validateIpAddress("192.168.1.1").ok, true);
    assert.equal(validateIpAddress("999.1.1.1").ok, false);
    assert.equal(validateIpAddress("").ok, false);
  });

  it("isUserIpWhitelisted compares case-insensitively", () => {
    const list = ["192.168.1.10"];
    assert.ok(isUserIpWhitelisted("192.168.1.10", list));
    assert.ok(isUserIpWhitelisted("192.168.1.10", list));
    assert.equal(isUserIpWhitelisted("10.0.0.1", list), false);
  });

  it("normalizeList dedupes and drops invalid", () => {
    const out = normalizeList(["192.168.0.1", "192.168.0.1", "bad", "10.0.0.2"]);
    assert.deepEqual(out, ["192.168.0.1", "10.0.0.2"]);
  });
});
