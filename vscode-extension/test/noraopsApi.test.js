const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const https = require("https");
const Module = require("module");

const originalRequire = Module.prototype.require;
const originalHttpRequest = http.request;
const originalHttpsRequest = https.request;
const requests = [];

function installMocks() {
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
    if (id === "./authHeaders") {
      return {
        getAuthHeaders: async () => ({ "X-NoraOps-Access-Token": "test-token" }),
      };
    }
    return originalRequire.apply(this, arguments);
  };

  function mockRequest(lib) {
    lib.request = (opts, cb) => {
      requests.push({
        method: opts.method,
        headers: opts.headers,
        path: opts.path,
      });
      const req = {
        on() {
          return this;
        },
        write() {},
        end() {
          const res = {
            statusCode: 200,
            on(event, handler) {
              if (event === "data") handler('{"ok":true,"available":true}');
              if (event === "end") handler();
            },
          };
          cb(res);
        },
        destroy() {},
      };
      return req;
    };
  }

  mockRequest(http);
  mockRequest(https);
}

function restoreMocks() {
  Module.prototype.require = originalRequire;
  http.request = originalHttpRequest;
  https.request = originalHttpsRequest;
}

describe("noraopsApi auth headers", () => {
  /** @type {typeof import("../src/noraops/noraopsApi")} */
  let noraopsApi;

  before(() => {
    installMocks();
    delete require.cache[require.resolve("../src/noraops/authHeaders")];
    delete require.cache[require.resolve("../src/noraops/noraopsApi")];
    noraopsApi = require("../src/noraops/noraopsApi");
  });

  after(() => {
    restoreMocks();
  });

  it("sends auth headers for checkRepoName and provisionRepo", async () => {
    requests.length = 0;
    await noraopsApi.checkRepoName("https://example.local", "demo-app", "alice");
    await noraopsApi.provisionRepo("https://example.local", {
      name: "demo-app",
      owner: "alice",
      displayName: "Demo",
      appId: "nora.app.demo-1",
    });
    assert.equal(requests.length, 2);
    for (const req of requests) {
      assert.equal(req.headers["X-NoraOps-Access-Token"], "test-token");
    }
    assert.match(requests[0].path, /\/api\/v1\/repos\/check-name/);
    assert.match(requests[1].path, /\/api\/v1\/repos\/provision/);
  });
});
