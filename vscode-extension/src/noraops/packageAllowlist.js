const path = require("path");
const http = require("http");
const https = require("https");
const vscode = require("vscode");
const { getServerBaseUrl } = require("./config");
const { getCachedRuntimeConfig } = require("./runtimeConfig");
const { requestJson } = require("./noraopsApi");
const { normalizePkgName, parsePyprojectDependencyNames } = require("./pyprojectDeps");
const { readWorkspaceSession } = require("./pathsMeta");

function pyprojectPath(workspaceRoot) {
  return path.join(workspaceRoot, "nora", "packages", "pyproject.toml");
}

/** @type {{ etag: string, packages: Map<string, { versionSpec: string }> } | null} */
let cachedAllowlist = null;

function fetchWithEtag(url, etag) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const u = new URL(url);
    const headers = { Accept: "application/json" };
    if (etag) headers["If-None-Match"] = `"${etag}"`;
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: "GET",
        timeout: 12000,
        headers,
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          resolve({
            status: res.statusCode || 0,
            etag: (res.headers.etag || "").replace(/"/g, ""),
            body,
          });
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

function buildAllowlistMap(data) {
  const map = new Map();
  for (const row of data?.packages || []) {
    const name = normalizePkgName(row.name);
    if (!name) continue;
    map.set(name, { versionSpec: row.versionSpec || row.version_spec || "" });
  }
  return map;
}

async function refreshPackageAllowlist(serverBaseUrl) {
  const base = (serverBaseUrl || getServerBaseUrl() || "").replace(/\/$/, "");
  if (!base) return cachedAllowlist;
  const runtime = getCachedRuntimeConfig() || {};
  const url = `${base}/api/v1/noraops/packages/allowlist`;
  try {
    const res = await fetchWithEtag(url, cachedAllowlist?.etag || runtime.packageAllowlistEtag || "");
    if (res.status === 304 && cachedAllowlist) {
      cachedAllowlist.etag = res.etag || cachedAllowlist.etag;
      return cachedAllowlist;
    }
    if (res.status >= 400) return cachedAllowlist;
    const data = JSON.parse(res.body || "{}");
    cachedAllowlist = {
      etag: res.etag || runtime.packageAllowlistEtag || "",
      packages: buildAllowlistMap(data),
    };
    return cachedAllowlist;
  } catch {
    return cachedAllowlist;
  }
}

function isDeclaredAllowed(name, allowMap) {
  if (!allowMap || !allowMap.size) return true;
  return allowMap.has(normalizePkgName(name));
}

function findUnapprovedDeclared(pyproject, allowMap) {
  const names = parsePyprojectDependencyNames(pyproject);
  if (!allowMap || !allowMap.size) return [];
  return names.filter((n) => !isDeclaredAllowed(n, allowMap));
}

function findUnapprovedInstalled(installedPackages, allowMap) {
  if (!allowMap || !allowMap.size) return [];
  const out = [];
  for (const p of installedPackages || []) {
    const name = normalizePkgName(p.name);
    if (!name) continue;
    if (!isDeclaredAllowed(name, allowMap)) {
      out.push({ name, version: p.version || "" });
    }
  }
  return out;
}

function getPypiIndexEnv() {
  const runtime = getCachedRuntimeConfig() || {};
  const indexUrl = (runtime.pypiIndexUrl || "").trim();
  if (!indexUrl) return {};
  const env = { UV_DEFAULT_INDEX: indexUrl };
  if (runtime.pypiFallbackEnabled !== false) {
    env.UV_EXTRA_INDEX_URL = "https://pypi.org/simple";
  }
  return env;
}

async function warnUnapprovedBeforeEnv(workspaceRoot) {
  const base = getServerBaseUrl();
  if (!base) return { continued: true, unapproved: [] };
  const allow = await refreshPackageAllowlist(base);
  const py = pyprojectPath(workspaceRoot);
  const unapproved = findUnapprovedDeclared(py, allow?.packages);
  if (!unapproved.length) return { continued: true, unapproved: [] };

  const list = unapproved.join(", ");
  const pick = await vscode.window.showWarningMessage(
    `許可リストにない依存があります: ${list}\n\n環境作成は続行できます。運営へ XLSX 追加を依頼してください。`,
    { modal: true },
    "続行",
    "許可リストを開く"
  );
  if (pick === "許可リストを開く") {
    const adminUrl = `${base.replace(/\/$/, "")}/admin/packages`;
    await vscode.env.openExternal(vscode.Uri.parse(adminUrl));
  }
  return { continued: true, unapproved };
}

async function postDepsAudit(workspaceRoot, audit) {
  const base = getServerBaseUrl();
  if (!base) return;
  const session = readWorkspaceSession(workspaceRoot) || {};
  const body = {
    appId: session.appId || "",
    workspace: workspaceRoot,
    declared: audit.declared || [],
    installed: audit.installed || [],
    unapproved: audit.unapproved || [],
    usedFallback: audit.usedFallback === true,
  };
  try {
    const { getAuthHeaders } = require("./authHeaders");
    const headers = await getAuthHeaders();
    await requestJson("POST", `${base.replace(/\/$/, "")}/api/v1/noraops/packages/deps-audit`, body, headers);
  } catch {
    /* ignore */
  }
}

async function auditAfterSync(workspaceRoot, syncResult) {
  const base = getServerBaseUrl();
  if (!base) return;
  const allow = await refreshPackageAllowlist(base);
  const py = pyprojectPath(workspaceRoot);
  const declared = parsePyprojectDependencyNames(py);
  const installed = (syncResult?.installedPackages || []).map((p) => ({
    name: p.name,
    version: p.version || "",
  }));
  const unapprovedInstalled = findUnapprovedInstalled(syncResult?.installedPackages || [], allow?.packages);
  const unapprovedDeclared = findUnapprovedDeclared(py, allow?.packages);
  const unapprovedSet = new Set([
    ...unapprovedDeclared,
    ...unapprovedInstalled.map((u) => u.name),
  ]);
  const unapproved = [...unapprovedSet];
  const runtime = getCachedRuntimeConfig() || {};
  const usedFallback =
    unapproved.length > 0 &&
    Boolean(runtime.pypiIndexUrl) &&
    runtime.pypiFallbackEnabled !== false;

  if (unapproved.length) {
    await postDepsAudit(workspaceRoot, {
      declared,
      installed,
      unapproved,
      usedFallback,
    });
  }
}

module.exports = {
  refreshPackageAllowlist,
  warnUnapprovedBeforeEnv,
  auditAfterSync,
  getPypiIndexEnv,
  findUnapprovedDeclared,
  findUnapprovedInstalled,
};
