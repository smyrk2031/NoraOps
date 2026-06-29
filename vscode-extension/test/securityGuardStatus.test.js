const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { RULE_NG_EXAMPLES } = require("../src/noraops/securityRuleCatalog");
const { readBundledRules } = require("../src/noraops/rulesClient");

describe("securityGuardStatus RULE_NG_EXAMPLES", () => {
  it("has five NG examples for every bundled security rule", () => {
    const rules = readBundledRules().security?.rules || [];
    for (const rule of rules) {
      const examples = RULE_NG_EXAMPLES[rule.id];
      assert.ok(examples, `missing RULE_NG_EXAMPLES for ${rule.id}`);
      assert.equal(examples.length, 5, `${rule.id} should have 5 examples`);
      for (const ex of examples) {
        assert.ok(String(ex).trim().length > 0, `${rule.id} has empty example`);
      }
    }
  });
});
