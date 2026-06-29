const { test } = require("node:test");
const assert = require("node:assert/strict");
const { newAppId, normalizeAppId, repoSlugFromLabel } = require("../src/noraops/appIdentity");

test("newAppId returns nora.app.{uuid}", () => {
  const id = newAppId();
  assert.match(id, /^nora\.app\.[0-9a-f-]{36}$/);
});

test("normalizeAppId keeps uuid form", () => {
  const raw = "nora.app.abc-def";
  assert.equal(normalizeAppId(raw), raw);
});

test("repoSlugFromLabel slugifies Japanese to readable or hash", () => {
  const s = repoSlugFromLabel("請求ツール");
  assert.ok(s.length >= 2);
});
