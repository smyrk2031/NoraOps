const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const {
  discoverRequirementsFiles,
  suggestRequirementsPath,
} = require("../src/noraops/importEnvAssist");

describe("importEnvAssist", () => {
  it("discovers requirements.txt excluding .venv", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "nora-req-disc-"));
    try {
      fs.writeFileSync(path.join(ws, "requirements.txt"), "flask\n", "utf8");
      fs.mkdirSync(path.join(ws, "sub"), { recursive: true });
      fs.writeFileSync(path.join(ws, "sub", "requirements-dev.txt"), "pytest\n", "utf8");
      fs.mkdirSync(path.join(ws, ".venv", "lib"), { recursive: true });
      fs.writeFileSync(path.join(ws, ".venv", "lib", "requirements.txt"), "ignore\n", "utf8");
      const found = discoverRequirementsFiles(ws);
      assert.ok(found.includes("requirements.txt"));
      assert.ok(found.includes("sub/requirements-dev.txt"));
      assert.equal(found.some((p) => p.includes(".venv")), false);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it("suggestRequirementsPath prefers root requirements.txt", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "nora-req-sug-"));
    try {
      fs.writeFileSync(path.join(ws, "requirements.txt"), "a\n", "utf8");
      fs.mkdirSync(path.join(ws, "sub"), { recursive: true });
      fs.writeFileSync(path.join(ws, "sub", "requirements-other.txt"), "b\n", "utf8");
      const found = discoverRequirementsFiles(ws);
      assert.equal(suggestRequirementsPath(ws, found), "requirements.txt");
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it("suggestRequirementsPath picks sole match", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "nora-req-one-"));
    try {
      fs.mkdirSync(path.join(ws, "legacy"), { recursive: true });
      fs.writeFileSync(path.join(ws, "legacy", "requirements.txt"), "x\n", "utf8");
      const found = discoverRequirementsFiles(ws);
      assert.equal(suggestRequirementsPath(ws, found), "legacy/requirements.txt");
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });
});
