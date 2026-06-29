const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const {
  packagesDir,
  pyprojectPath,
  defaultWorkspaceVenvDir,
  probeExistingVenvDir,
  venvProbeCandidates,
} = require("../src/noraops/projectPaths");

describe("projectPaths", () => {
  it("prefers root pyproject.toml over nora/packages", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "nora-pp-root-"));
    try {
      fs.writeFileSync(path.join(ws, "pyproject.toml"), "[project]\nname='a'\n", "utf8");
      fs.mkdirSync(path.join(ws, "nora", "packages"), { recursive: true });
      fs.writeFileSync(path.join(ws, "nora", "packages", "pyproject.toml"), "[project]\nname='b'\n", "utf8");
      assert.equal(packagesDir(ws), ws);
      assert.equal(path.basename(packagesDir(ws)), path.basename(ws));
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it("falls back to nora/packages pyproject", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "nora-pp-legacy-"));
    try {
      fs.mkdirSync(path.join(ws, "nora", "packages"), { recursive: true });
      fs.writeFileSync(path.join(ws, "nora", "packages", "pyproject.toml"), "[project]\nname='b'\n", "utf8");
      assert.ok(pyprojectPath(ws).replace(/\\/g, "/").endsWith("nora/packages/pyproject.toml"));
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it("default venv is root .venv", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "nora-venv-def-"));
    try {
      assert.ok(defaultWorkspaceVenvDir(ws).endsWith(`${path.sep}.venv`));
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it("probes root .venv before legacy nora/packages/.venv", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "nora-venv-probe-"));
    try {
      const legacyVenv = path.join(ws, "nora", "packages", ".venv", "Scripts");
      fs.mkdirSync(legacyVenv, { recursive: true });
      fs.writeFileSync(path.join(legacyVenv, "python.exe"), "", "utf8");

      const rootVenv = path.join(ws, ".venv", "Scripts");
      fs.mkdirSync(rootVenv, { recursive: true });
      fs.writeFileSync(path.join(rootVenv, "python.exe"), "", "utf8");

      assert.equal(probeExistingVenvDir(ws), path.join(ws, ".venv"));
      assert.deepEqual(venvProbeCandidates(ws), [path.join(ws, ".venv"), path.join(ws, "nora", "packages", ".venv")]);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });
});
