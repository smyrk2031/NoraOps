const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const MEDIA = path.join(__dirname, "..", "media");
const WEBVIEWS = ["noraops-setup.html", "noraops-connect.html", "noraops-prompt.html", "noraops-home.html", "noraops-runner.html"];

function assertScriptParses(label, code) {
  try {
    // eslint-disable-next-line no-new-func
    new Function(code);
  } catch (e) {
    assert.fail(`${label}: ${e.message}`);
  }
}

describe("NoraOps webview HTML scripts", () => {
  for (const file of WEBVIEWS) {
    it(`${file} inline script parses`, () => {
      const html = fs.readFileSync(path.join(MEDIA, file), "utf8");
      const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
      assert.ok(blocks.length >= 1, `${file} has no inline script`);
      for (let i = 0; i < blocks.length; i++) {
        assertScriptParses(`${file} block ${i + 1}`, blocks[i][1]);
      }
    });
  }

  it("noraops-home.html defines renderCreatorWorkflow", () => {
    const html = fs.readFileSync(path.join(MEDIA, "noraops-home.html"), "utf8");
    assert.match(html, /function renderCreatorWorkflow\s*\(/);
  });
});
