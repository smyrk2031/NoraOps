const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("module");

const originalRequire = Module.prototype.require;

function installVscodeMock() {
  Module.prototype.require = function patchedRequire(id) {
    if (id === "vscode") {
      return {
        workspace: {
          getConfiguration: () => ({
            get: () => "",
            update: async () => {},
          }),
        },
        ConfigurationTarget: { Global: 1 },
      };
    }
    return originalRequire.apply(this, arguments);
  };
}

function restoreRequire() {
  Module.prototype.require = originalRequire;
}

describe("authHeaders", () => {
  /** @type {typeof import("../src/noraops/accessTokenAuth")} */
  let accessTokenAuth;
  /** @type {typeof import("../src/noraops/authHeaders")} */
  let authHeaders;

  before(() => {
    installVscodeMock();
    delete require.cache[require.resolve("../src/noraops/deviceAuth")];
    delete require.cache[require.resolve("../src/noraops/sessionAuth")];
    delete require.cache[require.resolve("../src/noraops/accessTokenAuth")];
    delete require.cache[require.resolve("../src/noraops/authHeaders")];
    accessTokenAuth = require("../src/noraops/accessTokenAuth");
    authHeaders = require("../src/noraops/authHeaders");
  });

  after(async () => {
    await accessTokenAuth.clearAccessToken();
    restoreRequire();
  });

  it("adds X-NoraOps-Access-Token when access token is set", async () => {
    await accessTokenAuth.setAccessToken("header-test-token");
    const headers = await authHeaders.getAuthHeaders();
    assert.equal(headers["X-NoraOps-Access-Token"], "header-test-token");
    assert.equal(headers["X-NoraOps-Session-Token"], undefined);
    assert.equal(headers["X-NoraOps-Device-Token"], undefined);
    await accessTokenAuth.clearAccessToken();
  });

  it("returns empty headers without access token", async () => {
    await accessTokenAuth.clearAccessToken();
    const headers = await authHeaders.getAuthHeaders();
    assert.equal(headers["X-NoraOps-Access-Token"], undefined);
  });
});
