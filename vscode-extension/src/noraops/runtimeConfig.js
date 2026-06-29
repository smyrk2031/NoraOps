const http = require("http");
const https = require("https");

/** @type {null | { giteaBaseUrl?: string, giteaDefaultOwner?: string, giteaPushToken?: string, giteaTokenConfigured?: boolean, pypiIndexUrl?: string, pypiFallbackEnabled?: boolean, packageAllowlistEtag?: string, packageAllowlistCount?: number, online?: boolean }} */
let cached = null;

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const u = new URL(url);
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: "GET",
        timeout: 8000,
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    req.end();
  });
}

async function refreshRuntimeConfig(serverBaseUrl) {
  const base = (serverBaseUrl || "").replace(/\/$/, "");
  if (!base) {
    return cached || { online: false };
  }
  try {
    const json = await fetchJson(`${base}/api/v1/noraops/client/runtime-config`);
    cached = {
      giteaBaseUrl: (json.giteaBaseUrl || "").replace(/\/$/, ""),
      giteaDefaultOwner: (json.giteaDefaultOwner || "").trim(),
      giteaPushToken: json.giteaPushToken || "",
      giteaTokenConfigured: json.giteaTokenConfigured === true,
      pypiIndexUrl: (json.pypiIndexUrl || "").trim(),
      pypiFallbackEnabled: json.pypiFallbackEnabled !== false,
      packageAllowlistEtag: json.packageAllowlistEtag || "",
      packageAllowlistCount: Number(json.packageAllowlistCount) || 0,
      online: true,
    };
    try {
      const { refreshPackageAllowlist } = require("./packageAllowlist");
      await refreshPackageAllowlist(base);
    } catch {
      /* ignore */
    }
    return cached;
  } catch {
    if (cached) {
      cached.online = false;
      return cached;
    }
    return { online: false };
  }
}

function getCachedRuntimeConfig() {
  return cached;
}

module.exports = { refreshRuntimeConfig, getCachedRuntimeConfig };
