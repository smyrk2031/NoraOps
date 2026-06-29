const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { packageNameSlug } = require("../src/noraops/pathsMeta");

describe("packageNameSlug", () => {
  it("accepts ascii folder names", () => {
    assert.equal(packageNameSlug("My App"), "my-app");
    assert.equal(packageNameSlug("test01"), "test01");
  });

  it("maps japanese names to app-hash", () => {
    const s = packageNameSlug("テスト開発");
    assert.match(s, /^app-[a-f0-9]{8}$/);
    assert.equal(packageNameSlug("テスト開発"), s);
  });
});
