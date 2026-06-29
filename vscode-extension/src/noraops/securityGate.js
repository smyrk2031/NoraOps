const vscode = require("vscode");
const { refreshRules, getActiveRulesBundle } = require("./savePipeline");
const { runChecks } = require("./checkRunner");
const { publishSecurityDiagnostics, formatSecBlockMessage } = require("./securityDiagnostics");
const { promptSecWarnsBeforeRun } = require("./securityWarnGate");
const { coalesceRunPrompt } = require("./runPromptCoalesce");
const { shouldBlockExecution } = require("./securityGatePolicy");

const patchedTerminals = new WeakSet();
const inflightGateChecks = new Map();

async function coalesceGateCheck(workspaceRoot, fn) {
  const key = `gate:${workspaceRoot}`;
  const existing = inflightGateChecks.get(key);
  if (existing) return existing;
  const task = fn().finally(() => {
    if (inflightGateChecks.get(key) === task) inflightGateChecks.delete(key);
  });
  inflightGateChecks.set(key, task);
  return task;
}

function logGate(message) {
  const outputChannel = require("./outputChannels").getSecurityOutputChannel();
  if (!outputChannel) return;
  outputChannel.appendLine(`[${new Date().toISOString()}] ${message}`);
}

function resolveWorkspaceRoot(resource) {
  const uri = resource || vscode.window.activeTextEditor?.document?.uri;
  if (!uri || uri.scheme !== "file") return null;
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  return folder?.uri.fsPath || null;
}

function looksLikePythonRun(commandLine) {
  const line = String(commandLine || "").trim();
  if (!line) return false;
  return /\bpython(?:\.exe)?\b/i.test(line) || /\bpy(?:\.exe)?\s+-[23]/i.test(line);
}

async function runSecurityGate(workspaceRoot) {
  if (!workspaceRoot) return { ok: true, sec: 0, summary: null, online: true };

  const online = await refreshRules();
  const bundle = getActiveRulesBundle();
  const rulesFrom = bundle?.source || "bundled";
  const summary = runChecks(workspaceRoot, bundle, online);
  publishSecurityDiagnostics(workspaceRoot, summary);

  const sec = summary.secErrors?.length || 0;
  const block = shouldBlockExecution(summary);
  logGate(
    `check workspace=${workspaceRoot} rules=${rulesFrom} online=${online} secErrors=${sec} block=${block} ` +
      (sec ? summary.secErrors.map((e) => `${e.file}:${e.line}`).join(", ") : "ok")
  );
  if (sec > 0 && block) {
    const ch = require("./outputChannels").getSecurityOutputChannel();
    if (ch) ch.show(true);
  }

  return { ok: !block, sec, summary, online, block };
}

async function runSecurityGateCoalesced(workspaceRoot) {
  return coalesceGateCheck(workspaceRoot, () => runSecurityGate(workspaceRoot));
}

async function gateBeforeRun(resource) {
  const ws = resolveWorkspaceRoot(resource);
  if (!ws) return { ok: true };
  const result = await runSecurityGateCoalesced(ws);
  if (!result.ok) {
    await showSecurityBlockDialog(result.summary, result.online);
    return { ok: false };
  }
  await promptSecWarnsBeforeRun(ws, result.summary);
  return { ok: true };
}

async function showSecurityBlockDialog(summary, online = true) {
  const errs = summary?.secErrors || [];
  if (!errs.length) return;
  const key = `block:${errs.map((e) => `${e.file}:${e.line}`).join("|")}`;
  await coalesceRunPrompt(key, async () => {
    const detail =
      formatSecBlockMessage(summary) +
      "\n\nProblems パネルでファイルと行を確認できます。環境変数や設定ファイルへの移行を検討してください。";
    const pick = await vscode.window.showErrorMessage(
      `安全のため実行を止めました。セキュリティ違反が ${errs.length} か所あります。`,
      { modal: true, detail },
      "問題を開く",
      "Setting でルール確認",
      "閉じる"
    );
    if (pick === "問題を開く") {
      await vscode.commands.executeCommand("workbench.actions.view.problems");
    } else if (pick === "Setting でルール確認") {
      await vscode.commands.executeCommand("noraops.openSecurityGuard");
    }
  });
}

function patchTerminalSendText(terminal) {
  if (!terminal || patchedTerminals.has(terminal)) return;
  const orig = terminal.sendText?.bind(terminal);
  if (!orig) return;
  patchedTerminals.add(terminal);

  terminal.sendText = (text, addNewLine) => {
    const line = String(text ?? "");
    if (!looksLikePythonRun(line)) {
      return orig(text, addNewLine);
    }
    return (async () => {
      const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!ws) {
        return orig(text, addNewLine);
      }
      const gate = await gateBeforeRun();
      if (!gate.ok) return undefined;
      return orig(text, addNewLine);
    })();
  };
}

function registerTerminalRunGuard(context) {
  for (const terminal of vscode.window.terminals) {
    patchTerminalSendText(terminal);
  }
  context.subscriptions.push(
    vscode.window.onDidOpenTerminal((terminal) => {
      patchTerminalSendText(terminal);
    })
  );

  if (vscode.window.onDidStartTerminalShellExecution) {
    context.subscriptions.push(
      vscode.window.onDidStartTerminalShellExecution(async (event) => {
        const cmdLine = (event.execution?.commandLine?.value || "").trim();
        if (!looksLikePythonRun(cmdLine)) return;
        const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!ws) return;
        const result = await runSecurityGate(ws);
        if (!result.ok && result.block) {
          try {
            event.execution?.terminate?.();
          } catch {
            /* ignore */
          }
          await showSecurityBlockDialog(result.summary, result.online);
        } else if (result.ok) {
          await promptSecWarnsBeforeRun(ws, result.summary);
        }
      })
    );
  }
}

function createDebugConfigurationProvider() {
  async function evaluate(folder) {
    const ws = folder || vscode.workspace.workspaceFolders?.[0];
    if (!ws) return null;
    const result = await runSecurityGateCoalesced(ws.uri.fsPath);
    return { ws, result };
  }

  return {
    resolveDebugConfiguration: async (folder, config) => {
      const ctx = await evaluate(folder);
      if (!ctx) return config;
      if (!ctx.result.ok) {
        await showSecurityBlockDialog(ctx.result.summary, ctx.result.online);
        return null;
      }
      return config;
    },
    resolveDebugConfigurationWithSubstitutedVariables: async (folder, config) => {
      const ctx = await evaluate(folder);
      if (!ctx) return config;
      if (!ctx.result.ok) {
        await showSecurityBlockDialog(ctx.result.summary, ctx.result.online);
        return null;
      }
      await promptSecWarnsBeforeRun(ctx.ws.uri.fsPath, ctx.result.summary);
      return config;
    },
  };
}

function registerDebugGate(context) {
  const provider = createDebugConfigurationProvider();
  const triggerKind = vscode.DebugConfigurationProviderTriggerKind?.Initial;
  for (const debugType of ["debugpy", "python"]) {
    context.subscriptions.push(
      triggerKind != null
        ? vscode.debug.registerDebugConfigurationProvider(debugType, provider, triggerKind)
        : vscode.debug.registerDebugConfigurationProvider(debugType, provider)
    );
  }

  context.subscriptions.push(
    vscode.debug.onDidStartDebugSession(async (session) => {
      const folder = session.workspaceFolder || vscode.workspace.workspaceFolders?.[0];
      if (!folder) return;
      const t = session.type || "";
      if (t !== "python" && t !== "debugpy") return;

      const result = await runSecurityGateCoalesced(folder.uri.fsPath);
      if (!shouldBlockExecution(result.summary)) return;

      try {
        await vscode.debug.stopSession(session);
      } catch {
        /* ignore */
      }
      await showSecurityBlockDialog(result.summary, result.online);
    })
  );
}

function registerRunGuard(context) {
  registerDebugGate(context);
  registerTerminalRunGuard(context);
}

module.exports = {
  runSecurityGate,
  registerDebugGate,
  registerRunGuard,
  showSecurityBlockDialog,
  gateBeforeRun,
  shouldBlockExecution,
  looksLikePythonRun,
};
