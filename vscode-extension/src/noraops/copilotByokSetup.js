/**
 * Copilot BYOK Phase 3: 拡張インストール・設定反映・利用量表示
 */
const vscode = require("vscode");
const { requestJson } = require("./noraopsApi");
const { getNoraOpsConfig } = require("./config");
const {
  COPILOT_EXTENSION_IDS,
  getCopilotExtensionStatus,
  readCopilotConfigHints,
  fetchAiStatusBrief,
  runCopilotReadinessWithUi,
  openCopilotSettings,
} = require("./copilotByokCheck");

const BYOK_SCOPE_KEY = "noraops.copilot.byokSettingsScope";

/**
 * @returns {Promise<{ installed: string[], failed: {id:string, error:string}[] }>}
 */
async function installCopilotExtensions() {
  const { missing } = getCopilotExtensionStatus();
  const installed = [];
  const failed = [];
  for (const id of missing) {
    try {
      await vscode.commands.executeCommand("workbench.extensions.installExtension", id);
      installed.push(id);
    } catch (e) {
      failed.push({ id, error: e.message });
    }
  }
  await new Promise((r) => setTimeout(r, 1500));
  return { installed, failed, ok: getCopilotExtensionStatus().ok };
}

async function fetchByokClientConfig() {
  const { serverBaseUrl } = getNoraOpsConfig();
  const { status, json } = await requestJson(
    "GET",
    `${serverBaseUrl}/api/v1/noraops/ai/byok-client-config`
  );
  if (status === 503) {
    return { disabled: true, detail: json?.detail || "AI disabled" };
  }
  if (status !== 200) {
    throw new Error(`byok-client-config HTTP ${status}`);
  }
  return json;
}

async function fetchAiUsageSummary(days = 30) {
  const { serverBaseUrl } = getNoraOpsConfig();
  try {
    const { status, json } = await requestJson(
      "GET",
      `${serverBaseUrl}/api/v1/noraops/ai/usage?days=${days}`
    );
    if (status === 503) return { disabled: true };
    if (status !== 200) return { error: `HTTP ${status}` };
    return json;
  } catch (e) {
    return { error: e.message };
  }
}

async function fetchAiUsageForRepo(context, days = 30) {
  const { serverBaseUrl } = getNoraOpsConfig();
  if (!serverBaseUrl) return null;
  const params = new URLSearchParams({ days: String(days) });
  if (context?.appId) {
    params.set("app_id", context.appId);
  } else if (context?.repoOwner && context?.repoName) {
    params.set("repo_owner", context.repoOwner);
    params.set("repo_name", context.repoName);
  } else {
    return null;
  }
  try {
    const { status, json } = await requestJson(
      "GET",
      `${serverBaseUrl}/api/v1/noraops/ai/usage/repo?${params.toString()}`
    );
    if (status === 200) return json;
    return { error: `HTTP ${status}` };
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * 設定パネル / Creator 向けの AI 状態まとめ
 */
async function buildCopilotPanelState(workspaceRoot) {
  const brief = await fetchAiStatusBrief();
  if (!brief.serverReachable) {
    return {
      serverReachable: false,
      serverEnabled: false,
      summary: "サーバー未接続",
    };
  }
  if (!brief.serverEnabled) {
    const { getAiUsageContext } = require("./aiContext");
    const ctx = workspaceRoot ? getAiUsageContext(workspaceRoot) : null;
    const repoUsage = ctx ? await fetchAiUsageForRepo(ctx, 30) : null;
    return {
      serverReachable: true,
      serverEnabled: false,
      brief,
      usage: { disabled: true },
      repoUsage,
      usageUi: formatUsageForUi({ disabled: true }, repoUsage, ctx),
      summary: "サーバーで AI 未利用（CMS または .env で OFF）",
    };
  }

  const extensions = getCopilotExtensionStatus();
  const configHints = readCopilotConfigHints();
  let byokConfig = null;
  try {
    byokConfig = await fetchByokClientConfig();
  } catch (e) {
    byokConfig = { error: e.message };
  }
  const usage = await fetchAiUsageSummary(30);
  const { getAiUsageContext } = require("./aiContext");
  const ctx = workspaceRoot ? getAiUsageContext(workspaceRoot) : null;
  const repoUsage = ctx ? await fetchAiUsageForRepo(ctx, 30) : null;

  return {
    serverReachable: true,
    serverEnabled: true,
    brief,
    extensions,
    configHints,
    byokConfig,
    usage,
    repoUsage,
    usageContext: ctx,
    usageUi: formatUsageForUi(usage, repoUsage, ctx),
    summary: brief.configured ? "組織 AI 利用可能" : "Azure 未設定（サーバー .env）",
  };
}

async function chooseConfigurationTarget() {
  const pick = await vscode.window.showQuickPick(
    [
      {
        label: "ユーザー設定（この PC の全ワークスペース）",
        value: vscode.ConfigurationTarget.Global,
      },
      {
        label: "ワークスペース設定（このフォルダのみ）",
        value: vscode.ConfigurationTarget.Workspace,
      },
    ],
    { title: "BYOK 設定の保存先" }
  );
  return pick?.value ?? null;
}

/**
 * サーバーから endpoint / deployment を VS Code に反映（API キーは書かない）
 */
async function applyByokSettingsFromServer(options = {}) {
  const scopeKey = "noraops.copilot.byokSettingsScope";
  let target = options.target;
  if (!target) {
    const saved = vscode.workspace.getConfiguration().get(scopeKey);
    if (saved === "workspace" && vscode.workspace.workspaceFolders?.length) {
      target = vscode.ConfigurationTarget.Workspace;
    } else if (saved === "global") {
      target = vscode.ConfigurationTarget.Global;
    } else if (options.silentConfirm) {
      target = vscode.ConfigurationTarget.Global;
    } else {
      target = await chooseConfigurationTarget();
    }
  }
  if (!target) return { ok: false, cancelled: true };

  let cfg;
  try {
    cfg = await fetchByokClientConfig();
  } catch (e) {
    vscode.window.showErrorMessage(`BYOK 設定の取得に失敗: ${e.message}`);
    return { ok: false, error: e.message };
  }
  if (cfg.disabled) {
    vscode.window.showInformationMessage("サーバーで AI が無効です。");
    return { ok: false, disabled: true };
  }
  if (!cfg.configured) {
    vscode.window.showWarningMessage(
      "サーバー側 Azure OpenAI が未設定です。管理者が .env を設定してください。"
    );
    return { ok: false, notConfigured: true };
  }

  const settings = cfg.vscodeSettings || {};
  const keys = Object.keys(settings);
  const preview = keys.map((k) => `  ${k}`).join("\n");
  if (!options.silentConfirm) {
    const ok = await vscode.window.showWarningMessage(
      "次の Copilot 設定を VS Code に書き込みます（API キーは含みません）。",
      { modal: true, detail: `${preview}\n\n${cfg.note || ""}` },
      "書き込む",
      "キャンセル"
    );
    if (ok !== "書き込む") return { ok: false, cancelled: true };
  }

  const conf = vscode.workspace.getConfiguration();
  for (const [key, value] of Object.entries(settings)) {
    await conf.update(key, value, target);
  }
  await vscode.workspace
    .getConfiguration()
    .update(scopeKey, target === vscode.ConfigurationTarget.Global ? "global" : "workspace", target);

  if (!options.silentConfirm) {
    vscode.window.showInformationMessage(
      "Copilot BYOK 設定（エンドポイント・デプロイ）を反映しました。API キーは Copilot 設定で組織手順に従って入力してください。"
    );
  }
  return { ok: true, applied: keys, target };
}

async function runFullByokSetup(context, workspaceRoot, options = {}) {
  const panel = await buildCopilotPanelState(workspaceRoot);
  if (!panel.serverEnabled) {
    if (!options.silent) {
      vscode.window.showInformationMessage(panel.summary || "AI 未利用");
    }
    return panel;
  }

  const { missing } = getCopilotExtensionStatus();
  if (missing.length) {
    const install = await vscode.window.showInformationMessage(
      `GitHub Copilot 拡張が未インストールです: ${missing.join(", ")}`,
      "インストールする",
      "あとで"
    );
    if (install === "インストールする") {
      const result = await installCopilotExtensions();
      if (!result.ok) {
        vscode.window.showWarningMessage(
          `一部インストールできませんでした: ${result.failed.map((f) => f.id).join(", ")} — Marketplace から手動で追加してください。`
        );
      } else {
        vscode.window.showInformationMessage("Copilot 拡張をインストールしました。VS Code の再読み込みが必要な場合があります。");
      }
    }
  }

  const hints = readCopilotConfigHints();
  if (!hints.hasAzureHints && panel.brief?.configured) {
    const apply = await vscode.window.showInformationMessage(
      "Copilot の Azure OpenAI（BYOK）設定が見つかりません。サーバー情報から反映しますか？",
      "反映する",
      "手動で設定",
      "スキップ"
    );
    if (apply === "反映する") {
      await applyByokSettingsFromServer();
    } else if (apply === "手動で設定") {
      await openCopilotSettings();
    }
  }

  if (options.runReadiness && workspaceRoot) {
    await runCopilotReadinessWithUi(context, workspaceRoot);
  }

  return buildCopilotPanelState(
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  );
}

function aiUsagePortalUrl() {
  const { serverBaseUrl } = getNoraOpsConfig();
  const base = (serverBaseUrl || "").replace(/\/$/, "");
  return `${base}/noraops/ai-usage`;
}

async function openAiUsageInBrowser() {
  const url = aiUsagePortalUrl();
  await vscode.env.openExternal(vscode.Uri.parse(url));
}

function formatUsageForUi(usage, repoUsage, context) {
  const lines = [];
  if (!usage || usage.disabled) {
    lines.push("組織 AI: サーバーで無効");
  } else if (usage.error) {
    lines.push(`利用量取得エラー: ${usage.error}`);
  } else {
    const today = usage.today || {};
    const totals = usage.totals || {};
    lines.push(
      `組織 本日: ${today.tokens_total ?? 0} tok · 推定 ¥${Math.round(today.cost_jpy ?? 0)}`,
      `組織 30日: ${totals.tokens_total ?? 0} tok · 推定 ¥${Math.round(totals.cost_jpy ?? 0)}`,
      `月間予測: 約 ¥${usage.projectedMonthlyJpy ?? 0}`
    );
    if (usage.pricing) {
      lines.push(
        `単価: 入力 ¥${usage.pricing.jpyPer1kInput}/1K · 出力 ¥${usage.pricing.jpyPer1kOutput}/1K`
      );
    }
  }
  const label = context?.repoLabel || repoUsage?.repo_label || "";
  if (repoUsage?.error) {
    lines.push(`このリポ: 取得エラー (${repoUsage.error})`);
  } else if (repoUsage && (repoUsage.tokens_total || 0) > 0) {
    lines.push(
      `このリポ${label ? ` (${label})` : ""}: ${repoUsage.tokens_total} tok · 推定 ¥${Math.round(repoUsage.cost_jpy ?? 0)}`
    );
  } else if (label) {
    lines.push(`このリポ (${label}): AI 利用記録なし`);
  }
  return {
    lines,
    yen: usage?.totals?.cost_jpy ?? null,
    repoYen: repoUsage?.cost_jpy ?? null,
    usage,
    repoUsage,
  };
}

module.exports = {
  installCopilotExtensions,
  fetchByokClientConfig,
  fetchAiUsageSummary,
  fetchAiUsageForRepo,
  buildCopilotPanelState,
  applyByokSettingsFromServer,
  runFullByokSetup,
  openAiUsageInBrowser,
  aiUsagePortalUrl,
  formatUsageForUi,
};
