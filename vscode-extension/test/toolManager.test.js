const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { compareSemver, sha256File } = require("../src/toolManager");

test("compareSemver handles common orderings", () => {
  assert.equal(compareSemver("1.0.0", "1.0.0"), 0);
  assert.equal(compareSemver("1.1.0", "1.0.9"), 1);
  assert.equal(compareSemver("2.0.0", "2.0.1"), -1);
});

test("sha256File returns deterministic hash", async () => {
  const tmp = path.join(os.tmpdir(), `pygarden-hash-${Date.now()}.txt`);
  await fs.writeFile(tmp, "abc", "utf8");
  const hash = await sha256File(tmp);
  assert.equal(hash, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  await fs.rm(tmp, { force: true });
});
