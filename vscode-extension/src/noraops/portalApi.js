const { requestJson } = require("./noraopsApi");

function apiBase(serverBaseUrl) {
  return serverBaseUrl.replace(/\/$/, "");
}

async function fetchPublishedCatalog(serverBaseUrl, query, options = {}) {
  const base = apiBase(serverBaseUrl);
  const q = new URLSearchParams();
  if (query) q.set("q", query);
  const scope = options.scope || "all";
  if (scope && scope !== "all") q.set("scope", scope);
  const suffix = q.toString() ? `?${q}` : "";
  const { status, json } = await requestJson("GET", `${base}/api/v1/portal/catalog/published${suffix}`);
  if (status >= 400) {
    const d = json?.detail;
    throw new Error(typeof d === "string" ? d : `catalog HTTP ${status}`);
  }
  return json;
}

async function fetchPublishedAppDetail(serverBaseUrl, owner, name) {
  const base = apiBase(serverBaseUrl);
  const { status, json } = await requestJson(
    "GET",
    `${base}/api/v1/portal/catalog/published/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`
  );
  if (status >= 400) {
    const d = json?.detail;
    throw new Error(typeof d === "string" ? d : `detail HTTP ${status}`);
  }
  return json;
}

async function fetchClientLatest(serverBaseUrl) {
  const base = apiBase(serverBaseUrl);
  const { status, json } = await requestJson("GET", `${base}/api/v1/noraops/client/latest`);
  if (status >= 400) {
    const d = json?.detail;
    throw new Error(typeof d === "string" ? d : `client/latest HTTP ${status}`);
  }
  return json;
}

module.exports = { fetchPublishedCatalog, fetchPublishedAppDetail, fetchClientLatest };
