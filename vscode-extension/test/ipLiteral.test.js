const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  getSecurityAllowlist,
  shouldFlagGlobalIpLiteral,
  isNgIpv4Pattern,
} = require("../src/noraops/securityAllowlist");
const { scanSecurityText } = require("../src/noraops/checkRunner");

describe("shouldFlagGlobalIpLiteral", () => {
  const allow = getSecurityAllowlist({ allowlist: { ips: [], ipv6: [] } });

  it("flags 172.* and 168 networks (NG)", () => {
    assert.equal(shouldFlagGlobalIpLiteral("192.168.1.10", allow), true);
    assert.equal(shouldFlagGlobalIpLiteral("172.16.0.1", allow), true);
    assert.equal(shouldFlagGlobalIpLiteral("172.31.255.254", allow), true);
    assert.equal(shouldFlagGlobalIpLiteral("168.1.2.3", allow), true);
    assert.ok(isNgIpv4Pattern("172.0.0.1"));
    assert.ok(isNgIpv4Pattern("192.168.0.1"));
  });

  it("ignores 10.* and loopback (low-risk exempt)", () => {
    assert.equal(shouldFlagGlobalIpLiteral("10.0.0.5", allow), false);
    assert.equal(shouldFlagGlobalIpLiteral("127.0.0.1", allow), false);
    assert.equal(shouldFlagGlobalIpLiteral("0.0.0.0", allow), false);
  });

  it("ignores allowlisted public DNS", () => {
    assert.equal(shouldFlagGlobalIpLiteral("8.8.8.8", allow), false);
  });

  it("flags other global public IPv4", () => {
    assert.equal(shouldFlagGlobalIpLiteral("93.184.216.34", allow), true);
    assert.equal(shouldFlagGlobalIpLiteral("1.1.1.1", allow), true);
  });
});

describe("scanSecurityText user relief whitelist", () => {
  const allow = getSecurityAllowlist({ allowlist: { ips: [], ipv6: [] } });
  const rule = {
    id: "sec.ip_literal",
    kind: "custom",
    custom: "ip_literal",
    severity: "error",
    message: "IP の直書きは禁止です",
    globs: ["**/*.py"],
  };

  it("downgrades whitelisted IP to warn with relief flag", () => {
    const findings = scanSecurityText(
      "app.py",
      'HOST = "192.168.1.50"',
      [rule],
      allow,
      ["192.168.1.50"]
    );
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, "warn");
    assert.equal(findings[0].userReliefWhitelist, true);
    assert.equal(findings[0].matchedIp, "192.168.1.50");
  });

  it("keeps unlisted IP as error", () => {
    const findings = scanSecurityText(
      "app.py",
      'HOST = "192.168.1.50"',
      [rule],
      allow,
      []
    );
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, "error");
    assert.equal(findings[0].userReliefWhitelist, undefined);
  });
});
