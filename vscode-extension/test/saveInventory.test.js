const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { buildEnvDepsPrompt } = require("../src/noraops/devPrompts");
const { buildSaveInventory } = require("../src/noraops/saveInventory");

function test(name, fn) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}:`, e.message);
    process.exitCode = 1;
  }
}

test("buildEnvDepsPrompt does not throw without noraJoin error", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nora-env-prompt-"));
  try {
    fs.writeFileSync(path.join(dir, "main.py"), "print('hi')\n", "utf8");
    const prompt = buildEnvDepsPrompt(dir, "テスト");
    assert.ok(prompt.includes("Python 環境"));
    assert.ok(prompt.includes("print('hi')"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("buildSaveInventory classifies static js vs png", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nora-inv-"));
  try {
    const staticDir = path.join(dir, "static");
    fs.mkdirSync(staticDir, { recursive: true });
    fs.writeFileSync(path.join(staticDir, "app.js"), "console.log(1)", "utf8");
    fs.writeFileSync(path.join(staticDir, "logo.png"), "png", "utf8");
    const inv = buildSaveInventory(dir);
    const inc = inv.included.map((f) => f.rel);
    const exc = inv.excluded.map((f) => f.rel);
    assert.ok(inc.includes("static/app.js"));
    assert.ok(exc.includes("static/logo.png"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
