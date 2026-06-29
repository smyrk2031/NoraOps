const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { validateReleaseReadiness } = require("../src/noraops/releaseValidation");

const emptySummary = { secErrors: [], polErrors: [], warns: [] };

function writePublishReadyWorkspace(ws, { readme = "md" } = {}) {
  fs.mkdirSync(path.join(ws, "nora", "packages"), { recursive: true });
  fs.writeFileSync(
    path.join(ws, "nora", "manifest.json"),
    JSON.stringify({
      schema: "nora.manifest/1",
      appId: "nora.app.test",
      displayName: "Test",
      language: "python",
      entry: "main.py",
      entryKind: "script",
      packagesProject: "nora/packages",
    }),
    "utf8"
  );
  fs.writeFileSync(path.join(ws, "nora", "packages", "pyproject.toml"), "[project]\nname='test'\n", "utf8");
  fs.writeFileSync(path.join(ws, "nora", "packages", "main.py"), "print('ok')\n", "utf8");
  fs.writeFileSync(path.join(ws, ".gitignore"), ".env\n.venv/\n", "utf8");
  if (readme === "md") fs.writeFileSync(path.join(ws, "README.md"), "# Test\n", "utf8");
  if (readme === "html") fs.writeFileSync(path.join(ws, "README.html"), "<p>Test</p>", "utf8");
}

describe("validateReleaseReadiness", () => {
  it("accepts workspace with README.md and pyproject", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "nora-rel-ok-"));
    try {
      writePublishReadyWorkspace(ws, { readme: "md" });
      const v = validateReleaseReadiness(ws, emptySummary);
      assert.equal(v.ok, true);
      assert.equal(v.errors.length, 0);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it("accepts README.html instead of README.md", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "nora-rel-html-"));
    try {
      writePublishReadyWorkspace(ws, { readme: "html" });
      const v = validateReleaseReadiness(ws, emptySummary);
      assert.equal(v.ok, true);
      const readmeItem = v.checklist.find((c) => c.id === "readme");
      assert.equal(readmeItem?.ok, true);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it("rejects missing README and pyproject", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "nora-rel-bad-"));
    try {
      fs.mkdirSync(path.join(ws, "nora"), { recursive: true });
      fs.writeFileSync(
        path.join(ws, "nora", "manifest.json"),
        JSON.stringify({ entry: "main.py", entryKind: "script" }),
        "utf8"
      );
      const v = validateReleaseReadiness(ws, emptySummary);
      assert.equal(v.ok, false);
      assert.ok(v.errors.some((e) => /README/i.test(e)));
      assert.ok(v.errors.some((e) => /pyproject/i.test(e)));
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it("rejects when policy or security errors exist in summary", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "nora-rel-pol-"));
    try {
      writePublishReadyWorkspace(ws);
      const v = validateReleaseReadiness(ws, {
        secErrors: [{ message: "IP" }],
        polErrors: [{ message: "gitignore" }],
        warns: [],
      });
      assert.equal(v.ok, false);
      assert.ok(v.errors.some((e) => /セキュリティ/.test(e)));
      assert.ok(v.errors.some((e) => /ポリシー/.test(e)));
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });
});
