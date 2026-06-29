/**
 * 組織 BYOK 以外（個人 Copilot 無料枠等）への設定逸脱を検知し、BYOK に戻す。
 */
const vscode = require("vscode");
const {
  fetchAiStatusBrief,
  readCopilotConfigHints,
  openCopilotSettings,
} = require("./copilotByokCheck");
const { fetchByokClientConfig, applyByokSettingsFromServer } = require("./copilotByokSetup");

let guardActive = false;
let debounceTimer = null;
let lastEnforceAt = 0;
const ENFORCE_COOLDOWN_MS = 8000;

function normalizeUrl(u) {
  return String(u || "")
    .trim()
    .toLowerCase()
    .replace(/\/$/, "");
}

function endpointMatchesServer(configHints, serverCfg) {
  const expected = normalizeUrl(serverCfg?.endpoint || serverCfg?.vscodeSettings?.["github.copilot.chat.azureEndpoint"]);
  if (!expected) return configHints.hasAzureHints;
  const actual = normalizeUrl(configHints.hints?.["github.copilot.chat.azureEndpoint"]);
  return actual === expected;
}

/**
 * 個人 Copilot 利用とみなす条件（サーバー BYOK 有効時）
 */
async function detectPersonalCopilotRisk() {
  const brief = await fetchAiStatusBrief();
  if (!brief.serverEnabled || !brief.configured) {
    return { active: false, reason: "ai_off" };
  }

  const hints = readCopilotConfigHints();
  let serverCfg = null;
  try {
    serverCfg = await fetchByokClientConfig();
  } catch {
    return { active: false, reason: "config_fetch_failed" };
  }

  if (!hints.hasAzureHints) {
    return {
      active: true,
      reason: "no_azure_hints",
      brief,
      serverCfg,
      message: "Copilot の Azure OpenAI（BYOK）設定が見つかりません。個人の GitHub Copilot 課金に切り替わっている可能性があります。",
    };
  }

  if (!endpointMatchesServer(hints, serverCfg)) {
    return {
      active: true,
      reason: "endpoint_mismatch",
      brief,
      serverCfg,
      message:
        "Copilot のエンドポイントが組織 Azure と一致しません。機密流出防止のため組織 BYOK に戻します。",
    };
  }

  const enable = vscode.workspace.getConfiguration().get("github.copilot.enable");
  const chatEnable = vscode.workspace.getConfiguration().get("github.copilot.chat.enable");
  if (enable === false || chatEnable === false) {
    return {
      active: true,
      reason: "copilot_disabled",
      brief,
      serverCfg,
      message: "GitHub Copilot が無効になっています。組織 BYOK 利用のため再度有効化します。",
    };
  }

  return { active: false, reason: "ok", brief, serverCfg };
}

async function enforceByokSettings(reason) {
  const now = Date.now();
  if (now - lastEnforceAt < ENFORCE_COOLDOWN_MS) return;
  lastEnforceAt = now;

  const scopeKey = "noraops.copilot.byokSettingsScope";
  const saved = vscode.workspace.getConfiguration().get(scopeKey);
  const target =
    saved === "workspace" && vscode.workspace.workspaceFolders?.length
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;

  const result = await applyByokSettingsFromServer({ target, silentConfirm: true });
  if (result.ok) {
    vscode.window
      .showWarningMessage(
        `【NoraOps】${reason}\n組織の Azure OpenAI（BYOK）設定に戻しました。API キーは Copilot 設定で組織手順に従ってください。個人 Copilot 無料枠は使わないでください。`,
        "Copilot 設定を開く",
        "了解"
      )
      .then((pick) => {
        if (pick === "Copilot 設定を開く") openCopilotSettings();
      });
  }
}

async function runGuardCheck() {
  if (!guardActive) return;
  try {
    const risk = await detectPersonalCopilotRisk();
    if (risk.active) {
      await enforceByokSettings(risk.message);
    }
  } catch {
    /* ignore */
  }
}

function scheduleGuardCheck() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    runGuardCheck();
  }, 600);
}

/**
 * @param {import('vscode').ExtensionContext} context
 */
function startCopilotByokGuard(context) {
  if (guardActive) return;
  guardActive = true;

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration("github.copilot") ||
        e.affectsConfiguration("github.copilot.chat")
      ) {
        scheduleGuardCheck();
      }
    })
  );

  const interval = setInterval(() => runGuardCheck(), 90_000);
  context.subscriptions.push({ dispose: () => clearInterval(interval) });

  setTimeout(() => runGuardCheck(), 3000);
}

async function runCopilotGuardCheckWithUi() {
  const risk = await detectPersonalCopilotRisk();
  if (!risk.active) {
    vscode.window.showInformationMessage("Copilot 設定: 組織 BYOK として問題ありません。");
    return risk;
  }
  await enforceByokSettings(risk.message);
  return risk;
}

module.exports = {
  startCopilotByokGuard,
  runGuardCheck,
  detectPersonalCopilotRisk,
  runCopilotGuardCheckWithUi,
};
