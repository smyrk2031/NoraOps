const os = require("os");
const fs = require("fs");
const vscode = require("vscode");
const https = require("https");
const { getNoraOpsConfig } = require("./config");
const { DEFAULT_DEV_URL, isDefaultDevUrl, normalizePortalUrl, apiUrl } = require("./serverUrl");
const { requestJson } = require("./noraopsApi");
const { getNoraOpsProxySettings } = require("./proxySettings");
const { getNoraOpsRuntimePaths } = require("./toolsPaths");

const SETUP_STATE_KEY = "noraops.setup.serverConfigured";

function hasLanInterface() {
  const ifaces = os.networkInterfaces();
  for (const list of Object.values(ifaces || {})) {
    for (const iface of list || []) {
      if (iface.internal) continue;
      const fam = iface.family;
      if (fam !== "IPv4" && fam !== 4) continue;
      const addr = String(iface.address || "");
      if (!addr || addr.startsWith("169.254.")) continue;
      return true;
    }
  }
  return false;
}

function checkInternetOnline(timeoutMs = 4000) {
  return new Promise((resolve) => {
    const req = https.get(
      "https://www.msftconnecttest.com/connecttest.txt",
      { timeout: timeoutMs },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      }
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

function collectNetworkEvidence() {
  const hostname = os.hostname();
  const interfaces = [];
  for (const [name, list] of Object.entries(os.networkInterfaces() || {})) {
    for (const iface of list || []) {
      if (iface.internal) continue;
      const fam = iface.family;
      if (fam !== "IPv4" && fam !== 4) continue;
      const address = String(iface.address || "").trim();
      if (!address || address.startsWith("169.254.")) continue;
      interfaces.push({
        name,
        address,
        mac: String(iface.mac || "").toUpperCase(),
      });
    }
  }
  return {
    hostname,
    primaryIp: interfaces[0]?.address || "",
    interfaces,
    checkedAt: new Date().toISOString(),
  };
}

async function getNetworkRow(context) {
  const evidence = collectNetworkEvidence();
  const lan = evidence.interfaces.length > 0 || hasLanInterface();
  let portalReach = false;
  try {
    const pr = await getPortalRow(context);
    portalReach = pr.ok;
  } catch {
    portalReach = false;
  }
  const internet = await checkInternetOnline();
  const ok = lan || portalReach;
  let detail = lan ? "閉域ネットワーク接続を確認" : "ネットワーク未接続";
  if (evidence.primaryIp) detail += ` · ${evidence.primaryIp}`;
  if (portalReach) detail += " · ポータル OK";
  else if (lan) detail += " · ポータル未接続";
  return {
    id: "online",
    ok,
    title: "ネットワーク",
    detail,
    networkInfo: {
      lan,
      portalReach,
      internet,
      ...evidence,
    },
  };
}

async function getPortalRow(context) {
  const cfg = vscode.workspace.getConfiguration("noraops");
  const portalUrl = (cfg.get("server.baseUrl") || DEFAULT_DEV_URL).trim();
  const configured = context.globalState.get(SETUP_STATE_KEY) === true;
  const lastTest = context.globalState.get("noraops.setup.lastTest") || null;

  if (!portalUrl || (isDefaultDevUrl(portalUrl) && !configured)) {
    return {
      id: "portal",
      ok: false,
      title: "ポータル URL",
      detail: "未設定",
      portalUrl,
    };
  }

  if (lastTest?.ok) {
    return {
      id: "portal",
      ok: true,
      title: "ポータル URL",
      detail: portalUrl,
      portalUrl,
    };
  }

  try {
    const norm = normalizePortalUrl(portalUrl);
    if (!norm.ok) {
      return { id: "portal", ok: false, title: "ポータル URL", detail: norm.error, portalUrl };
    }
    const health = await requestJson("GET", apiUrl(norm.baseUrl, "/api/v1/portal/health"));
    const ok = health.status === 200 && health.json?.status === "ok";
    return {
      id: "portal",
      ok,
      title: "ポータル URL",
      detail: ok ? portalUrl : `接続できません（HTTP ${health.status}）`,
      portalUrl,
    };
  } catch (e) {
    return {
      id: "portal",
      ok: false,
      title: "ポータル URL",
      detail: e.message || "接続できません",
      portalUrl,
    };
  }
}

async function getUvRow() {
  const paths = getNoraOpsRuntimePaths(getNoraOpsConfig().toolsInstallRoot);
  const { probeUvExe } = require("./toolInstaller");
  const probe = await probeUvExe(paths.uvExe);
  let manifestNote = "";
  let updateNeeded = false;
  try {
    const { fetchToolsStatus } = require("./toolInstaller");
    const st = await fetchToolsStatus();
    if (st.uv?.updateNeeded) {
      updateNeeded = true;
      manifestNote = `サーバー指定版 ${st.uv.required || "—"} · 更新推奨`;
    } else if (st.online) {
      manifestNote = "ツール一覧: 取得OK";
    }
  } catch (e) {
    manifestNote = `ツール一覧: 未取得（${e.message || "オフライン"}）`;
  }

  const ok = probe.installed;
  let detail = ok ? probe.version || "uv 実行OK" : "uv が未セットアップです";
  if (ok && updateNeeded) detail += " · 更新あり";

  return {
    id: "uv",
    ok,
    title: "環境構築（uv）",
    detail,
    uvInfo: {
      path: probe.path,
      version: probe.version,
      installed: probe.installed,
      error: probe.error || "",
      manifestNote,
      updateNeeded,
      toolsRoot: paths.toolsRoot,
    },
  };
}

function buildFeatures(rows) {
  const online = rows.find((r) => r.id === "online")?.ok === true;
  const portal = rows.find((r) => r.id === "portal")?.ok === true;
  const uv = rows.find((r) => r.id === "uv")?.ok === true;
  const ready = online && portal && uv;

  return [
    {
      id: "f5_guard",
      name: "実行ガードレール（F5 / ▽ RUN）",
      ok: ready,
      desc: "デバッグ・ターミナル実行前にセキュリティを確認します。",
    },
    {
      id: "dev_support",
      name: "開発支援（Creator）",
      ok: portal,
      desc: "アプリの作成・保存・公開の流れが使えます。",
    },
    {
      id: "python_env",
      name: "Python 環境の構築支援",
      ok: portal && uv,
      desc: "uv で仮想環境を作り、パッケージを同期します。",
    },
    {
      id: "cloud_save",
      name: "バックアップサーバへのソース保存",
      ok: portal,
      desc: "クラウド（Gitea）へ zip 保存。PC 故障時の本番復旧先。",
    },
    {
      id: "publish",
      name: "みんなに公開",
      ok: portal,
      desc: "公開 topic を付けて Runner カタログに載せられます。",
    },
    {
      id: "runner",
      name: "公開アプリの利用（Runner）",
      ok: portal,
      desc: "公開アプリを検索して起動できます。",
    },
    {
      id: "security_check",
      name: "セキュリティガード（保存・実行）",
      ok: true,
      desc: "IP・秘密情報・個人情報の検出。サーバー未接続時も同梱ルールで動作します。",
    },
  ];
}

async function getAccountRow(context) {
  const cfg = getNoraOpsConfig();
  const portalOk = (cfg.serverBaseUrl || "").trim().length > 0;
  if (!portalOk) {
    return {
      id: "account",
      ok: false,
      title: "アカウント",
      detail: "ポータル未接続",
      accountInfo: null,
    };
  }
  const {
    fetchRegistrationStatus,
    registrationStatusLabel,
    hasAccessToken,
    validateAccessTokenWithServer,
  } = require("./accountRegistration");
  const { maskedAccessTokenHint } = require("./accessTokenAuth");

  const clientPendingEmail =
    (context?.globalState?.get("noraops.account.pendingEmail") || "").trim() || null;
  const lastRegisterAt = context?.globalState?.get("noraops.account.lastRegisterAt") || null;

  let reg = null;
  try {
    reg = await fetchRegistrationStatus(cfg.serverBaseUrl);
  } catch (e) {
    return {
      id: "account",
      ok: false,
      title: "アカウント",
      detail: `状態取得失敗: ${e.message || e}`,
      accountInfo: null,
    };
  }
  if (!reg?.ok) {
    return {
      id: "account",
      ok: false,
      title: "アカウント",
      detail: reg?.error || "状態不明",
      accountInfo: reg,
    };
  }

  const pendingEmail = reg.pendingEmail || clientPendingEmail;
  const effectiveStatus =
    reg.registrationStatus === "pending_email" && pendingEmail && !reg.provisioned
      ? "pending_activation"
      : reg.registrationStatus;

  const label = registrationStatusLabel(
    effectiveStatus,
    reg.requiresEmailActivation,
    reg.requiresAccessToken
  );
  const tokenConfigured = hasAccessToken();
  let tokenValid = null;
  let tokenValidLabel = "";
  if (reg.requiresAccessToken && tokenConfigured) {
    const check = await validateAccessTokenWithServer(cfg.serverBaseUrl);
    tokenValid = check.ok;
    if (check.ok) {
      tokenValidLabel = check.provisioned ? "有効" : "要確認";
    } else if (check.reason === "invalid") {
      tokenValidLabel = "無効";
    } else {
      tokenValidLabel = "確認できません";
    }
  }

  let detail = label.detail;
  if (reg.requiresAccessToken) {
    if (!tokenConfigured) {
      detail += " · トークン未設定";
    } else if (tokenValid === true) {
      detail += " · トークン有効";
    } else if (tokenValid === false) {
      detail += " · トークン無効";
    } else {
      detail += " · トークン設定済み";
    }
  }
  if (reg.giteaLogin && reg.provisioned) {
    detail += ` · ${reg.giteaLogin}`;
  } else if (reg.giteaLogin && reg.provisionIncomplete) {
    detail += ` · Gitea: ${reg.giteaLogin}（未完了）`;
  }

  const accountOk =
    label.ok && (!reg.requiresAccessToken || (tokenConfigured && tokenValid !== false));

  return {
    id: "account",
    ok: accountOk,
    title: label.title,
    detail,
    accountInfo: {
      ...reg,
      registrationStatus: effectiveStatus,
      pendingEmail,
      clientPendingEmail,
      lastRegisterAt,
      lamp: label.lamp,
      hasAccessToken: tokenConfigured,
      localAccessTokenConfigured: tokenConfigured,
      accessTokenValid: tokenValid,
      accessTokenValidLabel: tokenValidLabel,
      maskedAccessToken: maskedAccessTokenHint(),
    },
  };
}

async function getSetupOverview(context) {
  const onlineRow = await getNetworkRow(context);
  const portalRow = await getPortalRow(context);
  const uvRow = await getUvRow();
  const { getSecurityGuardRow } = require("./securityGuardStatus");
  const securityRow = await getSecurityGuardRow();
  const accountRow = await getAccountRow(context);
  const rows = [onlineRow, portalRow, accountRow, uvRow, securityRow];
  const proxy = getNoraOpsProxySettings();
  const cfg = getNoraOpsConfig();
  return {
    rows,
    features: buildFeatures(rows),
    allReady: rows.every((r) => r.ok),
    portalUrl: portalRow.portalUrl || cfg.serverBaseUrl,
    proxy,
    uvInfo: uvRow.uvInfo,
    networkInfo: onlineRow.networkInfo,
    securityInfo: securityRow.securityInfo,
    accountInfo: accountRow.accountInfo,
    extensionVersion: vscode.extensions.getExtension("softrail.noraops4code")?.packageJSON?.version || "?",
  };
}

module.exports = {
  checkInternetOnline,
  collectNetworkEvidence,
  getSetupOverview,
  buildFeatures,
};
