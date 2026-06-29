const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const {
  MODES,
  normalizeProfile,
  railAvailability,
  writeCreatorProfile,
} = require("../src/noraops/creatorWorkflow");
const {
  ensureScaffoldForProfile,
  ensureImportScaffold,
  ensureGreenfieldScaffold,
  noraJoin,
} = require("../src/noraops/scaffold");
const { writeWorkspaceSession } = require("../src/noraops/pathsMeta");

function withStoreRoot(fn) {
  const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nora-scaffold-store-"));
  const prev = process.env.NORAOPS_LOCAL_ROOT;
  process.env.NORAOPS_LOCAL_ROOT = storeRoot;
  try {
    fn(storeRoot);
  } finally {
    if (prev === undefined) delete process.env.NORAOPS_LOCAL_ROOT;
    else process.env.NORAOPS_LOCAL_ROOT = prev;
    fs.rmSync(storeRoot, { recursive: true, force: true });
  }
}

describe("creatorWorkflow profiles", () => {
  it("normalizeProfile maps fork and venv aliases", () => {
    assert.equal(normalizeProfile("fork"), MODES.IMPORT);
    assert.equal(normalizeProfile("venv-only"), MODES.VENV_ONLY);
    assert.equal(normalizeProfile("env-only"), MODES.VENV_ONLY);
  });

  it("railAvailability disables mock/dev/cloud for venv-only", () => {
    const rails = railAvailability(MODES.VENV_ONLY);
    assert.equal(rails.mock, false);
    assert.equal(rails.dev, false);
    assert.equal(rails.env, true);
    assert.equal(rails.cloud, false);
  });
});

describe("ensureScaffoldForProfile", () => {
  it("venv-only creates nothing", () => {
    withStoreRoot(() => {
      const ws = fs.mkdtempSync(path.join(os.tmpdir(), "nora-scaffold-venv-"));
      try {
        writeCreatorProfile(ws, MODES.VENV_ONLY);
        const r = ensureScaffoldForProfile(ws);
        assert.equal(r.skipped, true);
        assert.equal(r.created.length, 0);
        assert.equal(fs.existsSync(noraJoin(ws, "manifest.json")), false);
      } finally {
        fs.rmSync(ws, { recursive: true, force: true });
      }
    });
  });

  it("import creates manifest and root pyproject without dev/mock", () => {
    withStoreRoot(() => {
      const ws = fs.mkdtempSync(path.join(os.tmpdir(), "nora-scaffold-import-"));
      try {
        writeCreatorProfile(ws, MODES.IMPORT);
        const r = ensureImportScaffold(ws);
        assert.ok(r.created.includes("nora/manifest.json"));
        assert.ok(r.created.includes("pyproject.toml"));
        assert.equal(fs.existsSync(noraJoin(ws, "dev", "main.py")), false);
        assert.equal(fs.existsSync(noraJoin(ws, "mock", "index.html")), false);
        const man = JSON.parse(fs.readFileSync(noraJoin(ws, "manifest.json"), "utf8"));
        assert.equal(man.entry, "main.py");
      } finally {
        fs.rmSync(ws, { recursive: true, force: true });
      }
    });
  });

  it("greenfield creates root main.py, mock, and main.py entry in manifest", () => {
    withStoreRoot(() => {
      const ws = fs.mkdtempSync(path.join(os.tmpdir(), "nora-scaffold-gf-"));
      try {
        writeCreatorProfile(ws, MODES.GREENFIELD);
        const r = ensureGreenfieldScaffold(ws);
        assert.ok(r.created.some((p) => p === "main.py" || p.includes("main.py")));
        assert.ok(r.created.some((p) => p.includes("nora/mock")));
        assert.ok(r.created.includes("pyproject.toml"));
        const man = JSON.parse(fs.readFileSync(noraJoin(ws, "manifest.json"), "utf8"));
        assert.equal(man.entry, "main.py");
        assert.equal(fs.existsSync(noraJoin(ws, "dev", "main.py")), false);
      } finally {
        fs.rmSync(ws, { recursive: true, force: true });
      }
    });
  });
});
