const http = require("http");
const https = require("https");
const { formatRequestError } = require("./httpEnv");

/**
 * Node.js 組み込み http/https（HTTP_PROXY は既定では使わない = 社内直結向け）。
 */
function requestJson(method, url, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === "https:" ? https : http;
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: u.hostname,
      port: u.port || (u.protocol === "https:" ? 443 : 80),
      path: u.pathname + u.search,
      method,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...extraHeaders,
      },
      timeout: 15000,
    };
    const req = lib.request(opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        let json = null;
        try {
          json = data ? JSON.parse(data) : null;
        } catch {
          /* ignore */
        }
        resolve({ status: res.statusCode || 0, json, raw: data });
      });
    });
    req.on("error", (err) => reject(new Error(formatRequestError(err, url))));
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

async function checkRepoName(serverBaseUrl, name, owner) {
  const base = serverBaseUrl.replace(/\/$/, "");
  const q = new URLSearchParams({ name });
  if (owner) q.set("owner", owner);
  const { status, json } = await requestJson("GET", `${base}/api/v1/repos/check-name?${q}`);
  if (status >= 400) {
    const d = json?.detail;
    const msg = typeof d === "string" ? d : `check-name HTTP ${status}`;
    throw new Error(msg);
  }
  return json;
}

async function provisionRepo(serverBaseUrl, { name, owner, displayName, appId }) {
  const base = serverBaseUrl.replace(/\/$/, "");
  const { status, json } = await requestJson("POST", `${base}/api/v1/repos/provision`, {
    name,
    owner: owner || null,
    display_name: displayName || "",
    app_id: appId,
    private: true,
  });
  if (status === 409) {
    const d = json?.detail;
    return typeof d === "object" && d ? { conflict: true, ...d } : { ok: false, conflict: true };
  }
  if (status >= 400) {
    const d = json?.detail;
    const msg = typeof d === "string" ? d : d?.message || `provision HTTP ${status}`;
    throw new Error(msg);
  }
  return json;
}

async function publishRepo(serverBaseUrl, owner, name, version) {
  const base = serverBaseUrl.replace(/\/$/, "");
  const { getAuthHeaders } = require("./authHeaders");
  const headers = await getAuthHeaders();
  const body = { owner, name };
  if (version) body.version = String(version).replace(/^v/i, "");
  const { status, json } = await requestJson("POST", `${base}/api/v1/repos/publish`, body, headers);
  if (status >= 400) {
    const d = json?.detail;
    const msg = typeof d === "string" ? d : `publish HTTP ${status}`;
    throw new Error(msg);
  }
  return json;
}

async function fetchPublishState(serverBaseUrl, owner, name, localVersion) {
  const base = serverBaseUrl.replace(/\/$/, "");
  const q = new URLSearchParams({ owner, name });
  if (localVersion) q.set("local_version", String(localVersion));
  const { status, json } = await requestJson("GET", `${base}/api/v1/repos/publish-state?${q}`);
  if (status >= 400) {
    const d = json?.detail;
    throw new Error(typeof d === "string" ? d : `publish-state HTTP ${status}`);
  }
  return json;
}

async function createPushSession(serverBaseUrl, deviceLabel, scope = "write") {
  const base = serverBaseUrl.replace(/\/$/, "");
  const { getAuthHeaders } = require("./authHeaders");
  const headers = await getAuthHeaders();
  const { status, json } = await requestJson(
    "POST",
    `${base}/api/v1/noraops/push/sessions`,
    {
      device_label: deviceLabel || "",
      scope: scope === "read" ? "read" : "write",
    },
    headers
  );
  if (status >= 400) {
    const d = json?.detail;
    const msg = typeof d === "string" ? d : d?.message || `push session HTTP ${status}`;
    throw new Error(msg);
  }
  return json;
}

async function exportMyRepos(serverBaseUrl) {
  const base = serverBaseUrl.replace(/\/$/, "");
  const { getAuthHeaders } = require("./authHeaders");
  const headers = await getAuthHeaders();
  const { status, json } = await requestJson("GET", `${base}/api/v1/noraops/me/repos/export`, null, headers);
  if (status >= 400) {
    const d = json?.detail;
    const msg = typeof d === "string" ? d : d?.message || `repos/export HTTP ${status}`;
    throw new Error(msg);
  }
  return json;
}

module.exports = {
  requestJson,
  checkRepoName,
  provisionRepo,
  publishRepo,
  fetchPublishState,
  createPushSession,
  exportMyRepos,
  getAuthHeaders: () => require("./authHeaders").getAuthHeaders(),
};
