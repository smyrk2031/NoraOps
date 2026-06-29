const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const {
  runnerEnvDir,
  runnerEnvDirFromWorkspace,
  parseRunnerCacheFromWorkspace,
} = require("../src/noraops/runner/runnerPaths");
const {
  thumbnailAbsPath,
  rootThumbnailAbsPath,
  applyThumbnailBuffer,
  legacyThumbnailAbsPath,
} = require("../src/noraops/thumbnailAsset");

describe("runnerPaths", () => {
  it("maps runner-apps workspace to runner-envs dir", () => {
    const ws = "C:/Users/x/AppData/Local/NoraOps/runner-apps/team__my-app";
    const parsed = parseRunnerCacheFromWorkspace(ws);
    assert.equal(parsed.owner, "team");
    assert.equal(parsed.name, "my-app");
    assert.ok(runnerEnvDirFromWorkspace(ws).replace(/\\/g, "/").includes("runner-envs/team__my-app"));
    assert.equal(runnerEnvDir("team", "my-app"), runnerEnvDirFromWorkspace(ws));
  });
});

describe("thumbnailAsset", () => {
  it("saves thumbnail to root assets/", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nora-thumb-root-"));
    try {
      const p = rootThumbnailAbsPath(dir);
      assert.ok(p.endsWith(path.join("assets", "thumbnail.png")));
      assert.ok(!p.includes(`${path.sep}nora${path.sep}assets`));
      applyThumbnailBuffer(dir, Buffer.from("fakepng"));
      assert.ok(fs.existsSync(p));
      assert.ok(fs.existsSync(thumbnailAbsPath(dir)));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads legacy nora/assets thumbnail", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nora-thumb-legacy-"));
    try {
      const legacy = legacyThumbnailAbsPath(dir);
      fs.mkdirSync(path.dirname(legacy), { recursive: true });
      fs.writeFileSync(legacy, "legacy", "utf8");
      assert.equal(thumbnailAbsPath(dir), legacy);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("thumbnail path when workspace is nora/ folder (no double nora)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nora-thumb-nora-"));
    const noraDir = path.join(dir, "nora");
    try {
      fs.mkdirSync(noraDir, { recursive: true });
      applyThumbnailBuffer(noraDir, Buffer.from("fakepng"));
      const p = rootThumbnailAbsPath(noraDir);
      assert.strictEqual(p, path.join(dir, "assets", "thumbnail.png"));
      assert.ok(fs.existsSync(p));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
