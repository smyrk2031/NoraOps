const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  compressFileContent,
  normalizeCompressMode,
  PRESET_META,
  estimateCompressedLength,
} = require("../src/noraops/xllmCompress");

describe("xllmCompress", () => {
  it("normalizeCompressMode falls back to none", () => {
    assert.equal(normalizeCompressMode("bogus"), "none");
    assert.equal(normalizeCompressMode("structure"), "structure");
  });

  it("light mode strips hash comments in Python", () => {
    const src = '# comment\nx = 1\n\n\ny = 2\n';
    const out = compressFileContent(src, "main.py", "light");
    assert.doesNotMatch(out, /# comment/);
    assert.match(out, /x = 1/);
  });

  it("structure mode keeps Python def skeleton", () => {
    const src = `def foo():\n    a = 1\n    b = 2\n    return a + b\n`;
    const out = compressFileContent(src, "app.py", "structure");
    assert.match(out, /def foo/);
    assert.match(out, /\.\.\./);
    assert.doesNotMatch(out, /return a \+ b/);
  });

  it("structure mode compresses HTML whitespace", () => {
    const src = "<div>\n  <p>Hello world with long text here</p>\n</div>";
    const out = compressFileContent(src, "index.html", "structure");
    assert.ok(out.length < src.length);
    assert.match(out, /<div>/);
  });

  it("PRESET_META has four presets with hints", () => {
    assert.equal(PRESET_META.length, 4);
    assert.ok(PRESET_META.every((p) => p.id && p.label && p.hint));
  });

  it("estimateCompressedLength uses ratio", () => {
    assert.ok(estimateCompressedLength(1000, "structure") < estimateCompressedLength(1000, "none"));
  });
});
