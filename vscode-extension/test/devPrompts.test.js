const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const {
  pyprojectRelForPrompt,
  buildRequirementsToPyprojectPrompt,
  buildEnvDepsPrompt,
} = require("../src/noraops/devPrompts");

describe("devPrompts pyproject paths", () => {
  it("buildEnvDepsPrompt references root pyproject.toml", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "nora-devprompt-"));
    try {
      fs.writeFileSync(path.join(ws, "pyproject.toml"), "[project]\nname = \"t\"\n", "utf8");
      const prompt = buildEnvDepsPrompt(ws, "Test App");
      assert.match(prompt, /`pyproject\.toml`/);
      assert.doesNotMatch(prompt, /nora\/packages\/pyproject\.toml/);
      assert.match(prompt, /readme = "README\.md"/);
      assert.match(prompt, /ルート `\.venv`/);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it("buildRequirementsToPyprojectPrompt uses workspace-relative pyproject path", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "nora-devprompt-req-"));
    try {
      fs.writeFileSync(path.join(ws, "requirements.txt"), "flask\n", "utf8");
      const prompt = buildRequirementsToPyprojectPrompt(ws, "requirements.txt", "Import App");
      assert.match(prompt, /`pyproject\.toml`/);
      assert.doesNotMatch(prompt, /nora\/packages\/pyproject\.toml/);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it("pyprojectRelForPrompt falls back when missing", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "nora-devprompt-miss-"));
    try {
      assert.equal(pyprojectRelForPrompt(ws), "pyproject.toml");
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });
});
