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

describe("accountRegistration", () => {
  /** @type {typeof import("../src/noraops/accountRegistration")} */
  let accountRegistration;
  /** @type {typeof import("../src/noraops/accessTokenAuth")} */
  let accessTokenAuth;

  before(() => {
    installVscodeMock();
    delete require.cache[require.resolve("../src/noraops/accessTokenAuth")];
    delete require.cache[require.resolve("../src/noraops/accountRegistration")];
    accessTokenAuth = require("../src/noraops/accessTokenAuth");
    accountRegistration = require("../src/noraops/accountRegistration");
  });

  after(async () => {
    await accessTokenAuth.clearAccessToken();
    restoreRequire();
  });

  it("registrationStatusLabel for open mode", () => {
    const label = accountRegistration.registrationStatusLabel("unknown", false, false);
    assert.equal(label.ok, true);
    assert.match(label.detail, /不要/);
  });

  it("registrationStatusLabel pending_email", () => {
    const label = accountRegistration.registrationStatusLabel("pending_email", true, true);
    assert.equal(label.ok, false);
    assert.equal(label.lamp, "ng");
  });

  it("registrationStatusLabel provisioned without token warns", async () => {
    await accessTokenAuth.clearAccessToken();
    const label = accountRegistration.registrationStatusLabel("provisioned", true, true);
    assert.equal(label.ok, false);
    assert.equal(label.lamp, "warn");
    assert.match(label.detail, /NoraAccessToken/);
  });

  it("registrationStatusLabel provisioned with token is ok", async () => {
    await accessTokenAuth.setAccessToken("test-access-token-value");
    const label = accountRegistration.registrationStatusLabel("provisioned", true, true);
    assert.equal(label.ok, true);
    assert.equal(label.lamp, "ok");
    await accessTokenAuth.clearAccessToken();
  });

  it("hasAccessToken reflects cache", async () => {
    await accessTokenAuth.clearAccessToken();
    assert.equal(accountRegistration.hasAccessToken(), false);
    await accessTokenAuth.setAccessToken("tok-abc");
    assert.equal(accountRegistration.hasAccessToken(), true);
    await accessTokenAuth.clearAccessToken();
  });
});
