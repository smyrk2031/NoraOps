const fs = require("fs");
const path = require("path");
const vscode = require("vscode");
const { requestJson } = require("./noraopsApi");
const { getNoraOpsConfig } = require("./config");
const { getLastCheckSummary, countSecErrors } = require("./savePipeline");

const COPILOT_EXTENSION_IDS = ["GitHub.copilot", "GitHub.copilot-chat"];
const ORG_GATEWAY_ACK_KEY = "noraops.copilot.orgGatewayAck";
const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  ".venv",
  "__pycache__",
  ".pytest_cache",
  "dist",
  "build",
]);

/** @returns {{ installed: string[], missing: string[] }} */
function getCopilotExtensionStatus() {
  const installed = [];
  const missing = [];
  for (const id of COPILOT_EXTENSION_IDS) {
    if (vscode.extensions.getExtension(id)) installed.push(id);
    else missing.push(id);
  }
  return { installed, missing, ok: missing.length === 0 };
}

/** VS Code 上の Copilot / Azure 関連設定のヒント（読み取りのみ） */
function readCopilotConfigHints() {
  const keys = [
    "github.copilot.enable",
    "github.copilot.chat.enable",
    "github.copilot.advanced.debug.useNodeFetcher",
    "github.copilot.chat.azureModels",
    "github.copilot.chat.azureEndpoint",
    "github.copilot.chat.azureDeployment",
  ];
  const cfg = vscode.workspace.getConfiguration();
  const hints = {};
  for (const k of keys) {
    const v = cfg.get(k);
    if (v !== undefined && v !== null && v !== "") hints[k] = v;
  }
  const azureKeys = Object.keys(hints).filter((k) => k.includes("azure") || k === "github.copilot.chat.azureModels");
  return {
    hints,
    hasAzureHints: azureKeys.length > 0,
    azureKeys,
  };
}

function isOrgGatewayAcknowledged(context) {
  if (!context?.globalState) return false;
  return context.globalState.get(ORG_GATEWAY_ACK_KEY) === true;
}

async function acknowledgeOrgGateway(context) {
  if (!context?.globalState) return false;
  await context.globalState.update(ORG_GATEWAY_ACK_KEY, true);
  await context.globalState.update("noraops.copilot.orgGatewayAckAt", new Date().toISOString());
  return true;
}

function listWorkspaceFiles(root, maxDepth = 5) {
  const out = [];
  function walk(dir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name) || ent.name === ".venv") continue;
        if (ent.name === "packages" && dir.replace(/\\/g, "/").endsWith("/nora")) continue;
        walk(full, depth + 1);
      } else {
        out.push(full);
      }
    }
  }
  walk(root, 0);
  return out;
}

function gitignoreCoversEnv(root) {
  const gi = path.join(root, ".gitignore");
  if (!fs.existsSync(gi)) return false;
  try {
    const text = fs.readFileSync(gi, "utf8");
    return /\.env\b|\.env\*/m.test(text);
  } catch {
    return false;
  }
}

/**
 * Copilot 利用前の機密プリフライト（個人 Copilot への流出リスク低減）
 * @param {string} workspaceRoot
 * @param {{ forbiddenPatterns?: string[] }} [policy]
 */
function scanSecretsForCopilot(workspaceRoot, policy = {}) {
  const patterns = (policy.forbiddenPatterns || [
    ".env",
    ".pem",
    "credentials",
    "gitea_pat_",
    "api_key",
    "password",
  ]).map((p) => String(p).toLowerCase());

  const findings = [];
  const files = listWorkspaceFiles(workspaceRoot);
  for (const f of files) {
    const base = path.basename(f).toLowerCase();
    const rel = path.relative(workspaceRoot, f).replace(/\\/g, "/").toLowerCase();
    for (const pat of patterns) {
      if (base.includes(pat) || rel.includes(pat)) {
        findings.push({
          kind: "file",
          severity: base === ".env" || base.startsWith(".env.") ? "error" : "warn",
          message: `機密の可能性: ${rel}`,
          file: rel,
        });
        break;
      }
    }
  }

  if (!gitignoreCoversEnv(workspaceRoot)) {
    const hasEnv = files.some((f) => {
      const b = path.basename(f);
      return b === ".env" || b.startsWith(".env.");
    });
    if (hasEnv) {
      findings.push({
        kind: "gitignore",
        severity: "error",
        message: ".env がありますが .gitignore に .env の記載がありません",
      });
    } else {
      findings.push({
        kind: "gitignore",
        severity: "warn",
        message: ".gitignore に .env の除外が無いと、誤コミットで Copilot 文脈に載る恐れがあります",
      });
    }
  }

  for (const doc of vscode.workspace.textDocuments) {
    if (doc.isUntitled || doc.uri.scheme !== "file") continue;
    const rel = path.relative(workspaceRoot, doc.uri.fsPath).replace(/\\/g, "/");
    if (rel.startsWith("..")) continue;
    const base = path.basename(doc.uri.fsPath).toLowerCase();
    if (base === ".env" || base.startsWith(".env.") || base.endsWith(".pem")) {
      findings.push({
        kind: "open_editor",
        severity: "error",
        message: `エディタで開いています: ${rel} — Copilot 利用前に閉じてください`,
        file: rel,
      });
    }
    const sample = doc.getText().slice(0, 8000).toLowerCase();
    if (/gitea_pat_|azure_openai_api_key|api[_-]?key\s*=\s*['"][^'"]{8,}/i.test(sample)) {
      findings.push({
        kind: "open_editor_content",
        severity: "error",
        message: `開いているファイルに鍵らしき文字列: ${rel}`,
        file: rel,
      });
    }
  }

  const errors = findings.filter((f) => f.severity === "error");
  return {
    ok: errors.length === 0,
    findings,
    errorCount: errors.length,
    warnCount: findings.length - errors.length,
  };
}

async function fetchAiStatusBrief() {
  const { serverBaseUrl } = getNoraOpsConfig();
  try {
    const { status, json } = await requestJson("GET", `${serverBaseUrl}/api/v1/noraops/ai/status`);
    if (status !== 200) {
      return { serverReachable: false, serverEnabled: false, httpStatus: status };
    }
    return {
      serverReachable: true,
      serverEnabled: !!json.enabled,
      configured: !!json.configured,
      usageBlocked: !!json.usageBlocked,
      usageToday: json.usageToday,
      dailyTokenLimit: json.dailyTokenLimit,
      endpoint: json.endpoint || "",
      deployment: json.deployment || "",
      requireOrgGateway: json.requireOrgGateway !== false,
    };
  } catch (e) {
    return { serverReachable: false, serverEnabled: false, error: e.message };
  }
}

async function fetchCopilotPolicy() {
  const { serverBaseUrl } = getNoraOpsConfig();
  const { status, json } = await requestJson("GET", `${serverBaseUrl}/api/v1/noraops/ai/copilot-policy`);
  if (status !== 200) throw new Error(`copilot-policy HTTP ${status}`);
  return json;
}

async function probeAiGateway() {
  const { serverBaseUrl } = getNoraOpsConfig();
  const { status, json } = await requestJson("GET", `${serverBaseUrl}/api/v1/noraops/ai/probe`);
  if (status === 503) {
    return { ok: false, reason: "disabled", detail: json?.detail || "AI disabled" };
  }
  if (status !== 200) {
    return { ok: false, reason: "http", detail: json?.detail || `HTTP ${status}` };
  }
  return json;
}

/**
 * Copilot BYOK 準備チェック（サーバー AI 有効時のみ意味がある）
 * @param {{ workspaceRoot?: string, context?: import('vscode').ExtensionContext, runProbe?: boolean }} opts
 */
async function runCopilotReadiness(opts = {}) {
  const workspaceRoot = opts.workspaceRoot;
  const context = opts.context;
  const runProbe = opts.runProbe !== false;

  const brief = await fetchAiStatusBrief();
  if (!brief.serverReachable) {
    return {
      phase: "offline",
      ok: false,
      summary: "NoraOps サーバーに接続できません",
      brief,
    };
  }
  if (!brief.serverEnabled) {
    return {
      phase: "disabled",
      ok: true,
      skipped: true,
      summary: "サーバーで AI 未利用（NORAOPS_AI_ENABLED=0）— チェック不要",
      brief,
    };
  }

  let policy;
  try {
    policy = await fetchCopilotPolicy();
  } catch (e) {
    return { phase: "policy", ok: false, summary: e.message, brief };
  }

  const copilot = getCopilotExtensionStatus();
  const configHints = readCopilotConfigHints();
  const secSummary = getLastCheckSummary();
  const secErr = countSecErrors(secSummary);

  let secrets = { ok: true, findings: [], errorCount: 0, warnCount: 0 };
  if (workspaceRoot) {
    secrets = scanSecretsForCopilot(workspaceRoot, policy);
  }

  const orgAck = isOrgGatewayAcknowledged(context);
  const blockers = [];

  if (!copilot.ok) {
    blockers.push(`GitHub Copilot 拡張が不足: ${copilot.missing.join(", ")}`);
  }
  if (secErr > 0) {
    blockers.push(`セキュリティチェック error が ${secErr} 件 — 先に「セキュリティチェック」を実行して修正`);
  }
  if (!secrets.ok) {
    blockers.push(`機密プリフライト error が ${secrets.errorCount} 件`);
  }
  if (brief.requireOrgGateway && !orgAck) {
    blockers.push("組織ゲートウェイのみ利用する旨の確認が未完了");
  }
  if (!brief.configured) {
    blockers.push("サーバー側 Azure OpenAI が未設定（.env）");
  }
  if (!configHints.hasAzureHints) {
    blockers.push(
      "VS Code の Copilot に Azure OpenAI（BYOK）設定が見つかりません — Copilot 設定で組織エンドポイントを指定してください"
    );
  }

  let probe = null;
  if (runProbe && blockers.length === 0) {
    probe = await probeAiGateway();
    if (!probe.ok) blockers.push(probe.detail || "Azure 接続プローブ失敗");
  } else if (runProbe && brief.configured && secrets.ok && copilot.ok) {
    probe = { ok: false, reason: "skipped", detail: "ブロッカー解消後に再実行" };
  }

  const ok = blockers.length === 0 && (!probe || probe.ok);

  return {
    phase: "ready",
    ok,
    summary: ok
      ? "Copilot BYOK 準備 OK（組織ゲートウェイ・機密チェック済み）"
      : blockers[0] || "要対応",
    blockers,
    brief,
    policy,
    copilot,
    configHints,
    secrets,
    secErrors: secErr,
    orgGatewayAck: orgAck,
    probe,
    checkedAt: new Date().toISOString(),
  };
}

function formatReadinessReport(report) {
  const lines = [report.summary];
  if (report.blockers?.length) {
    lines.push("", "ブロッカー:");
    for (const b of report.blockers) lines.push(`  • ${b}`);
  }
  if (report.secrets?.findings?.length) {
    lines.push("", "機密プリフライト:");
    for (const f of report.secrets.findings.slice(0, 8)) {
      lines.push(`  [${f.severity}] ${f.message}`);
    }
  }
  if (report.probe) {
    lines.push("", `プローブ: ${report.probe.ok ? "OK" : report.probe.detail || "NG"}`);
  }
  if (report.policy?.byokSetupHint) {
    lines.push("", "BYOK 手順:");
    for (const h of report.policy.byokSetupHint) lines.push(`  • ${h}`);
  }
  return lines.join("\n");
}

async function runCopilotReadinessWithUi(context, workspaceRoot) {
  const report = await runCopilotReadiness({
    workspaceRoot,
    context,
    runProbe: true,
  });

  if (report.skipped) {
    vscode.window.showInformationMessage(report.summary);
    return report;
  }

  const detail = formatReadinessReport(report);
  if (report.ok) {
    await vscode.window.showInformationMessage(report.summary, { modal: true, detail }, "閉じる");
    return report;
  }

  const actions = ["詳細をコピー", "組織利用を確認", "Copilot 設定を開く", "閉じる"];
  if (report.copilot && !report.copilot.ok) {
    actions.splice(3, 0, "Copilot 拡張をインストール");
  }
  const pick = await vscode.window.showWarningMessage(report.summary, { modal: true, detail }, ...actions);
  if (pick === "詳細をコピー") await vscode.env.clipboard.writeText(detail);
  if (pick === "組織利用を確認" && context) {
    const ok = await vscode.window.showWarningMessage(
      "個人の GitHub Copilot 課金ではなく、管理者が設定した組織の Azure OpenAI（BYOK）のみを使います。.env やトークンを Copilot に貼りません。",
      { modal: true },
      "同意する",
      "キャンセル"
    );
    if (ok === "同意する") {
      await acknowledgeOrgGateway(context);
      vscode.window.showInformationMessage("確認を記録しました。もう一度チェックを実行してください。");
    }
  }
  if (pick === "Copilot 設定を開く") {
    await openCopilotSettings();
  }
  if (pick === "Copilot 拡張をインストール" && context) {
    const { installCopilotExtensions } = require("./copilotByokSetup");
    await installCopilotExtensions();
  }
  return report;
}

/**
 * 個人 GitHub / Copilot 契約のリスク（組織 BYOK 未設定時）
 * Enterprise と Personal の完全判別は不可 — Azure BYOK 未設定 + GitHub ログインをヒューリスティックに使用
 */
async function detectPersonalGithubCopilotRisk() {
  const hints = readCopilotConfigHints();
  if (hints.hasAzureHints) {
    return { risk: false, reason: "byok_configured" };
  }

  const { ok: copilotInstalled } = getCopilotExtensionStatus();
  if (!copilotInstalled) {
    return { risk: false, reason: "no_copilot_ext" };
  }

  let session = null;
  try {
    session = await vscode.authentication.getSession("github", [], {
      createIfNone: false,
      silent: true,
    });
  } catch {
    session = null;
  }

  const copilotEnable = vscode.workspace.getConfiguration().get("github.copilot.enable");
  if (session?.account?.label && copilotEnable !== false) {
    const label = session.account.label;
    return {
      risk: true,
      accountLabel: label,
      message:
        `VS Code に GitHub アカウント「${label}」が紐づいています。` +
        `Azure BYOK（組織 AI）が未設定のため、個人版 Copilot 経由でコードが外部送信される恐れがあります。`,
    };
  }

  return { risk: false, reason: "no_github_session" };
}

async function openCopilotSettings() {
  const tries = [
    ["workbench.action.openSettings", "@ext:github.copilot"],
    ["workbench.action.openSettings", "github.copilot"],
  ];
  for (const [cmd, arg] of tries) {
    try {
      await vscode.commands.executeCommand(cmd, arg);
      return;
    } catch {
      /* continue */
    }
  }
  await vscode.env.openExternal(
    vscode.Uri.parse("https://docs.github.com/en/copilot/how-tos/configure-byok")
  );
}

module.exports = {
  COPILOT_EXTENSION_IDS,
  getCopilotExtensionStatus,
  readCopilotConfigHints,
  scanSecretsForCopilot,
  fetchAiStatusBrief,
  runCopilotReadiness,
  runCopilotReadinessWithUi,
  formatReadinessReport,
  acknowledgeOrgGateway,
  isOrgGatewayAcknowledged,
  openCopilotSettings,
  detectPersonalGithubCopilotRisk,
};
