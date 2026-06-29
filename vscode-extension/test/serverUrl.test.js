const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { normalizePortalUrl, apiUrl } = require("../src/noraops/serverUrl");

describe("normalizePortalUrl", () => {
  it("accepts localhost dev", () => {
    const r = normalizePortalUrl("http://127.0.0.1:8000");
    assert.equal(r.ok, true);
    assert.equal(r.baseUrl, "http://127.0.0.1:8000");
  });

  it("accepts https with subpath for IIS", () => {
    const r = normalizePortalUrl("https://intranet.example.com/NoraOps/");
    assert.equal(r.ok, true);
    assert.equal(r.baseUrl, "https://intranet.example.com/NoraOps");
    assert.equal(r.pathPrefix, "/NoraOps");
  });

  it("strips accidental api suffix", () => {
    const r = normalizePortalUrl("http://10.0.0.5/NoraOps/api/v1/portal/health");
    assert.equal(r.ok, true);
    assert.equal(r.baseUrl, "http://10.0.0.5/NoraOps");
  });

  it("adds http scheme when missing", () => {
    const r = normalizePortalUrl("192.168.1.10:8000");
    assert.equal(r.ok, true);
    assert.equal(r.baseUrl, "http://192.168.1.10:8000");
  });
});

describe("apiUrl", () => {
  it("joins base and path", () => {
    assert.equal(
      apiUrl("https://host/NoraOps", "/api/v1/portal/health"),
      "https://host/NoraOps/api/v1/portal/health"
    );
  });
});
