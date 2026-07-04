const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { describe, it, beforeEach, afterEach } = require("node:test");

const { buildExportMarkdown, collectExportFileEntries } = require("../src/noraops/xllmExport");
const { parseFileBlocks, planApply, applyItems, summarizePlan } = require("../src/noraops/xllmApply");

describe("xllmExport", () => {
  /** @type {string} */
  let tmp;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nora-xllm-"));
    fs.writeFileSync(path.join(tmp, "main.py"), 'print("hi")\n', "utf8");
    fs.mkdirSync(path.join(tmp, "pkg"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "pkg", "util.py"), "x = 1\n", "utf8");
    fs.writeFileSync(path.join(tmp, ".env"), "SECRET=1\n", "utf8");
  });

  afterEach(() => {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("collects workspace files excluding .env", () => {
    const { files, skipped } = collectExportFileEntries(tmp, { mode: "all" });
    const rels = files.map((f) => f.rel);
    assert.ok(rels.includes("main.py"));
    assert.ok(rels.includes("pkg/util.py"));
    assert.equal(rels.includes(".env"), false);
    assert.ok(skipped.length >= 0);
  });

  it("buildExportMarkdown includes FILE blocks and user request", () => {
    const r = buildExportMarkdown({
      workspaceRoot: tmp,
      userRequest: "バリデーションを追加",
      scope: { mode: "all" },
    });
    assert.equal(r.ok, true);
    assert.match(r.markdown, /バリデーションを追加/);
    assert.match(r.markdown, /### FILE: main\.py/);
    assert.match(r.markdown, /print\("hi"\)/);
    assert.ok(r.tokenEstimate > 0);
    assert.doesNotMatch(r.markdown, /機密が混ざっていないか/);
    assert.match(r.markdown, /SemVer/);
    assert.match(r.markdown, /CHANGELOG\.md/);
    assert.match(r.markdown, /1 回の返答にまとめる/);
  });

  it("buildExportMarkdown error mode includes error log section", () => {
    const r = buildExportMarkdown({
      workspaceRoot: tmp,
      userRequest: "補足メモ",
      scope: { mode: "all" },
      mode: "error",
      errorLog: "Traceback (most recent call last):\n  File \"main.py\", line 1\nNameError: x",
    });
    assert.equal(r.ok, true);
    assert.match(r.markdown, /nora\.xllm-export-error\/1/);
    assert.match(r.markdown, /実行時エラー/);
    assert.match(r.markdown, /NameError: x/);
    assert.match(r.markdown, /エラー調査モード/);
    assert.match(r.markdown, /1 回の返答にまとめる/);
  });

  it("buildExportMarkdown docs mode lists docs bundle files", () => {
    const r = buildExportMarkdown({
      workspaceRoot: tmp,
      userRequest: "経理の月次集計を自動化",
      scope: { mode: "all" },
      mode: "docs",
    });
    assert.equal(r.ok, true);
    assert.match(r.markdown, /nora\.xllm-export-docs\/1/);
    assert.match(r.markdown, /docs\/README\.md/);
    assert.match(r.markdown, /docs\/仕様書\.md/);
    assert.match(r.markdown, /docs\/手順書\.md/);
    assert.match(r.markdown, /docs\/ライセンス\.md/);
    assert.match(r.markdown, /docs\/フローチャート\.md/);
    assert.match(r.markdown, /Mermaid/);
    assert.match(r.markdown, /経理の月次集計を自動化/);
    assert.match(r.markdown, /1 回の返答にまとめる/);
  });

  it("buildExportMarkdown embeds check notice when issues exist", () => {
    const r = buildExportMarkdown({
      workspaceRoot: tmp,
      userRequest: "テスト",
      scope: { mode: "all" },
      checkSummary: {
        secErrors: [{ file: "main.py", line: 1, message: "IP 直書き" }],
        polErrors: [],
        secWarns: [],
        findings: [],
      },
    });
    assert.equal(r.ok, true);
    assert.match(r.markdown, /チェック結果（送信前/);
    assert.match(r.markdown, /\[セキュリティ\] main\.py:1/);
    assert.equal(r.checkNotice.hasIssues, true);
    assert.equal(r.checkNotice.secErrors, 1);
  });

  it("buildExportMarkdown with structure compress shrinks Python body", () => {
    const body = `def heavy():\n${"    x = 1\n".repeat(40)}    return x\n`;
    fs.writeFileSync(path.join(tmp, "heavy.py"), body, "utf8");
    const full = buildExportMarkdown({
      workspaceRoot: tmp,
      userRequest: "test",
      scope: { mode: "pick", relPaths: ["heavy.py"] },
      compressMode: "none",
    });
    const compressed = buildExportMarkdown({
      workspaceRoot: tmp,
      userRequest: "test",
      scope: { mode: "pick", relPaths: ["heavy.py"] },
      compressMode: "structure",
    });
    assert.equal(full.ok, true);
    assert.equal(compressed.ok, true);
    assert.ok(compressed.charCount < full.charCount);
    assert.equal(compressed.compressMode, "structure");
  });

  it("pick scope includes files from different subfolders", () => {
    fs.mkdirSync(path.join(tmp, "other"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "other", "x.py"), "a=1\n", "utf8");
    const r = buildExportMarkdown({
      workspaceRoot: tmp,
      userRequest: "multi",
      scope: { mode: "pick", relPaths: ["main.py", "pkg/util.py", "other/x.py"] },
    });
    assert.equal(r.ok, true);
    assert.match(r.markdown, /### FILE: main\.py/);
    assert.match(r.markdown, /### FILE: pkg\/util\.py/);
    assert.match(r.markdown, /### FILE: other\/x\.py/);
  });
});

describe("xllmPolicyNotice", () => {
  const { buildCheckNoticeForPrompt } = require("../src/noraops/xllmPolicyNotice");

  it("returns empty when no issues", () => {
    const n = buildCheckNoticeForPrompt({ secErrors: [], polErrors: [], secWarns: [] });
    assert.equal(n.hasIssues, false);
    assert.equal(n.text, "");
  });

  it("summarizes security and policy errors", () => {
    const n = buildCheckNoticeForPrompt({
      secErrors: [{ file: "a.py", line: 2, message: "secret" }],
      polErrors: [{ file: "README.md", line: 0, message: "missing", ruleId: "pol.readme" }],
      secWarns: [],
    });
    assert.equal(n.hasIssues, true);
    assert.match(n.text, /\[セキュリティ\]/);
    assert.match(n.text, /\[ポリシー\]/);
  });
});

describe("xllmApply", () => {
  /** @type {string} */
  let tmp;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nora-xllm-apply-"));
    fs.writeFileSync(path.join(tmp, "main.py"), "old\n", "utf8");
  });

  afterEach(() => {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("parses FILE blocks from markdown", () => {
    const md = `### FILE: main.py
\`\`\`python
new
\`\`\`
### FILE: new.py
\`\`\`python
created
\`\`\``;
    const blocks = parseFileBlocks(md);
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].path, "main.py");
    assert.equal(blocks[0].content, "new");
    assert.equal(blocks[1].path, "new.py");
  });

  it("plans new and modified files", () => {
    const md = `### FILE: main.py
\`\`\`python
updated
\`\`\`
### FILE: extra.py
\`\`\`python
x = 1
\`\`\``;
    const { plan } = planApply(tmp, md);
    const main = plan.find((p) => p.path === "main.py");
    const extra = plan.find((p) => p.path === "extra.py");
    assert.equal(main.status, "modified");
    assert.equal(extra.status, "new");
    const counts = summarizePlan(plan);
    assert.equal(counts.modified, 1);
    assert.equal(counts.new, 1);
  });

  it("applyItems writes files", () => {
    const md = `### FILE: main.py
\`\`\`python
applied
\`\`\``;
    const { plan } = planApply(tmp, md);
    const item = plan.find((p) => p.path === "main.py");
    const { applied } = applyItems(tmp, [item]);
    assert.deepEqual(applied, ["main.py"]);
    assert.equal(fs.readFileSync(path.join(tmp, "main.py"), "utf8"), "applied");
  });

  it("plan includes diffSummary for modified files", () => {
    const md = `### FILE: main.py
\`\`\`python
line1
line2
\`\`\``;
    const { plan } = planApply(tmp, md);
    const main = plan.find((p) => p.path === "main.py");
    assert.equal(main.status, "modified");
    assert.ok(main.diffSummary);
    assert.ok(main.diffSummary.add >= 1);
  });
});

describe("xllmDiff", () => {
  const { buildLineDiff, summarizeDiff } = require("../src/noraops/xllmDiff");

  it("summarizes added and deleted lines", () => {
    const ops = buildLineDiff("a\nb", "a\nc");
    const s = summarizeDiff(ops);
    assert.equal(s.del, 1);
    assert.equal(s.add, 1);
    assert.ok(s.same >= 1);
  });
});

describe("xllmErrorCapture", () => {
  const { extractErrorSnippet } = require("../src/noraops/xllmErrorCapture");

  it("extracts traceback tail from long log", () => {
    const filler = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n");
    const log = filler + "\nTraceback (most recent call last):\nNameError: boom";
    const snip = extractErrorSnippet(log, 500);
    assert.match(snip, /NameError: boom/);
    assert.ok(snip.length <= 500);
  });
});

describe("xllmHistory", () => {
  let tmp;
  let storeRoot;

  beforeEach(() => {
    storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nora-xllm-store-"));
    process.env.NORAOPS_LOCAL_ROOT = storeRoot;
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nora-xllm-hist-ws-"));
    fs.writeFileSync(path.join(tmp, "main.py"), "v1\n", "utf8");
  });

  afterEach(() => {
    delete process.env.NORAOPS_LOCAL_ROOT;
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
      fs.rmSync(storeRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("creates snapshot and restores modified file", () => {
    const { createSnapshot, restoreSnapshot } = require("../src/noraops/xllmHistory");
    createSnapshot(tmp, [
      { path: "main.py", status: "modified", currentContent: "v1\n", newContent: "v2\n" },
    ]);
    fs.writeFileSync(path.join(tmp, "main.py"), "v2\n", "utf8");
    const result = restoreSnapshot(tmp, require("../src/noraops/xllmHistory").listSnapshots(tmp)[0].id);
    assert.equal(result.ok, true);
    assert.equal(fs.readFileSync(path.join(tmp, "main.py"), "utf8"), "v1\n");
  });

  it("restores by deleting files that were new", () => {
    const { createSnapshot, restoreSnapshot, listSnapshots } = require("../src/noraops/xllmHistory");
    createSnapshot(tmp, [{ path: "extra.py", status: "new", currentContent: "", newContent: "x\n" }]);
    fs.writeFileSync(path.join(tmp, "extra.py"), "x\n", "utf8");
    const id = listSnapshots(tmp)[0].id;
    const result = restoreSnapshot(tmp, id);
    assert.equal(result.ok, true);
    assert.equal(fs.existsSync(path.join(tmp, "extra.py")), false);
  });
});
