const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

const EXTENSION_ROOT = path.join(__dirname, "..", "..");

function readBundledRules() {
  const secPath = path.join(EXTENSION_ROOT, "resources", "checks", "security.rules.json");
  const polPath = path.join(EXTENSION_ROOT, "resources", "checks", "repo-policy.rules.json");
  return {
    schema: "nora.rules-bundle/1",
    security: JSON.parse(fs.readFileSync(secPath, "utf8")),
    repo_policy: JSON.parse(fs.readFileSync(polPath, "utf8")),
    source: "bundled",
  };
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(url, { timeout: 8000 }, (res) => {
      if (res.statusCode === 304) {
        resolve({ notModified: true });
        return;
      }
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        try {
          resolve({ json: JSON.parse(body), etag: res.headers.etag });
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
  });
}

async function loadRulesBundle(rulesUrl, cachedEtag) {
  try {
    const url = cachedEtag ? `${rulesUrl}` : rulesUrl;
    const headers = cachedEtag ? { "If-None-Match": `"${cachedEtag}"` } : {};
    const result = await fetchJsonWithHeaders(url, headers);
    if (result.notModified && cachedEtag) {
      return { bundle: null, useCache: true, online: true };
    }
    if (result.json) {
      const etag = (result.etag || "").replace(/"/g, "") || result.json.etag;
      return { bundle: { ...result.json, source: "server" }, etag, online: true };
    }
  } catch {
    /* fall through */
  }
  return { bundle: readBundledRules(), etag: null, online: false };
}

function fetchJsonWithHeaders(url, headers) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const u = new URL(url);
    const opts = { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: "GET", headers, timeout: 8000 };
    const req = lib.request(opts, (res) => {
      if (res.statusCode === 304) {
        resolve({ notModified: true });
        return;
      }
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        try {
          resolve({ json: JSON.parse(body), etag: res.headers.etag });
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    req.end();
  });
}

module.exports = { loadRulesBundle, readBundledRules };
