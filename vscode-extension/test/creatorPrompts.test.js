const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { describe, it, beforeEach, afterEach } = require("node:test");

const {
  listBuiltinPrompts,
  listCustom,
  addCustom,
  updateCustom,
  deleteCustom,
  reorderCustom,
  setBuiltinEnabled,
  listXllmChoices,
  resolvePromptForExport,
  migrateFromMemos,
} = require("../src/noraops/creatorPrompts");
const { getBuiltinDef, getCatalogVersion } = require("../src/noraops/builtinPromptCatalog");
const { legacyModeToPromptKey, resolvePromptBody } = require("../src/noraops/promptResolve");
const { isCatalogVersionNewer } = require("../src/noraops/catalogVersion");
const { buildSingleDocInstructions, buildDocPortalInstructions, readWorkspaceVersionContext, listDocsFolderFiles } = require("../src/noraops/xllmPromptModes");

describe("creatorPrompts", () => {
  /** @type {string} */
  let tmp;
  /** @type {string | undefined} */
  let prevRoot;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nora-prompt-"));
    prevRoot = process.env.NORAOPS_LOCAL_ROOT;
    process.env.NORAOPS_LOCAL_ROOT = tmp;
  });

  afterEach(() => {
    if (prevRoot == null) delete process.env.NORAOPS_LOCAL_ROOT;
    else process.env.NORAOPS_LOCAL_ROOT = prevRoot;
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  function ws(name = "proj") {
    const p = path.join(tmp, name);
    fs.mkdirSync(p, { recursive: true });
    return p;
  }

  it("lists builtin prompts with defaults enabled", () => {
    const builtins = listBuiltinPrompts(ws());
    assert.ok(builtins.length >= 14);
    const general = builtins.find((p) => p.key === "xllm.general");
    assert.ok(general);
    assert.equal(general.enabled, true);
    assert.equal(general.showInXllm, true);
  });

  it("toggles builtin enabled state", () => {
    const root = ws("t1");
    setBuiltinEnabled(root, "xllm.general", false);
    const g = listBuiltinPrompts(root).find((p) => p.key === "xllm.general");
    assert.equal(g.enabled, false);
    assert.equal(listXllmChoices(root).some((c) => c.key === "xllm.general"), false);
  });

  it("CRUD custom prompts", () => {
    const root = ws("t2");
    const { prompt } = addCustom(root, { title: "独自", body: "hello", showInXllm: true });
    assert.equal(listCustom(root).length, 1);
    const r = updateCustom(root, prompt.id, { body: "updated" });
    assert.equal(r.prompt.body, "updated");
    deleteCustom(root, prompt.id);
    assert.equal(listCustom(root).length, 0);
  });

  it("reorders custom prompts", () => {
    const root = ws("t3");
    const a = addCustom(root, { title: "A", body: "" }).prompt;
    const b = addCustom(root, { title: "B", body: "" }).prompt;
    const after = reorderCustom(root, b.id, "up");
    assert.deepEqual(after.map((p) => p.id), [b.id, a.id]);
  });

  it("includes enabled custom in xllm choices", () => {
    const root = ws("t4");
    addCustom(root, { title: "マイ", body: "x", showInXllm: true });
    const keys = listXllmChoices(root).map((c) => c.key);
    assert.ok(keys.some((k) => k.startsWith("custom.")));
  });

  it("resolves custom prompt for export", () => {
    const root = ws("t5");
    const { prompt } = addCustom(root, { title: "T", body: "BODY", showInXllm: true });
    const key = `custom.${prompt.id}`;
    const r = resolvePromptForExport(root, key);
    assert.equal(r.ok, true);
    assert.equal(r.body, "BODY");
  });

  it("migrates legacy memos to custom prompts", () => {
    const root = ws("t6");
    const { writeWorkspaceRecord } = require("../src/noraops/workspaceStore");
    writeWorkspaceRecord(root, {
      creatorMemos: [{ id: "m1", title: "旧メモ", body: "memo body", order: 0 }],
      creatorMemosSchema: "nora.creator-memos/1",
    });
    migrateFromMemos(root);
    const custom = listCustom(root);
    assert.equal(custom.length, 1);
    assert.equal(custom[0].title, "旧メモ");
    assert.equal(custom[0].showInXllm, false);
  });
});

describe("promptResolve", () => {
  it("maps legacy modes to prompt keys", () => {
    assert.equal(legacyModeToPromptKey("error"), "xllm.error");
    assert.equal(legacyModeToPromptKey("docs"), "xllm.docs.bundle");
    assert.equal(legacyModeToPromptKey("general"), "xllm.general");
  });

  it("builds teardown doc instructions", () => {
    const text = buildSingleDocInstructions("teardown", { version: "1.0.0", appName: "TestApp" });
    assert.match(text, /解体新書/);
    assert.match(text, /docs\/解体新書\.md/);
    assert.match(text, /TestApp/);
  });

  it("builds spec HTML instructions with UI restoration", () => {
    const text = buildSingleDocInstructions("specHtml", { appName: "在庫管理", workspaceFolder: "zaiko" });
    assert.match(text, /仕様書\.html/);
    assert.match(text, /UI 復元/);
    assert.match(text, /在庫管理/);
  });

  it("builds doc portal instructions listing docs files", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nora-portal-"));
    const docs = path.join(tmp, "docs");
    fs.mkdirSync(docs, { recursive: true });
    fs.writeFileSync(path.join(docs, "README.md"), "# hi\n");
    const files = listDocsFolderFiles(tmp);
    assert.deepEqual(files, ["README.md"]);
    const text = buildDocPortalInstructions({ appName: "App", docsFiles: files });
    assert.match(text, /ドキュメント統括\.html/);
    assert.match(text, /README\.md/);
    assert.match(text, /タブ/);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("resolves xllm.general body with workspace folder name", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nora-pr-"));
    fs.writeFileSync(path.join(tmp, "main.py"), "x=1\n");
    const ctx = readWorkspaceVersionContext(tmp);
    assert.equal(ctx.workspaceFolder, path.basename(tmp));
    const body = resolvePromptBody("xllm.general", tmp);
    assert.match(body, /通常モード/);
    assert.match(body, new RegExp(path.basename(tmp)));
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe("catalogVersion", () => {
  it("isCatalogVersionNewer only when remote is ahead", () => {
    assert.equal(isCatalogVersionNewer("0.22.0", "0.21.1"), true);
    assert.equal(isCatalogVersionNewer("0.21.0", "0.21.1"), false);
    assert.equal(isCatalogVersionNewer("0.21.1", "0.21.1"), false);
  });
});

describe("builtinPromptCatalog", () => {
  it("has catalog version and new doc prompts", () => {
    assert.equal(getCatalogVersion(), "0.28.1");
    assert.ok(getBuiltinDef("xllm.docs.spec-html"));
    assert.ok(getBuiltinDef("xllm.docs.portal"));
  });
});
