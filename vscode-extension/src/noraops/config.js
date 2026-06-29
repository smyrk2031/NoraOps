const vscode = require("vscode");
const { getCachedRuntimeConfig } = require("./runtimeConfig");
const { DEFAULT_DEV_URL, normalizePortalUrl } = require("./serverUrl");

const DEFAULT_GITEA_BASE_URL = "http://127.0.0.1:3000";

function resolveServerBaseUrl(cfg) {
  const raw = (cfg.get("server.baseUrl") || DEFAULT_DEV_URL).trim();
  const norm = normalizePortalUrl(raw);
  return norm.ok ? norm.baseUrl : raw.replace(/\/$/, "");
}

function getNoraOpsConfig() {
  const cfg = vscode.workspace.getConfiguration("noraops");
  const runtime = getCachedRuntimeConfig() || {};
  const baseUrl = resolveServerBaseUrl(cfg);
  const userGiteaUrl = (cfg.get("gitea.baseUrl") || "").replace(/\/$/, "");
  const userGiteaToken = (cfg.get("gitea.token") || "").trim();
  const userDefaultOwner = (cfg.get("gitea.defaultOwner") || "").trim();
  const giteaBaseUrl = userGiteaUrl || runtime.giteaBaseUrl || DEFAULT_GITEA_BASE_URL;
  const giteaToken = userGiteaToken || runtime.giteaPushToken || "";
  const giteaDefaultOwner = userDefaultOwner || runtime.giteaDefaultOwner || "";
  return {
    serverBaseUrl: baseUrl,
    rulesUrl: `${baseUrl}/api/v1/checks/rules`,
    giteaBaseUrl,
    /** @deprecated push uses FastAPI; kept for legacy Runner clone override only */
    giteaToken,
    pushViaServer: runtime.pushViaServer !== false,
    giteaFromServer: !userGiteaUrl,
    giteaTokenConfiguredOnServer: runtime.giteaTokenConfigured === true,
    pushOnSave: cfg.get("save.pushOnSave", true) !== false,
    deviceLabel: cfg.get("device.label") || "",
    giteaDefaultOwner,
    toolsManifestUrl:
      (cfg.get("tools.manifestUrl") || "").trim() || `${baseUrl}/api/tools/windows-x64/manifest.json`,
    toolsAuthToken: (cfg.get("tools.authToken") || "").trim(),
    toolsInstallRoot: (cfg.get("tools.installRoot") || "").trim(),
    toolsNotifyIfMissing: cfg.get("tools.notifyIfMissing", true) !== false,
    mode: (cfg.get("mode") || "auto").toLowerCase(),
    runnerAutoOpen: cfg.get("runner.autoOpen", true) !== false,
    autoOpenPanels: cfg.get("runner.autoOpenPanels", false) !== false,
    clientUpdateCheck: cfg.get("client.checkUpdateOnStartup", true) !== false,
    publishOnSave: cfg.get("save.publishOnSave", true) !== false,
    aiChatUrl: (cfg.get("aiChat.url") || "").trim(),
  };
}

module.exports = { getNoraOpsConfig, resolveServerBaseUrl, DEFAULT_GITEA_BASE_URL, DEFAULT_DEV_URL };
