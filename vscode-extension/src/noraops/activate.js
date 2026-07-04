const vscode = require("vscode");
const { createStatusBar, registerSaveCommand } = require("./statusBar");
const { refreshRules } = require("./savePipeline");
const { createHomePanel, refreshHomePanel, postToolsProgress } = require("./homePanel");
const { createHistoryPanel } = require("./historyPanel");
const { recordAppAccess } = require("./pathsMeta");
const { getEffectiveMode } = require("./mode");
const { createRunnerPanel } = require("./runner/runnerPanel");
const { checkExtensionUpdate } = require("./clientUpdate");
const { registerRunGuard } = require("./securityGate");


function openStartupPanels(context) {
  openPrimaryUi(context);
}

function scheduleDeferredWorkspaceInit(context) {
  setTimeout(() => {
    refreshRules()
      .then(async () => {
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) return;
        const ws = folder.uri.fsPath;
        const { runWorkspaceChecks } = require("./savePipeline");
        const { ensureLaunchConfig, isLikelyNoraOpsWorkspace } = require("./launchConfig");
        await runWorkspaceChecks(ws);
        if (isLikelyNoraOpsWorkspace(ws)) {
          try {
            ensureLaunchConfig(ws);
          } catch {
            /* ignore */
          }
        }
        refreshHomePanel();
        try {
          const { refreshGiteaBindingQuiet } = require("./giteaBinding");
          await refreshGiteaBindingQuiet(ws);
        } catch {
          /* ignore */
        }
        try {
          const { autoConfigureInterpreter } = require("./pythonEnv");
          await autoConfigureInterpreter(ws);
          refreshHomePanel();
        } catch {
          /* ignore */
        }
      })
      .catch(() => {});
  }, 3000);
}

async function openPrimaryUi(context) {
  const mode = getEffectiveMode();
  if (mode === "runner") {
    createRunnerPanel(context);
    return;
  }
  if (vscode.workspace.workspaceFolders?.length) {
    const ws = vscode.workspace.workspaceFolders[0].uri.fsPath;
    recordAppAccess(ws, {});
    createHomePanel(context);
  } else {
    setTimeout(() => createHomePanel(context), 500);
  }
}

function registerModeCommands(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand("noraops.openRunner", () => {
      createRunnerPanel(context);
    }),
    vscode.commands.registerCommand("noraops.openAppForEdit", async (owner, name) => {
      const { openPublishedAppForEdit } = require("./openAppForEdit");
      if (!owner || !name) {
        vscode.window.showWarningMessage("owner と name を指定してください。");
        return;
      }
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "NoraOps: 開発用ワークスペース",
          cancellable: false,
        },
        async (progress) => {
          progress.report({ message: "ソースを取得…" });
          await openPublishedAppForEdit(owner, name);
        }
      );
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("noraops.switchMode", async (target) => {
      const cfg = vscode.workspace.getConfiguration("noraops");
      const pick =
        target ||
        (await vscode.window.showQuickPick(
          [
            { label: "開発（Creator）", value: "creator", description: "アプリを作る・保存・Gitea" },
            { label: "利用（Runner）", value: "runner", description: "承認済みアプリを使う" },
            { label: "自動", value: "auto", description: "フォルダあり→開発、なし→利用" },
          ],
          { placeHolder: "NoraOps のモード" }
        ))?.value;
      if (!pick) return;
      await cfg.update("mode", pick, vscode.ConfigurationTarget.Global);
      if (pick === "runner") {
        createRunnerPanel(context);
      } else {
        await openPrimaryUi(context);
        if (pick === "creator" && !vscode.workspace.workspaceFolders?.length) {
          vscode.window.showInformationMessage("開発モード: フォルダを開くか「新しいアプリ」を選んでください。");
        }
      }
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("noraops.checkExtensionUpdate", async () => {
      await checkExtensionUpdate(context, { showCurrent: true });
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("noraops.openStorage", () => {
      const { createStoragePanel } = require("./storagePanel");
      createStoragePanel(context);
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("noraops.runHealthCheck", async () => {
      const { runHealthCheckWithUi } = require("./healthCheckUi");
      await runHealthCheckWithUi(null);
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("noraops.checkCopilotByok", async () => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) {
        vscode.window.showWarningMessage("フォルダを開いてから実行してください。");
        return;
      }
      const { runCopilotReadinessWithUi } = require("./copilotByokCheck");
      await runCopilotReadinessWithUi(context, folder.uri.fsPath);
      refreshHomePanel();
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("noraops.setupCopilotByok", async () => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      const { runFullByokSetup } = require("./copilotByokSetup");
      await runFullByokSetup(context, folder?.uri.fsPath, { runReadiness: !!folder });
      refreshHomePanel();
      const { refreshSetupPanel } = require("./setupPanel");
      refreshSetupPanel(context);
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("noraops.installCopilotExtensions", async () => {
      const { installCopilotExtensions } = require("./copilotByokSetup");
      await installCopilotExtensions();
      refreshHomePanel();
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("noraops.applyCopilotByokSettings", async () => {
      const { applyByokSettingsFromServer } = require("./copilotByokSetup");
      await applyByokSettingsFromServer();
      refreshHomePanel();
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("noraops.openAiUsagePortal", async () => {
      const { openAiUsageInBrowser } = require("./copilotByokSetup");
      await openAiUsageInBrowser();
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("noraops.runConcierge", async () => {
      const { createHomePanel } = require("./homePanel");
      const panel = createHomePanel(context);
      panel.webview.postMessage({ type: "openConciergeModal" });
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("noraops.copilotGuardCheck", async () => {
      const { runCopilotGuardCheckWithUi } = require("./copilotByokGuard");
      await runCopilotGuardCheckWithUi();
    })
  );
}

function activateNoraOps(context) {
  const { setExtensionContext } = require("./extensionContext");
  setExtensionContext(context);
  const { registerOutputChannels } = require("./outputChannels");
  registerOutputChannels(context);
  const { bindExtensionContext: bindAccessToken, loadAccessToken } = require("./accessTokenAuth");
  const { bindExtensionContext: bindSession, loadSessionToken, loginOtpInteractive } = require("./sessionAuth");
  const { bindExtensionContext: bindIpWhitelist } = require("./ipUserWhitelist");
  bindSession(context);
  bindAccessToken(context);
  bindIpWhitelist(context);
  loadSessionToken().catch(() => {});
  loadAccessToken().catch(() => {});
  const { initSecurityWarnReview } = require("./securityWarnReview");
  initSecurityWarnReview(context);
  createStatusBar(context);
  registerSaveCommand(context);
  registerRunGuard(context);
  registerModeCommands(context);

  context.subscriptions.push(
    vscode.commands.registerCommand("noraops.openSecurityGuard", () => {
      const { openSecurityGuardModal } = require("./setupPanel");
      openSecurityGuardModal(context);
    }),
    vscode.commands.registerCommand("noraops.openSetup", () => {
      const { createSetupPanel } = require("./setupPanel");
      createSetupPanel(context);
    }),
    vscode.commands.registerCommand("noraops.openConnect", () => {
      const { createConnectPanel } = require("./connectPanel");
      createConnectPanel(context);
    }),
    vscode.commands.registerCommand("noraops.registerDevice", async () => {
      const { createSetupPanel } = require("./setupPanel");
      await createSetupPanel(context);
    }),
    vscode.commands.registerCommand("noraops.loginEmailOtp", async () => {
      const { getNoraOpsConfig } = require("./config");
      const cfg = getNoraOpsConfig();
      if (!cfg.serverBaseUrl) {
        vscode.window.showWarningMessage("noraops.server.baseUrl が未設定です。");
        return;
      }
      try {
        const result = await loginOtpInteractive(cfg.serverBaseUrl);
        if (result.cancelled) return;
        vscode.window.showInformationMessage(
          `NoraOps にログインしました（${result.identity?.email || result.giteaLogin || "OK"}）。`
        );
      } catch (e) {
        vscode.window.showErrorMessage(`メールログインに失敗しました: ${e.message || e}`);
      }
    }),
    vscode.commands.registerCommand("noraops.exportRepos", async () => {
      const { getNoraOpsConfig } = require("./config");
      const { exportMyRepos } = require("./noraopsApi");
      const cfg = getNoraOpsConfig();
      if (!cfg.serverBaseUrl) {
        vscode.window.showWarningMessage("noraops.server.baseUrl が未設定です。");
        return;
      }
      try {
        const data = await exportMyRepos(cfg.serverBaseUrl);
        const lines = (data.repos || []).map((r) => r.cloneUrl || `${r.fullName}`);
        const text = lines.length ? lines.join("\n") : "(リポジトリなし)";
        await vscode.env.clipboard.writeText(text);
        vscode.window.showInformationMessage(
          `${lines.length} 件の clone URL をクリップボードにコピーしました。`
        );
      } catch (e) {
        vscode.window.showErrorMessage(`エクスポートに失敗しました: ${e.message || e}`);
      }
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("noraops.testServerConnection", async () => {
      const { createSetupPanel } = require("./setupPanel");
      createSetupPanel(context);
      vscode.window.showInformationMessage(
        "「NoraOps 設定」タブで URL を入力し「接続テスト」を押してください。"
      );
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("noraops.openHome", () => {
      createHomePanel(context);
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("noraops.openAiChatTool", async () => {
      const { openAiChatToolBeside } = require("./aiChatTool");
      await openAiChatToolBeside({ context, revealSetup: true });
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("noraops.pasteThumbnail", async () => {
      const { pasteThumbnailFromClipboard } = require("./homePanel");
      await pasteThumbnailFromClipboard();
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("noraops.ensureScaffold", async () => {
      const { runEnsureScaffoldInHome } = require("./homePanel");
      await runEnsureScaffoldInHome();
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("noraops.openHistory", () => {
      createHistoryPanel(context);
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("noraops.setupTools", async () => {
      const { ensureNoraOpsTools } = require("./toolInstaller");
      let lastPctByTool = {};
      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "NoraOps: uv をセットアップ",
            cancellable: false,
          },
          async (progress) => {
            progress.report({ message: "準備中…" });
            await ensureNoraOpsTools((p) => {
              const msg = p.message || p.stage || "";
              postToolsProgress({ ...p, message: msg });
              if (p.stage === "download-progress" && p.total > 0) {
                const key = p.tool || "default";
                const pct = Math.min(100, Math.floor((p.downloaded / p.total) * 100));
                const prev = lastPctByTool[key] || 0;
                const inc = pct - prev;
                if (inc > 0) {
                  progress.report({ message: msg, increment: inc });
                  lastPctByTool[key] = pct;
                }
              } else {
                lastPctByTool = {};
                progress.report({ message: msg });
              }
            });
          }
        );
        vscode.window.showInformationMessage("uv のセットアップが完了しました。");
        const { refreshToolsStatusBar } = require("./toolsStatusBar");
        await refreshToolsStatusBar();
        refreshHomePanel();
      } catch (e) {
        postToolsProgress({ stage: "error", message: String(e.message || e) });
        refreshHomePanel();
        vscode.window.showErrorMessage(`ツールのセットアップに失敗: ${e.message}`, { modal: true });
      }
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("noraops.checkTools", async () => {
      const { fetchToolsStatus } = require("./toolInstaller");
      const st = await fetchToolsStatus();
      refreshHomePanel();
      if (!st.online) {
        const hint =
          st.uv.installed
            ? `\n\nローカル uv: ${st.uv.version || "OK"}（${st.uv.path}）`
            : st.error?.includes("500")
              ? "\n\nヒント: manifest.json に BOM が付いていると 500 になります。nora-backend を再起動し、data/tools/windows-x64/manifest.json を確認してください。"
              : "";
        if (st.uv.installed) {
          await vscode.window.showInformationMessage(
            `uv はローカルで利用可能です。\n${st.uv.version || ""}\nmanifest は取得できませんでした。${hint}`,
            { modal: true },
            "閉じる"
          );
          return;
        }
        await vscode.window.showWarningMessage(
          `ツール manifest を取得できません。\n${st.error || "サーバに接続できません"}${hint}`,
          { modal: true },
          "セットアップを試す"
        );
        return;
      }
      const uvLine = `uv: ${st.uv.installed ? st.uv.version || "導入済み" : "未導入"}（必要: ${st.uv.required}）${
        st.uv.updateNeeded ? " → 更新あり" : ""
      }`;
      const gitLine = st.git.installed
        ? `git（任意）: ${st.git.version || "導入済み"} — 保存はサーバー側 git のため不要`
        : "git（任意）: 未導入 — 保存・Runner には不要。履歴表示のみ PATH の git を参照";
      const summary = st.ok ? "uv は利用可能です。" : "uv のセットアップが必要です。";
      const actions = st.ok ? ["閉じる"] : ["セットアップ", "閉じる"];
      const pick = await vscode.window.showInformationMessage(
        `${summary}\n\n${uvLine}\n${gitLine}`,
        { modal: true },
        ...actions
      );
      if (pick === "セットアップ") await vscode.commands.executeCommand("noraops.setupTools");
      const { refreshToolsStatusBar } = require("./toolsStatusBar");
      refreshToolsStatusBar().catch(() => {});
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("noraops.runSecurityCheck", async () => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) {
        vscode.window.showWarningMessage("フォルダを開いてから実行してください。");
        return;
      }
      await refreshRules();
      const { getActiveRulesBundle } = require("./savePipeline");
      const { runChecks } = require("./checkRunner");
      const { publishSecurityDiagnostics, formatSecBlockMessage } = require("./securityDiagnostics");
      const summary = runChecks(folder.uri.fsPath, getActiveRulesBundle(), true);
      publishSecurityDiagnostics(folder.uri.fsPath, summary);
      const sec = summary.secErrors?.length || 0;
      const warnN = summary.secWarns?.length || 0;
      const { getActiveSecWarns } = require("./securityWarnStore");
      const active = getActiveSecWarns(folder.uri.fsPath, summary);
      if (sec > 0) {
        vscode.window.showErrorMessage(
          `セキュリティ: ${sec} 件の error（IP 直書き等）\n${formatSecBlockMessage(summary)}`,
          "問題を開く"
        ).then((p) => {
          if (p === "問題を開く") vscode.commands.executeCommand("workbench.actions.view.problems");
        });
      } else if (active.length > 0) {
        const pick = await vscode.window.showWarningMessage(
          `セキュリティ警告 ${active.length} 件（未確認 ${active.length} / 検出計 ${warnN}）`,
          "確認する",
          "閉じる"
        );
        if (pick === "確認する") {
          const { openSecurityWarnReview } = require("./securityWarnReview");
          await openSecurityWarnReview(folder.uri.fsPath, summary);
        }
      } else {
        vscode.window.showInformationMessage("セキュリティチェック: 重大な問題は検出されませんでした。");
      }
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("noraops.reviewSecurityWarns", async () => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) {
        vscode.window.showWarningMessage("フォルダを開いてから実行してください。");
        return;
      }
      await refreshRules();
      const { getActiveRulesBundle } = require("./savePipeline");
      const { runChecks } = require("./checkRunner");
      const { publishSecurityDiagnostics } = require("./securityDiagnostics");
      const summary = runChecks(folder.uri.fsPath, getActiveRulesBundle(), true);
      publishSecurityDiagnostics(folder.uri.fsPath, summary);
      const { openSecurityWarnReview } = require("./securityWarnReview");
      await openSecurityWarnReview(folder.uri.fsPath, summary);
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("noraops.prepareWorkspace", async () => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) {
        vscode.window.showWarningMessage("フォルダを開いてから実行してください。");
        return;
      }
      const { ensureScaffoldForProfile } = require("./scaffold");
      const r = ensureScaffoldForProfile(folder.uri.fsPath);
      vscode.window.showInformationMessage(
        r.created.length
          ? `雛形を追加: ${r.created.join(", ")}`
          : "雛形はすでにあります。requirements.txt が無ければ保存時に追加されます。"
      );
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("noraops.syncRequirements", async () => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) return;
      const { syncRequirementsFromPyproject } = require("./scaffold");
      const r = syncRequirementsFromPyproject(folder.uri.fsPath);
      if (r.ok) vscode.window.showInformationMessage(`requirements.txt を更新（${r.count} 件）`);
      else vscode.window.showWarningMessage(r.message);
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("noraops.ensurePythonEnv", async () => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) {
        vscode.window.showWarningMessage("フォルダを開いてから実行してください。");
        return;
      }
      const { ensurePythonEnvWithUi } = require("./pythonEnv");
      const { refreshHomePanel, postPythonProgress } = require("./homePanel");
      postPythonProgress({ message: "Python 環境を準備中…" });
      try {
        await ensurePythonEnvWithUi(folder.uri.fsPath, { postPythonProgress });
      } finally {
        refreshHomePanel();
      }
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("noraops.openPythonLog", () => {
      const { showPythonOutputChannel } = require("./pythonEnv");
      showPythonOutputChannel();
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("noraops.listPythonPackages", async () => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) {
        vscode.window.showWarningMessage("フォルダを開いてから実行してください。");
        return;
      }
      const { showPythonPackagesQuickPick } = require("./pythonEnv");
      await showPythonPackagesQuickPick(folder.uri.fsPath);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("noraops.checkLayout", async () => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) {
        vscode.window.showWarningMessage("フォルダを開いてから実行してください。");
        return;
      }
      await refreshRules();
      const { getActiveRulesBundle } = require("./savePipeline");
      const { runChecks } = require("./checkRunner");
      const { ensureLaunchConfig } = require("./launchConfig");
      const ws = folder.uri.fsPath;
      const summary = runChecks(ws, getActiveRulesBundle(), true);
      ensureLaunchConfig(ws);
      const pol = summary.findings?.filter((f) => f.category === "policy") || [];
      const warns = pol.filter((f) => f.severity === "warn");
      const errs = pol.filter((f) => f.severity === "error");
      const lines = pol.slice(0, 8).map((f) => `・${f.message}`);
      if (lines.length < pol.length) lines.push(`…他 ${pol.length - lines.length} 件`);
      const title =
        errs.length > 0
          ? `構成エラー ${errs.length} 件 / 警告 ${warns.length} 件`
          : warns.length > 0
            ? `構成警告 ${warns.length} 件（nora/ 聖域のずれ）`
            : "フォルダ構成は NoraOps 公式どおりです";
      await vscode.window.showInformationMessage(title, { modal: true, detail: lines.join("\n") || "問題なし" }, "閉じる");
      const { refreshHomePanel } = require("./homePanel");
      refreshHomePanel();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("noraops.repairLaunchConfig", async () => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) {
        vscode.window.showWarningMessage("フォルダを開いてから実行してください。");
        return;
      }
      const { ensureLaunchConfig, detectPythonEntry } = require("./launchConfig");
      const entry = detectPythonEntry(folder.uri.fsPath);
      if (!entry) {
        vscode.window.showWarningMessage("main.py が見つかりません（ルート / nora/packages 等）。");
        return;
      }
      ensureLaunchConfig(folder.uri.fsPath);
      vscode.window.showInformationMessage(
        `F5 用の launch.json を更新しました。\n起動: ${entry.label}\n\n実行とデバッグ → 「NoraOps: アプリを実行 (F5)」を選んで F5。`
      );
    })
  );

  const cfg = require("./config").getNoraOpsConfig();
  const { needsFirstTimeSetup, createSetupPanel } = require("./setupPanel");
  if (needsFirstTimeSetup(context)) {
    createSetupPanel(context, { viewColumn: vscode.ViewColumn.One });
    vscode.window
      .showInformationMessage(
        "NoraOps: サーバー URL を設定してください（ポータルがブラウザで開けるアドレス）。",
        "設定を開く"
      )
      .then((p) => {
        if (p === "設定を開く") createSetupPanel(context);
      });
  } else if (cfg.autoOpenPanels !== false) {
    openStartupPanels(context);
  } else if (cfg.runnerAutoOpen !== false || getEffectiveMode() === "runner") {
    openPrimaryUi(context);
  } else if (vscode.workspace.workspaceFolders?.length) {
    const ws = vscode.workspace.workspaceFolders[0].uri.fsPath;
    recordAppAccess(ws, {});
  }

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      if (getEffectiveMode() === "runner") return;
      if (vscode.workspace.workspaceFolders?.length) {
        recordAppAccess(vscode.workspace.workspaceFolders[0].uri.fsPath, {});
      }
      const { refreshHomePanel } = require("./homePanel");
      setTimeout(() => refreshHomePanel(), 400);
    })
  );

  scheduleDeferredWorkspaceInit(context);

  const { refreshRuntimeConfig } = require("./runtimeConfig");
  refreshRuntimeConfig(cfg.serverBaseUrl).catch(() => {});

  setTimeout(() => {
    const { fetchAiStatusBrief } = require("./copilotByokCheck");
    fetchAiStatusBrief()
      .then((brief) => {
        if (brief.serverEnabled) {
          const { startCopilotByokGuard } = require("./copilotByokGuard");
          startCopilotByokGuard(context);
        }
      })
      .catch(() => {});
  }, 4000);

  if (cfg.toolsNotifyIfMissing !== false) {
    setTimeout(async () => {
      const { probeUvExe } = require("./toolInstaller");
      const { getNoraOpsRuntimePaths } = require("./toolsPaths");
      const paths = getNoraOpsRuntimePaths(cfg.toolsInstallRoot);
      const local = await probeUvExe(paths.uvExe);
      if (local.installed) return;
      const pick = await vscode.window.showWarningMessage(
        `NoraOps: uv が見つかりません。\n${paths.uvExe}\n\nNoraOps Setting から「uv をセットアップ」を実行してください。`,
        "セットアップ",
        "あとで"
      );
      if (pick === "セットアップ") vscode.commands.executeCommand("noraops.setupTools");
    }, 2000);
  }

  if (cfg.clientUpdateCheck !== false) {
    setTimeout(() => checkExtensionUpdate(context, { silent: true }), 3500);
  }
}

module.exports = { activateNoraOps };
