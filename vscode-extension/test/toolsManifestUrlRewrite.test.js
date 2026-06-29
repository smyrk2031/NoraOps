const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { rewriteToolUrlsForManifestOrigin } = require("../src/toolManager");

describe("rewriteToolUrlsForManifestOrigin", () => {
  it("rewrites localhost tool urls to manifest origin", () => {
    const manifest = {
      uv: { url: "http://127.0.0.1:8000/api/tools/files/uv/0.6.0/uv.exe" },
      portableGit: {
        url: "http://127.0.0.1:8000/api/tools/files/git/2.54.0/PortableGit-2.54.0-64-bit.7z.exe",
      },
    };
    const out = rewriteToolUrlsForManifestOrigin(
      manifest,
      "https://intra.example.local/NoraOps/api/tools/windows-x64/manifest.json"
    );
    assert.equal(out.uv.url, "https://intra.example.local/NoraOps/api/tools/files/uv/0.6.0/uv.exe");
    assert.equal(
      out.portableGit.url,
      "https://intra.example.local/NoraOps/api/tools/files/git/2.54.0/PortableGit-2.54.0-64-bit.7z.exe"
    );
  });
});
