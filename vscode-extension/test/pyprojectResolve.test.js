const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { resolvePyproject, discoverPyprojectCandidates } = require("../src/noraops/pyprojectResolve");
const { packagesDir } = require("../src/noraops/projectPaths");

function mkws(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("pyprojectResolve", () => {
  it("prefers root over legacy and shallow", () => {
    const ws = mkws("nora-pyr-root-");
    try {
      fs.writeFileSync(path.join(ws, "pyproject.toml"), "[project]\nname='root'\n", "utf8");
      fs.mkdirSync(path.join(ws, "nora", "packages"), { recursive: true });
      fs.writeFileSync(path.join(ws, "nora", "packages", "pyproject.toml"), "[project]\nname='legacy'\n", "utf8");
      fs.mkdirSync(path.join(ws, "backend"), { recursive: true });
      fs.writeFileSync(path.join(ws, "backend", "pyproject.toml"), "[project]\nname='backend'\n", "utf8");
      const r = resolvePyproject(ws);
      assert.equal(r.ok, true);
      assert.equal(r.source, "root");
      assert.equal(r.pyprojectRel, "pyproject.toml");
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it("uses manifest packagesProject first", () => {
    const ws = mkws("nora-pyr-man-");
    try {
      fs.mkdirSync(path.join(ws, "nora"), { recursive: true });
      fs.writeFileSync(
        path.join(ws, "nora", "manifest.json"),
        JSON.stringify({ packagesProject: "backend", appId: "nora.app.test" }),
        "utf8"
      );
      fs.writeFileSync(path.join(ws, "pyproject.toml"), "[project]\nname='root'\n", "utf8");
      fs.mkdirSync(path.join(ws, "backend"), { recursive: true });
      fs.writeFileSync(path.join(ws, "backend", "pyproject.toml"), "[project]\nname='backend'\n", "utf8");
      const r = resolvePyproject(ws);
      assert.equal(r.source, "manifest");
      assert.equal(r.pyprojectRel, "backend/pyproject.toml");
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it("finds shallow backend when root and legacy missing", () => {
    const ws = mkws("nora-pyr-shallow-");
    try {
      fs.mkdirSync(path.join(ws, "backend"), { recursive: true });
      fs.writeFileSync(path.join(ws, "backend", "pyproject.toml"), "[project]\nname='b'\n", "utf8");
      const r = resolvePyproject(ws);
      assert.equal(r.ok, true);
      assert.equal(r.source, "shallow");
      assert.equal(r.pyprojectRel, "backend/pyproject.toml");
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it("prefers app/ over z-other at shallow tier", () => {
    const ws = mkws("nora-pyr-pref-");
    try {
      fs.mkdirSync(path.join(ws, "z-other"), { recursive: true });
      fs.writeFileSync(path.join(ws, "z-other", "pyproject.toml"), "[project]\nname='z'\n", "utf8");
      fs.mkdirSync(path.join(ws, "app"), { recursive: true });
      fs.writeFileSync(path.join(ws, "app", "pyproject.toml"), "[project]\nname='app'\n", "utf8");
      const cands = discoverPyprojectCandidates(ws, { readManifest: false });
      const shallow = cands.filter((c) => c.source === "shallow");
      assert.equal(shallow[0].dirRel, "app");
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it("does not scan deeper than one level", () => {
    const ws = mkws("nora-pyr-deep-");
    try {
      fs.mkdirSync(path.join(ws, "backend", "inner"), { recursive: true });
      fs.writeFileSync(path.join(ws, "backend", "inner", "pyproject.toml"), "[project]\nname='deep'\n", "utf8");
      const r = resolvePyproject(ws, { readManifest: false });
      assert.equal(r.ok, false);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it("projectPaths.packagesDir uses resolvePyproject", () => {
    const ws = mkws("nora-pyr-pkgdir-");
    try {
      fs.mkdirSync(path.join(ws, "app"), { recursive: true });
      fs.writeFileSync(path.join(ws, "app", "pyproject.toml"), "[project]\nname='a'\n", "utf8");
      assert.ok(packagesDir(ws).replace(/\\/g, "/").endsWith("/app"));
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });
});
