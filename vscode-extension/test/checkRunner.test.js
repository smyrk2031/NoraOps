const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { globMatch, matchesGlobs } = require("../src/noraops/globUtils");

describe("globMatch", () => {
  it("matches root-level main.py with **/*.py", () => {
    assert.equal(globMatch("main.py", "**/*.py"), true);
    assert.equal(globMatch("nora/packages/app.py", "**/*.py"), true);
  });

  it("excludes tests directory", () => {
    assert.equal(matchesGlobs("tests/test_api.py", ["**/*.py"], ["**/tests/**"]), false);
    assert.equal(matchesGlobs("main.py", ["**/*.py"], ["**/tests/**"]), true);
  });
});
