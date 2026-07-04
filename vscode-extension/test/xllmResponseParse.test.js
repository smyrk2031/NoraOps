const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  parseResponseBlocks,
  parseLooseFencedBlocks,
  appendResponseChunk,
} = require("../src/noraops/xllmResponseParse");
const { planApply } = require("../src/noraops/xllmApply");
const fs = require("fs");
const os = require("os");
const path = require("path");

describe("xllmResponseParse", () => {
  it("parses strict ### FILE blocks", () => {
    const md = `### FILE: main.py
\`\`\`python
x = 1
\`\`\``;
    const { blocks, meta } = parseResponseBlocks(md);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].path, "main.py");
    assert.equal(meta.strictCount, 1);
  });

  it("parses **filename** before fence (Gemini style)", () => {
    const md = `Here is the update:

**main.py**
\`\`\`python
print("hi")
\`\`\``;
    const { blocks } = parseResponseBlocks(md);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].path, "main.py");
    assert.equal(blocks[0].source, "loose");
  });

  it("parses File: path before fence", () => {
    const md = `File: src/util.py
\`\`\`python
def go(): pass
\`\`\``;
    const blocks = parseLooseFencedBlocks(md);
    assert.equal(blocks[0].path, "src/util.py");
  });

  it("parses fence info python:path", () => {
    const md = `\`\`\`python:pkg/a.py
y = 2
\`\`\``;
    const blocks = parseLooseFencedBlocks(md);
    assert.equal(blocks[0].path, "pkg/a.py");
  });

  it("ignores fences without path hint", () => {
    const md = `Some explanation
\`\`\`python
only_code = True
\`\`\``;
    const { blocks } = parseResponseBlocks(md);
    assert.equal(blocks.length, 0);
  });

  it("merges multiple chunks with appendResponseChunk", () => {
    const a = "**a.py**\n```\nx=1\n```";
    const b = "**b.py**\n```\ny=2\n```";
    const merged = appendResponseChunk(a, b);
    const { blocks } = parseResponseBlocks(merged);
    assert.equal(blocks.length, 2);
  });

  it("strict overrides loose for same path", () => {
    const md = `**main.py**
\`\`\`python
loose
\`\`\`
### FILE: main.py
\`\`\`python
strict
\`\`\``;
    const { blocks } = parseResponseBlocks(md);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].content, "strict");
    assert.equal(blocks[0].source, "strict");
  });

  it("planApply uses liberal parser", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nora-parse-"));
    fs.writeFileSync(path.join(tmp, "main.py"), "old\n", "utf8");
    const md = `**main.py**
\`\`\`python
new
\`\`\``;
    const { plan, parseCount, parseMeta } = planApply(tmp, md);
    assert.equal(parseCount, 1);
    assert.equal(parseMeta.strictCount, 0);
    assert.equal(plan[0].status, "modified");
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
