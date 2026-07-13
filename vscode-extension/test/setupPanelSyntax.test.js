const { test } = require("node:test");
const assert = require("node:assert/strict");
const { execSync } = require("child_process");
const path = require("path");

test("setupPanel.js passes node syntax check", () => {
  const file = path.join(__dirname, "../src/noraops/setupPanel.js");
  assert.doesNotThrow(() => {
    execSync(`node --check "${file}"`, { stdio: "pipe" });
  });
});
