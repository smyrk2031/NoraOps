const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const CLI = path.join(ROOT, "scripts", "repo-audit-cli.js");

describe("repo-audit-cli", () => {
  it("outputs JSON summary for a minimal workspace", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nora-audit-"));
    fs.writeFileSync(path.join(tmp, "README.md"), "# Demo\n\nHello audit.", "utf8");
    fs.mkdirSync(path.join(tmp, "nora"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, "pyproject.toml"),
      '[project]\nname="demo"\nrequires-python=">=3.11"\n',
      "utf8"
    );

    const rulesPath = path.join(tmp, "rules.json");
    fs.writeFileSync(
      rulesPath,
      JSON.stringify({
        schema: "nora.rules-bundle/1",
        security: { schema: "nora.rules/1", rules: [] },
        repo_policy: { schema: "nora.rules/1", rules: [] },
      }),
      "utf8"
    );

    const out = execFileSync(process.execPath, [CLI, "--workspace", tmp, "--rules", rulesPath], {
      cwd: ROOT,
      encoding: "utf8",
    });
    const payload = JSON.parse(out);
    assert.equal(payload.ok, true);
    assert.equal(payload.readme.path, "README.md");
    assert.equal(payload.pyproject.rel, "pyproject.toml");
    assert.equal(payload.summary.ok, true);
  });
});
