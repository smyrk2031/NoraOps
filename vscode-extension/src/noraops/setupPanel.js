const vscode = require("vscode");
const { getSetupOverview } = require("./setupStatus");
const { saveNoraOpsProxy } = require("./proxySettings");
const { normalizePortalUrl } = require("./serverUrl");
const { testServerConnection } = require("./setupConnection");
const { createStaleCache } = require("./panelStateCache");
const { showNoraOpsView } = require("./noraOpsShell");

const SETUP_STATE_KEY = "noraops.setup.serverConfigured";
const LAST_URL_KEY = "noraops.setup.lastPortalUrl";
const SETUP_OVERVIEW_TIMEOUT_MS = 22000;
const REPO_ACCESS_TIMEOUT_MS = 8000;

/** @type {vscode.WebviewPanel | undefined} */
let setupPanel;
const setupStateCache = createStaleCache(15000);

function getExtensionVersion(context) {
  const fromCtx = context?.extension?.packageJSON?.version;
  if (fromCtx) return String(fromCtx);
  try {
    const pkg = require("../../package.json");
    if (pkg?.version) return String(pkg.version);
  } catch {
    /* ignore */
  }
  const ext = vscode.extensions.getExtension("softrail.noraops4code");
  return ext?.packageJSON?.version ? String(ext.packageJSON.version) : "?";
}

function withTimeout(promise, ms, label) {
  const sec = Math.round(ms / 1000);
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`${label || "確認"}がタイムアウトしました（${sec}秒）。サーバーが起動しているか、URL が正しいか確認してください。`));
      }, ms);
    }),
  ]);
}

function buildSetupErrorHint(message) {
  const msg = String(message || "");
  if (/timeout|タイムアウト/i.test(msg)) {
    return [
      "バックエンド（FastAPI）が起動しているか確認してください。",
      "Setting の「ポータル URL」をタップし、接続テストを実行してください。",
      "閉域ネットのみの場合、インターネット不可でもポータルに届けば問題ありません。",
      "セキュリティガードと uv はサーバー未接続でも一部利用できます。",
    ].join(" ");
  }
  if (/ECONNREFUSED|接続できません|fetch failed|ENOTFOUND/i.test(msg)) {
    return "URL の typo、ファイアウォール、IIS サブパス（/NoraOps）の不一致を疑ってください。ブラウザで同じ URL + /api/v1/portal/health を開いてみてください。";
  }
  return "「状態を再チェック」を押すか、ポータル URL 行をタップして接続テストを実行してください。";
}

function buildFallbackRows(context, errorMessage) {
  const cfg = require("./config").getNoraOpsConfig();
  const portalUrl = (cfg.serverBaseUrl || "").trim() || "未設定";
  return [
    {
      id: "online",
      ok: false,
      title: "ネットワーク",
      detail: "確認を完了できませんでした（下の案内を参照）",
    },
    {
      id: "portal",
      ok: false,
      title: "ポータル URL",
      detail: `${portalUrl} — ${errorMessage || "未到達"}`,
      portalUrl,
    },
    {
      id: "account",
      ok: false,
      title: "アカウント",
      detail: "ポータル接続後に再確認してください",
      accountInfo: null,
    },
    {
      id: "uv",
      ok: false,
      title: "環境構築（uv）",
      detail: "未確認（オフラインでもセットアップは試せます）",
      uvInfo: { installed: false, error: errorMessage || "" },
    },
    {
      id: "security",
      ok: true,
      title: "セキュリティガード",
      detail: "同梱ルールでオフライン動作可能",
      securityInfo: null,
    },
  ];
}

async function loadRepoAccessForSetup() {
  try {
    const { listAccessibleRepos } = require("./repoAccess");
    const data = await listAccessibleRepos();
    return { ok: true, repos: data.repos || [], giteaLogin: data.giteaLogin || "" };
  } catch (e) {
    return { ok: false, error: e.message || String(e), repos: [] };
  }
}

async function postRepoMembers(webview, owner, name) {
  try {
    const { listRepoMembers } = require("./repoAccess");
    const data = await listRepoMembers(owner, name);
    webview.postMessage({
      type: "repoMembersState",
      owner,
      name,
      ok: true,
      ...data,
    });
  } catch (e) {
    webview.postMessage({
      type: "repoMembersState",
      owner,
      name,
      ok: false,
      error: e.message || String(e),
    });
  }
}

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
  const extensionVersion = getExtensionVersion(context);

  if (!force && !Object.keys(extra).length) {
    const cached = setupStateCache.get();
    if (cached) {
      webview.postMessage({ type: "state", extensionVersion, ...cached, ...extra });
      return;
    }
  }

  webview.postMessage({
    type: "state",
    loading: true,
    extensionVersion,
    loadingDetail: "ネットワーク・ポータル・アカウントを確認しています…",
    ...extra,
  });

  try {
    const overviewPromise = withTimeout(
      getSetupOverview(context),
      SETUP_OVERVIEW_TIMEOUT_MS,
      "接続状態の確認"
    );
    const repoAccessPromise = withTimeout(
      loadRepoAccessForSetup(),
      REPO_ACCESS_TIMEOUT_MS,
      "リポジトリ一覧"
    ).catch((e) => ({ ok: false, error: e.message || String(e), repos: [] }));

    const [state, repoAccess] = await Promise.all([overviewPromise, repoAccessPromise]);
    const { describeBackupStorage } = require("./saveHistory");
    const cfg = require("./config").getNoraOpsConfig();
    const portal = (cfg.serverBaseUrl || "").replace(/\/$/, "");
    const payload = {
      ...state,
      extensionVersion,
      loading: false,
      repoAccess,
      backupInfo: {
        ...describeBackupStorage(),
        adminBackupUrl: portal ? `${portal}/admin/backup` : "",
      },
    };
    if (!Object.keys(extra).length) {
      setupStateCache.set(payload);
    }
    webview.postMessage({
      type: "state",
      ...payload,
      ...extra,
    });
  } catch (e) {
    const message = e.message || String(e);
    const fallbackRows = buildFallbackRows(context, message);
    webview.postMessage({
      type: "state",
      loading: false,
      extensionVersion,
      rows: fallbackRows,
      features: require("./setupStatus").buildFeatures(fallbackRows),
      allReady: false,
      error: message,
      errorHint: buildSetupErrorHint(message),
      repoAccess: { ok: false, error: message, repos: [] },
      backupInfo: require("./saveHistory").describeBackupStorage(),
      portalUrl: require("./config").getNoraOpsConfig().serverBaseUrl,
      ...extra,
    });
  }
}

async function handleSetupMessage(context, msg, webview) {
  if (msg.type === "setupReady" || msg.type === "refresh") {
    await postSetupState(context, {}, { force: msg.force === true || msg.type === "setupReady", webview });
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
  if (msg.type === "openBackupFolder") {
    const { describeBackupStorage } = require("./saveHistory");
    const info = describeBackupStorage();
    const root = info.localRoot;
    if (!root) {
      vscode.window.showWarningMessage("バックアップ保存先が未設定です。");
      return;
    }
    const uri = vscode.Uri.file(root);
    await vscode.env.openExternal(uri);
    return;
  }
  if (msg.type === "openAdminBackup") {
    const cfg = require("./config").getNoraOpsConfig();
    const portal = (cfg.serverBaseUrl || "").trim().replace(/\/$/, "");
    if (!portal) {
      vscode.window.showWarningMessage("ポータル URL が未設定です。");
      return;
    }
    await vscode.env.openExternal(vscode.Uri.parse(`${portal}/admin/backup`));
    return;
  }
  if (msg.type === "refreshRepoAccess") {
    const repoAccess = await withTimeout(
      loadRepoAccessForSetup(),
      REPO_ACCESS_TIMEOUT_MS,
      "リポジトリ一覧"
    ).catch((e) => ({ ok: false, error: e.message || String(e), repos: [] }));
    webview.postMessage({ type: "repoAccessState", ...repoAccess });
    return;
  }
  if (msg.type === "loadRepoMembers" && msg.owner && msg.name) {
    await postRepoMembers(webview, msg.owner, msg.name);
    return;
  }
  if (msg.type === "addRepoMember" && msg.owner && msg.name && msg.email) {
    try {
      const { inviteRepoMember } = require("./repoAccess");
      await inviteRepoMember(msg.owner, msg.name, msg.email);
      await postRepoMembers(webview, msg.owner, msg.name);
      webview.postMessage({
        type: "repoMembersState",
        owner: msg.owner,
        name: msg.name,
        ok: true,
        message: `${msg.email} を追加しました`,
      });
    } catch (e) {
      webview.postMessage({
        type: "repoMembersState",
        owner: msg.owner,
        name: msg.name,
        ok: false,
        message: e.message || "メンバー追加に失敗しました",
      });
    }
    return;
  }
  if (msg.type === "removeRepoMember" && msg.owner && msg.name && msg.username) {
    try {
      const { revokeRepoMember } = require("./repoAccess");
      await revokeRepoMember(msg.owner, msg.name, msg.username);
      await postRepoMembers(webview, msg.owner, msg.name);
      webview.postMessage({
        type: "repoMembersState",
        owner: msg.owner,
        name: msg.name,
        ok: true,
        message: `${msg.username} を削除しました`,
      });
    } catch (e) {
      webview.postMessage({
        type: "repoMembersState",
        owner: msg.owner,
        name: msg.name,
        ok: false,
        message: e.message || "メンバー削除に失敗しました",
      });
    }
    return;
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
    const email = String(msg.email).trim();
    webview.postMessage({ type: "accountActionBusy", action: "register", busy: true });
    try {
      const cfg = vscode.workspace.getConfiguration("noraops");
      const base = (cfg.get("server.baseUrl") || "").trim();
      const { registerUserEmail } = require("./accountRegistration");
      const result = await registerUserEmail(base, email);
      await context.globalState.update("noraops.account.pendingEmail", email);
      await context.globalState.update("noraops.account.lastRegisterAt", new Date().toISOString());
      const hint =
        result?.hint ||
        "登録メールを送信しました。メール内の URL を開き、表示された NoraAccessToken を貼り付けてください。";
      webview.postMessage({
        type: "accountActionResult",
        action: "register",
        ok: true,
        message: hint,
        email,
      });
      setupStateCache.clear();
      await postSetupState(context, {}, { force: true, webview });
    } catch (e) {
      const message = e.message || "メール登録に失敗しました";
      const recovered = /Gitea 登録が完了しました/.test(message);
      if (recovered) {
        setupStateCache.clear();
        await postSetupState(context, {}, { force: true, webview });
      }
      webview.postMessage({
        type: "accountActionResult",
        action: "register",
        ok: recovered,
        message,
      });
    } finally {
      webview.postMessage({ type: "accountActionBusy", action: "register", busy: false });
    }
  }
  if (msg.type === "reissueAccessToken" && msg.email) {
    const email = String(msg.email).trim();
    webview.postMessage({ type: "accountActionBusy", action: "reissue", busy: true });
    try {
      const cfg = vscode.workspace.getConfiguration("noraops");
      const base = (cfg.get("server.baseUrl") || "").trim();
      const { reissueAccessToken } = require("./accountRegistration");
      const result = await reissueAccessToken(base, email);
      await context.globalState.update("noraops.account.pendingEmail", email);
      webview.postMessage({
        type: "accountActionResult",
        action: "reissue",
        ok: true,
        message:
          result?.hint ||
          "再発行メールを送信しました。URL を開いて新しいトークンを貼り付けてください。",
        email,
      });
      setupStateCache.clear();
      await postSetupState(context, {}, { force: true, webview });
    } catch (e) {
      webview.postMessage({
        type: "accountActionResult",
        action: "reissue",
        ok: false,
        message: e.message || "トークン再発行に失敗しました",
      });
    } finally {
      webview.postMessage({ type: "accountActionBusy", action: "reissue", busy: false });
    }
  }
  if (msg.type === "retryGiteaProvision" && msg.email) {
    const email = String(msg.email).trim();
    webview.postMessage({ type: "accountActionBusy", action: "retryGitea", busy: true });
    try {
      const cfg = vscode.workspace.getConfiguration("noraops");
      const base = (cfg.get("server.baseUrl") || "").trim();
      const { retryGiteaProvision } = require("./accountRegistration");
      const result = await retryGiteaProvision(base, email);
      webview.postMessage({
        type: "accountActionResult",
        action: "retryGitea",
        ok: true,
        message:
          result?.hint ||
          (result?.status === "already_provisioned"
            ? "Gitea 登録は完了済みです。トークン再発行を利用してください。"
            : "Gitea 登録が完了しました。トークン再発行で NoraAccessToken を取得してください。"),
        email,
      });
      setupStateCache.clear();
      await postSetupState(context, {}, { force: true, webview });
    } catch (e) {
      webview.postMessage({
        type: "accountActionResult",
        action: "retryGitea",
        ok: false,
        message: e.message || "Gitea 登録の再試行に失敗しました",
      });
    } finally {
      webview.postMessage({ type: "accountActionBusy", action: "retryGitea", busy: false });
    }
  }
  if (msg.type === "saveAccessToken" && msg.token != null) {
    webview.postMessage({ type: "accountActionBusy", action: "saveToken", busy: true });
    try {
      const token = String(msg.token || "").trim();
      const { setAccessToken } = require("./accessTokenAuth");
      const { validateAccessTokenWithServer } = require("./accountRegistration");
      await setAccessToken(token);
      const cfg = vscode.workspace.getConfiguration("noraops");
      const base = (cfg.get("server.baseUrl") || "").trim();
      let validMsg = "NoraAccessToken を保存しました。";
      if (base && token) {
        const check = await validateAccessTokenWithServer(base);
        if (check.ok) {
          validMsg = "NoraAccessToken を保存しました（サーバーで有効を確認）。";
        } else if (check.reason === "invalid") {
          validMsg =
            "トークンを保存しましたが、サーバーで無効と判定されました。メールから再発行してください。";
        }
      }
      webview.postMessage({
        type: "accountActionResult",
        action: "saveToken",
        ok: true,
        message: validMsg,
      });
      setupStateCache.clear();
      await postSetupState(context, {}, { force: true, webview });
    } catch (e) {
      webview.postMessage({
        type: "accountActionResult",
        action: "saveToken",
        ok: false,
        message: e.message || "トークンの保存に失敗しました",
      });
    } finally {
      webview.postMessage({ type: "accountActionBusy", action: "saveToken", busy: false });
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
