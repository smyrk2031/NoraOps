const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

// vscode 非依存のファイル走査部分のみ（copilotByokCheck と同ロジック）
function scanFilesOnly(workspaceRoot, patterns) {
  const findings = [];
  const files = [path.join(workspaceRoot, ".env"), path.join(workspaceRoot, "src", "api_key.txt")];
  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    const rel = path.relative(workspaceRoot, f).replace(/\\/g, "/").toLowerCase();
    const base = path.basename(f).toLowerCase();
    for (const pat of patterns) {
      if (base.includes(pat) || rel.includes(pat)) {
        findings.push({ severity: base === ".env" ? "error" : "warn", message: rel });
        break;
      }
    }
  }
  return findings;
}

describe("copilot secret patterns", () => {
  it("flags .env in workspace", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nora-copilot-"));
    try {
      fs.writeFileSync(path.join(tmp, ".env"), "SECRET=1\n");
      const findings = scanFilesOnly(tmp, [".env", "api_key"]);
      assert.ok(findings.some((f) => f.severity === "error"));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
