const vscode = require("vscode");
const { getSetupOverview } = require("./setupStatus");
const { saveNoraOpsProxy } = require("./proxySettings");
const { normalizePortalUrl } = require("./serverUrl");
const { testServerConnection } = require("./setupConnection");
const { createStaleCache } = require("./panelStateCache");
const { showNoraOpsView } = require("./noraOpsShell");

const SETUP_STATE_KEY = "noraops.setup.serverConfigured";
const LAST_URL_KEY = "noraops.setup.lastPortalUrl";

/** @type {vscode.WebviewPanel | undefined} */
let setupPanel;
const setupStateCache = createStaleCache(15000);

function _setPanelRef(panel) {
  setupPanel = panel;
}

function _clearPanelRef() {
  setupPanel = undefined;
  setupStateCache.clear();
}

async function postSetupState(context, extra = {}, options = {}) {
  const webview = options.webview || setupPanel?.webview;
  if (!webview) return;
  const force = options.force === true;
  if (!force && !Object.keys(extra).length) {
    const cached = setupStateCache.get();
    if (cached) {
      webview.postMessage({ type: "state", ...cached, ...extra });
      return;
    }
  }
  try {
    const state = await getSetupOverview(context);
    if (!Object.keys(extra).length) {
      setupStateCache.set(state);
    }
    webview.postMessage({
      type: "state",
      ...state,
      ...extra,
    });
  } catch (e) {
    webview.postMessage({
      type: "state",
      rows: [],
      features: [],
      error: e.message || String(e),
      ...extra,
    });
  }
}

async function handleSetupMessage(context, msg, webview) {
  if (msg.type === "setupReady" || msg.type === "refresh") {
    await postSetupState(context, {}, { force: true, webview });
    return;
  }
  if (msg.type === "openRow") {
    if (msg.rowId === "portal") {
      webview.postMessage({ type: "openModal", modalId: "modalPortal" });
    } else if (msg.rowId === "uv") {
      webview.postMessage({ type: "openModal", modalId: "modalUv" });
    } else if (msg.rowId === "online") {
      webview.postMessage({ type: "openModal", modalId: "modalOnline" });
    } else if (msg.rowId === "features") {
      webview.postMessage({ type: "openModal", modalId: "modalFeatures" });
    } else if (msg.rowId === "security") {
      webview.postMessage({ type: "openModal", modalId: "modalSecurity" });
    } else if (msg.rowId === "account") {
      webview.postMessage({ type: "openModal", modalId: "modalAccount" });
    }
  }
  if (msg.type === "openPortal") {
    const url = msg.url || "";
    if (url) await vscode.env.openExternal(vscode.Uri.parse(url));
  }
  if (msg.type === "testConnection" && msg.portalUrl) {
    try {
      const result = await testServerConnection(msg.portalUrl);
      await context.globalState.update("noraops.setup.lastTest", {
        at: new Date().toISOString(),
        ...result,
      });
      webview.postMessage({ type: "testResult", result });
    } catch (e) {
      webview.postMessage({
        type: "testResult",
        result: { ok: false, error: e.message, checks: [] },
      });
    }
  }
  if (msg.type === "saveAndApply" && msg.portalUrl) {
    const norm = normalizePortalUrl(msg.portalUrl);
    if (!norm.ok) {
      vscode.window.showErrorMessage(norm.error);
      return;
    }
    const cfg = vscode.workspace.getConfiguration("noraops");
    await cfg.update("server.baseUrl", norm.baseUrl, vscode.ConfigurationTarget.Global);
    const { refreshRuntimeConfig } = require("./runtimeConfig");
    await refreshRuntimeConfig(norm.baseUrl);
    const { refreshRules } = require("./savePipeline");
    await refreshRules().catch(() => {});
    await context.globalState.update(SETUP_STATE_KEY, true);
    await context.globalState.update(LAST_URL_KEY, norm.baseUrl);
    vscode.window.showInformationMessage(`接続先を保存しました: ${norm.baseUrl}`);
    const { refreshHomePanel } = require("./homePanel");
    const { refreshRunnerPanel } = require("./runner/runnerPanel");
    refreshHomePanel();
    refreshRunnerPanel();
    setupStateCache.clear();
    await postSetupState(context, {}, { force: true, webview });
  }
  if (msg.type === "saveProxy") {
    await saveNoraOpsProxy(msg.httpUrl, msg.httpsUrl);
    webview.postMessage({ type: "proxySaved" });
    setupStateCache.clear();
    await postSetupState(context, {}, { force: true, webview });
  }
  if (msg.type === "setupTools") {
    try {
      await vscode.commands.executeCommand("noraops.setupTools");
      webview.postMessage({
        type: "uvSetupDone",
        ok: true,
        message: "uv セットアップが完了しました",
      });
    } catch (e) {
      webview.postMessage({
        type: "uvSetupDone",
        ok: false,
        message: e.message || "セットアップに失敗しました",
      });
    }
    setupStateCache.clear();
    await postSetupState(context, {}, { force: true, webview });
  }
  if (msg.type === "refreshSecurity") {
    setupStateCache.clear();
    await postSetupState(context, {}, { force: true, webview });
  }
  if (msg.type === "saveAiChatUrl") {
    try {
      const { saveAiChatUrl } = require("./aiChatTool");
      const url = await saveAiChatUrl(msg.url || "");
      vscode.window.showInformationMessage(`AI チャット URL を保存しました: ${url}`);
      setupStateCache.clear();
      await postSetupState(context, {}, { force: true, webview });
      webview.postMessage({ type: "aiChatUrlSaved", url });
    } catch (e) {
      vscode.window.showErrorMessage(e.message);
      webview.postMessage({ type: "aiChatUrlSaved", ok: false, message: e.message });
    }
  }
  if (msg.type === "openAiChatTool") {
    const { openAiChatToolBeside, saveAiChatUrl, getAiChatUrl } = require("./aiChatTool");
    const draft = String(msg.url || "").trim();
    if (draft && draft !== getAiChatUrl()) {
      try {
        await saveAiChatUrl(draft);
        setupStateCache.clear();
        await postSetupState(context, {}, { force: true, webview });
      } catch (e) {
        vscode.window.showErrorMessage(e.message);
        return;
      }
    }
    const r = await openAiChatToolBeside({ context, revealSetup: msg.fromSetup !== true });
    if (r.ok && webview) {
      webview.postMessage({ type: "aiChatToolOpened" });
    }
  }
  if (msg.type === "focusAiChatSetting") {
    webview.postMessage({ type: "focusAiChatSetting" });
  }
  if (msg.type === "testSecurityRule" && msg.ruleId != null) {
    try {
      const { refreshRules, getActiveRulesBundle } = require("./savePipeline");
      const { testSecurityRuleText } = require("./checkRunner");
      await refreshRules();
      const bundle = getActiveRulesBundle();
      const result = testSecurityRuleText(msg.sample || "", msg.ruleId, bundle?.security);
      webview.postMessage({ type: "securityTestResult", ruleId: msg.ruleId, result });
    } catch (e) {
      webview.postMessage({
        type: "securityTestResult",
        ruleId: msg.ruleId,
        result: { ok: false, error: e.message, findings: [] },
      });
    }
  }
  if (msg.type === "addUserIpWhitelist" && msg.ip) {
    const { addUserIp } = require("./ipUserWhitelist");
    const result = await addUserIp(msg.ip);
    if (!result.ok) {
      vscode.window.showErrorMessage(result.error || "IP の登録に失敗しました");
    } else if (!result.duplicate) {
      vscode.window.showInformationMessage(`救済ホワイトリストに追加しました: ${msg.ip.trim()}`);
    }
    await refreshSecurityAfterWhitelistChange(context, webview);
  }
  if (msg.type === "removeUserIpWhitelist" && msg.ip) {
    const { removeUserIp } = require("./ipUserWhitelist");
    await removeUserIp(msg.ip);
    vscode.window.showInformationMessage(`救済ホワイトリストから削除しました: ${msg.ip}`);
    await refreshSecurityAfterWhitelistChange(context, webview);
  }
  if (msg.type === "registerAccountEmail" && msg.email) {
    try {
      const cfg = vscode.workspace.getConfiguration("noraops");
      const base = (cfg.get("server.baseUrl") || "").trim();
      const { registerUserEmail } = require("./accountRegistration");
      await registerUserEmail(base, msg.email);
      await context.globalState.update("noraops.account.pendingEmail", String(msg.email).trim());
      vscode.window.showInformationMessage(
        "登録メールを送信しました。メール内の URL を開き、表示された NoraAccessToken を下の欄に貼り付けてください。"
      );
      setupStateCache.clear();
      await postSetupState(context, {}, { force: true, webview });
    } catch (e) {
      vscode.window.showErrorMessage(e.message || "メール登録に失敗しました");
      webview.postMessage({ type: "accountRegisterResult", ok: false, message: e.message });
    }
  }
  if (msg.type === "reissueAccessToken" && msg.email) {
    try {
      const cfg = vscode.workspace.getConfiguration("noraops");
      const base = (cfg.get("server.baseUrl") || "").trim();
      const { reissueAccessToken } = require("./accountRegistration");
      await reissueAccessToken(base, msg.email);
      vscode.window.showInformationMessage("再発行メールを送信しました。URL を開いて新しいトークンを貼り付けてください。");
    } catch (e) {
      vscode.window.showErrorMessage(e.message || "トークン再発行に失敗しました");
    }
  }
  if (msg.type === "saveAccessToken" && msg.token != null) {
    try {
      const { setAccessToken } = require("./accessTokenAuth");
      await setAccessToken(String(msg.token || "").trim());
      vscode.window.showInformationMessage("NoraAccessToken を保存しました。");
      setupStateCache.clear();
      await postSetupState(context, {}, { force: true, webview });
    } catch (e) {
      vscode.window.showErrorMessage(e.message || "トークンの保存に失敗しました");
    }
  }
  if (msg.type === "refreshAccountStatus") {
    setupStateCache.clear();
    await postSetupState(context, {}, { force: true, webview });
  }
}

async function refreshSecurityAfterWhitelistChange(context, webview) {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (folder) {
    const { runWorkspaceChecks } = require("./savePipeline");
    await runWorkspaceChecks(folder.uri.fsPath).catch(() => {});
    const { refreshHomePanel } = require("./homePanel");
    refreshHomePanel();
  }
  setupStateCache.clear();
  await postSetupState(context, {}, { force: true, webview });
  if (webview) {
    webview.postMessage({ type: "userIpWhitelistUpdated" });
  }
}

async function bootstrapSetupView(context, webview, options = {}) {
  await postSetupState(context, {}, { force: !options.soft, webview });
}

async function createSetupPanel(context, options = {}) {
  return showNoraOpsView(context, "setup", options);
}

async function openSecurityGuardModal(context) {
  await showNoraOpsView(context, "setup");
  if (setupPanel) {
    setupPanel.webview.postMessage({ type: "openModal", modalId: "modalSecurity" });
  }
}

function refreshSetupPanel(context) {
  setupStateCache.clear();
  if (setupPanel && context) postSetupState(context, {}, { force: true, webview: setupPanel.webview });
}

function needsFirstTimeSetup(context) {
  const cfg = vscode.workspace.getConfiguration("noraops");
  const url = (cfg.get("server.baseUrl") || "").trim();
  const configured = context.globalState.get(SETUP_STATE_KEY) === true;
  const { isDefaultDevUrl } = require("./serverUrl");
  return !configured && (!url || isDefaultDevUrl(url));
}

module.exports = {
  createSetupPanel,
  openSecurityGuardModal,
  refreshSetupPanel,
  needsFirstTimeSetup,
  SETUP_STATE_KEY,
  handleSetupMessage,
  bootstrapSetupView,
  _setPanelRef,
  _clearPanelRef,
};
