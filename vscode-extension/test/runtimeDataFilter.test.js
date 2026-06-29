const assert = require("assert");
const { isDevRuntimeDataPath } = require("../src/noraops/runtimeDataFilter");

function test(name, fn) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}:`, e.message);
    process.exitCode = 1;
  }
}

test("excludes uploads subdir", () => {
  assert.strictEqual(isDevRuntimeDataPath("static/uploads/photo.png"), true);
  assert.strictEqual(isDevRuntimeDataPath("media/uploads/data.bin"), true);
  assert.strictEqual(isDevRuntimeDataPath("nora/dev/static/uploads/photo.png"), true);
  assert.strictEqual(isDevRuntimeDataPath("nora/dev/media/uploads/data.bin"), true);
});

test("includes source js in static root", () => {
  assert.strictEqual(isDevRuntimeDataPath("static/app.js"), false);
  assert.strictEqual(isDevRuntimeDataPath("static/styles/main.css"), false);
  assert.strictEqual(isDevRuntimeDataPath("nora/dev/static/app.js"), false);
  assert.strictEqual(isDevRuntimeDataPath("nora/dev/static/styles/main.css"), false);
});

test("excludes binary in static root", () => {
  assert.strictEqual(isDevRuntimeDataPath("static/logo.png"), true);
  assert.strictEqual(isDevRuntimeDataPath("media/clip.mp4"), true);
  assert.strictEqual(isDevRuntimeDataPath("nora/dev/static/logo.png"), true);
  assert.strictEqual(isDevRuntimeDataPath("nora/dev/media/clip.mp4"), true);
});

test("ignores paths outside static/media", () => {
  assert.strictEqual(isDevRuntimeDataPath("main.py"), false);
  assert.strictEqual(isDevRuntimeDataPath("nora/dev/main.py"), false);
  assert.strictEqual(isDevRuntimeDataPath("nora/assets/thumbnail.png"), false);
});
