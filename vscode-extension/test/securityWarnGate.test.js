const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { coalesceRunPrompt } = require("../src/noraops/runPromptCoalesce");

describe("coalesceRunPrompt", () => {
  it("runs fn only once for concurrent calls with same key", async () => {
    let count = 0;
    const fn = async () => {
      count += 1;
      await new Promise((r) => setTimeout(r, 20));
    };
    await Promise.all([
      coalesceRunPrompt("k", fn),
      coalesceRunPrompt("k", fn),
      coalesceRunPrompt("k", fn),
    ]);
    assert.equal(count, 1);
  });

  it("runs again after first completes", async () => {
    let count = 0;
    const fn = async () => {
      count += 1;
    };
    await coalesceRunPrompt("k2", fn);
    await coalesceRunPrompt("k2", fn);
    assert.equal(count, 2);
  });
});
