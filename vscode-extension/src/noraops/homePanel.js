const fs = require("fs");
const path = require("path");
const vscode = require("vscode");
const { readRecentApps, readWorkspaceSession, writeWorkspaceSession } = require("./pathsMeta");
const { getPythonEnvStatus } = require("./pythonEnv");
const { workspaceAppRoot, pyprojectRelPath, defaultWorkspaceVenvDir } = require("./projectPaths");
const { getLastCheckSummary, countSecErrors, isLastOnline } = require("./savePipeline");
const { createStaleCache } = require("./panelStateCache");

let homePanel;
let homeRefreshGen = 0;
/** @type {Map<string, { plan: object[], markdown: string }>} */
const xllmPlanByWorkspace = new Map();
const homeStateCache = createStaleCache(20000);
/** @type {vscode.FileSystemWatcher | undefined} */
let mockPreviewWatcher;
let mockWatchRoot = null;

function pushMockPreviewToWebview(webview, workspaceRoot) {
  if (!webview || !workspaceRoot) return;
  const { buildMockPreviewPayload } = require("./mockPrompts");
  const { detectCreatorProgress } = require("./creatorProgress");
  webview.postMessage({
    type: "mockPreviewUpdated",
    preview: buildMockPreviewPayload(workspaceRoot),
    mockReady: detectCreatorProgress(workspaceRoot).mockReady,
  });
}

function ensureMockPreviewWatcher(workspaceRoot) {
  if (mockWatchRoot === workspaceRoot && mockPreviewWatcher) return;
  if (mockPreviewWatcher) {
    mockPreviewWatcher.dispose();
    mockPreviewWatcher = undefined;
  }
  mockWatchRoot = workspaceRoot || null;
  if (!workspaceRoot) return;
  const pattern = new vscode.RelativePattern(workspaceRoot, "nora/mock/index.html");
  mockPreviewWatcher = vscode.workspace.createFileSystemWatcher(pattern);
  const onChange = () => {
    if (homePanel?.webview) {
      pushMockPreviewToWebview(homePanel.webview, workspaceRoot);
      postState({ force: true }).catch(() => {});
    }
  };
  mockPreviewWatcher.onDidChange(onChange);
  mockPreviewWatcher.onDidCreate(onChange);
}

function attachMockUiState(state, workspaceRoot) {
  if (!workspaceRoot) return state;
  const {
    readMockSpec,
    readManifestDisplayName,
    buildMockPreviewPayload,
    MOCK_EXAMPLES,
    MOCK_SAMPLE_CATEGORIES,
    TARGET_PLATFORMS,
    EXAMPLE_APP_TITLE,
    EXAMPLE_OPERATION_STEPS,
  } = require("./mockPrompts");
  const { getAiChatUrl } = require("./aiChatTool");
  const session = readWorkspaceSession(workspaceRoot);
  const spec = readMockSpec(workspaceRoot);
  state.mock = {
    defaultAppTitle:
      spec?.appTitle ||
      readManifestDisplayName(workspaceRoot) ||
      session?.displayName ||
      path.basename(workspaceRoot),
    spec,
    examples: MOCK_EXAMPLES,
    sampleCategories: MOCK_SAMPLE_CATEGORIES,
    targetPlatforms: TARGET_PLATFORMS,
    defaultTargetPlatform: spec?.targetPlatform || "browser",
    exampleAppTitle: EXAMPLE_APP_TITLE,
    exampleOperationSteps: EXAMPLE_OPERATION_STEPS,
    preview: buildMockPreviewPayload(workspaceRoot),
    indexRel: "nora/mock/index.html",
    aiChatConfigured: !!getAiChatUrl(),
    editTips: require("./devPrompts").MOCK_EDIT_TIPS,
  };
  return state;
}

async function saveThumbnailToWorkspace(workspaceRoot, options = {}) {
  const { applyThumbnailPng, applyThumbnailFile } = require("./thumbnailAsset");
  const { readClipboardImageToTempFile } = require("./thumbnailClipboard");
  const dataUrl = options.dataUrl;

  if (dataUrl && String(dataUrl).length > 0 && String(dataUrl).length < 4_000_000) {
    applyThumbnailPng(workspaceRoot, dataUrl);
    return;
  }
  if (options.fromClipboard !== false) {
    const tmp = await readClipboardImageToTempFile();
    if (tmp) {
      try {
        applyThumbnailFile(workspaceRoot, tmp);
        return;
      } finally {
        try {
          fs.unlinkSync(tmp);
        } catch {
          /* ignore */
        }
      }
    }
  }
  throw new Error(
    "画像を取得できませんでした。サムネ枠をクリックして Ctrl+V、または「クリップボードから保存」を試してください。"
  );
}

function requireWorkspaceFolder() {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    vscode.window.showWarningMessage("フォルダを開いてから実行してください。");
    return null;
  }
  return folder;
}

async function runEnsureScaffoldInHome(options = {}) {
  const folder = requireWorkspaceFolder();
  if (!folder) return null;
  try {
    const { ensureScaffoldForProfile } = require("./scaffold");
    const r = ensureScaffoldForProfile(folder.uri.fsPath);
    if (!options.silent) {
      let msg;
      if (r.skipped) {
        msg = "環境のみモードのため、雛形は作成しません。";
      } else if (r.created?.length) {
        msg = `雛形を入れました: ${r.created.join(", ")}`;
        if (r.preserved?.length) {
          msg += `\n既存ファイルは上書きしませんでした: ${r.preserved.join(", ")}`;
        }
      } else if (r.preserved?.length) {
        msg = `雛形はすでにあります。既存ファイルは上書きしませんでした: ${r.preserved.join(", ")}`;
      } else {
        msg = "雛形はすでにあります。次のステップへ進んでください。";
      }
      vscode.window.showInformationMessage(msg);
      await vscode.commands.executeCommand("workbench.files.action.refreshFilesExplorer");
    }
    await postState({ force: true });
    return r;
  } catch (e) {
    if (!options.silent) {
      vscode.window.showErrorMessage(`雛形の作成に失敗: ${e.message}`, { modal: true });
    }
    throw e;
  }
}

function buildCreatorFlow(state) {
  const p = state.creatorProgress || {};
  const todoCount = (state.secIssues || 0) + (state.polIssues || 0);
  const cloud = !!state.cloudOk;

  const done = {
    scaffold: !!p.scaffold,
    develop: !!p.scaffold,
    deps: !!p.hasDeps,
    venv: !!p.pythonReady,
    sync: !!p.pythonReady,
    run: !!p.hasLaunch,
    save: cloud,
  };

  const order = ["scaffold", "develop", "deps", "venv", "sync", "run", "save"];
  let currentId = "scaffold";
  for (const id of order) {
    if (!done[id]) {
      currentId = id;
      break;
    }
  }
  if (cloud) currentId = "done";

  const stepStatus = (id) => {
    if (done[id]) return "done";
    if (id === currentId) return "current";
    return "pending";
  };

  const steps = [
    {
      id: "scaffold",
      label: "1 雛形",
      desc: "NoraOps 必須ファイル",
      status: stepStatus("scaffold"),
    },
    {
      id: "develop",
      label: "2 開発",
      desc: "手動 or Copilot",
      status: stepStatus("develop"),
    },
    {
      id: "deps",
      label: "3 依存",
      desc: "pyproject.toml",
      status: stepStatus("deps"),
    },
    {
      id: "venv",
      label: "4 環境",
      desc: "uv で venv",
      status: stepStatus("venv"),
    },
    {
      id: "sync",
      label: "5 導入",
      desc: "uv sync",
      status: stepStatus("sync"),
    },
    {
      id: "run",
      label: "6 実行",
      desc: "F5 デバッグ",
      status: stepStatus("run"),
    },
    {
      id: "save",
      label: "7 保存",
      desc: "Gitea 登録",
      status: stepStatus("save"),
    },
  ];

  const hints = {
    scaffold: "モック・作る・環境の各ステップで、必要なファイルだけ自動作成されます",
    develop: "「作る」タブで AI 用プロンプトから始めてください",
    deps: "AI にコードを追加してもらったら、次のボタンへ",
    venv: "Python を動かす準備をします",
    sync: "Python を動かす準備をします",
    run: "アプリが動くか試します",
    save: "クラウドに保存します（初回だけ名前を聞きます）",
    done: "保存できました！ アプリを使ってみましょう",
  };

  let currentForUi = cloud ? "done" : currentId;
  let nextStep = hints[currentForUi] || hints.scaffold;
  if (todoCount > 0 && ["save", "run", "sync", "done"].includes(currentForUi)) {
    nextStep = "確認が必要な所があります。「その他」またはポリシー警告を確認してください。";
  }

  const hasRemote = !!state?.saveBound;
  function primaryButtonFor(step) {
    if (step === "done") {
      return { label: "▶ アプリを使う", action: "openRunner", hint: hints.done };
    }
    switch (step) {
      case "scaffold":
        return { label: "次へ → モックを作る", action: "openMock", hint: hints.scaffold };
      case "develop":
      case "deps":
        return { label: "次へ → 作る（実装）", action: "openDev", hint: hints.develop };
      case "venv":
      case "sync":
        return { label: "次へ → 環境を用意する", action: "ensurePython", hint: hints.venv };
      case "run":
        return { label: "次へ → 動くか試す", action: "runApp", hint: hints.run };
      case "save":
        return {
          label: hasRemote ? "💾 保存する" : "💾 はじめて保存する",
          action: "save",
          hint: hints.save,
        };
      default:
        return { label: "次へ", action: "ensureScaffold", hint: hints.scaffold };
    }
  }

  return {
    steps,
    nextStep,
    currentStepId: currentForUi,
    primaryButton: primaryButtonFor(currentForUi),
    modeLabel: "Creator",
    devModes: "",
  };
}

function buildEnvFileChecklist(workspaceRoot) {
  const fs = require("fs");
  const path = require("path");
  const { resolveScaffoldRoot } = require("./scaffold");
  const { hasPyproject, pyprojectPath } = require("./projectPaths");
  const root = resolveScaffoldRoot(workspaceRoot);
  const pyRel = hasPyproject(workspaceRoot)
    ? path.relative(root, pyprojectPath(workspaceRoot)).replace(/\\/g, "/")
    : "pyproject.toml";
  const items = [
    {
      path: "nora/manifest.json",
      label: "nora/manifest.json",
      desc: "アプリ ID・表示名（必須）",
      required: true,
    },
    {
      path: pyRel,
      label: pyRel,
      desc: "使う Python ライブラリの一覧（ルート pyproject 優先）",
      required: true,
    },
    {
      path: "main.py",
      label: "main.py",
      desc: "アプリ本体（Creator の「作る」で作成）",
      required: false,
    },
    {
      path: "requirements.txt",
      label: "requirements.txt",
      desc: "既存アプリの依存一覧（import モード・任意）",
      required: false,
    },
    {
      path: "nora/mock/index.html",
      label: "nora/mock/index.html",
      desc: "画面モック（Creator の「モックを作る」）",
      required: false,
    },
    {
      path: "README.md",
      label: "README.md",
      desc: "アプリの説明（推奨）",
      required: false,
    },
  ];
  return items.map((it) => ({
    ...it,
    ok: fs.existsSync(path.join(root, it.path)),
  }));
}

async function fetchEnvDepsPrompt(displayName) {
  const folder = vscode.workspace.workspaceFolders?.[0];
  const { getNoraOpsConfig } = require("./config");
  const { requestJson } = require("./noraopsApi");
  const cfg = getNoraOpsConfig();
  const q = encodeURIComponent(displayName || "このアプリ");
  try {
    const { status, json } = await requestJson(
      "GET",
      `${cfg.serverBaseUrl}/api/v1/noraops/prompts/env-deps?display_name=${q}`
    );
    if (status === 200 && json?.prompt) return json.prompt;
  } catch {
    /* ignore */
  }
  if (folder) {
    try {
      const { buildEnvDepsPrompt } = require("./devPrompts");
      return buildEnvDepsPrompt(folder.uri.fsPath, displayName);
    } catch (e) {
      console.error("[NoraOps] buildEnvDepsPrompt:", e);
      return `# Python 環境プロンプトの生成に失敗しました\n\n${e.message}\n\n「更新」ボタンを押すか、雛形を入れ直してください。`;
    }
  }
  return null;
}

function buildState() {
  const folder = vscode.workspace.workspaceFolders?.[0];
  const summary = getLastCheckSummary();
  const sec = countSecErrors(summary);
  const pol = summary?.polErrors?.length || 0;
  const polWarns =
    summary?.findings?.filter((f) => f.category === "policy" && f.severity === "warn").length || 0;
  const { buildPolicyUiItems } = require("./policyFix");
  const policyItems = buildPolicyUiItems(summary);
  const secItems =
    summary?.findings
      ?.filter((f) => f.category === "security" && f.severity === "error")
      .map((f) => ({ message: f.message, file: f.file, line: f.line })) || [];

  if (folder) {
    const ws = folder.uri.fsPath;
    const session = readWorkspaceSession(ws);
    const py = getPythonEnvStatus(ws);
    const appRoot = workspaceAppRoot(ws);
    const venvDirRel =
      py.venvDir != null
        ? path.relative(appRoot, py.venvDir).replace(/\\/g, "/") || ".venv"
        : path.relative(appRoot, defaultWorkspaceVenvDir(ws)).replace(/\\/g, "/") || ".venv";
    let cloudHint = null;
    if (session?.lastPushOk === true) {
      cloudHint = { kind: "ok", text: "クラウド（Gitea）に反映済み" };
    } else if (session?.lastSave && !session?.lastPushOk) {
      cloudHint = {
        kind: "info",
        text: "この PC に保存済み。クラウドへ送るには下の「保存する」を押し、Gitea 送信を選んでください。",
      };
    } else if (!session?.lastSave) {
      cloudHint = {
        kind: "info",
        text: "まだ NoraOps で保存していません。編集後は下の「保存する」から始めてください。",
      };
    } else {
      cloudHint = {
        kind: "warn",
        text: "クラウド未送信の可能性があります。下の「保存する」で Gitea に送れます。",
      };
    }

    const { detectCreatorProgress } = require("./creatorProgress");
    const { getNoraOpsRepoMeta } = require("./repoMeta");
    const { buildWorkflowState } = require("./creatorWorkflow");
    const creatorProgress = detectCreatorProgress(ws);
    const flow = buildCreatorFlow({
      creatorProgress,
      cloudOk: session?.lastPushOk === true,
      saveBound: !!getNoraOpsRepoMeta(ws),
      secIssues: sec,
      polIssues: pol,
    });

    return {
      mode: "workspace",
      creatorWorkflow: buildWorkflowState(ws),
      creatorFlow: flow,
      creatorProgress,
      displayName: session?.displayName || path.basename(ws),
      workspacePath: ws,
      online: isLastOnline(),
      secIssues: sec,
      secItems,
      polIssues: pol,
      polWarns,
      policyItems,
      cloudHint,
      lastSave: session?.lastSave || null,
      cloudOk: session?.lastPushOk === true,
      pythonReady: py.ready,
      python: {
        ready: py.ready,
        exists: py.exists,
        hasPyproject: py.hasPyproject,
        stale: py.stale,
        pythonExe: py.exists ? py.pythonExe : null,
        venvDir: py.venvDir,
        venvName: py.venvName,
        sizeMb: py.sizeMb,
        setupDurationLabel: py.setupDurationLabel,
        venvCreateLabel: py.venvCreateLabel,
        syncLabel: py.syncLabel,
        packageCount: py.packageCount,
        pyprojectPath: creatorProgress.pyprojectPath || pyprojectRelPath(ws),
        venvDirRel,
        interpreterMatches: py.interpreterMatches,
        updatedAt: py.meta?.updatedAt || null,
      },
    };
  }

  return {
    mode: "welcome",
    recent: readRecentApps().slice(0, 5),
    online: isLastOnline(),
    welcomeFlows: {
      creator: {
        title: "アプリを作る（開発）",
        steps: "編集 → 環境 → 保存・公開 → Runner で試す",
        tip: "フォルダを開いてコードを書き、Gitea に保存します。",
      },
      runner: {
        title: "アプリを使う（利用）",
        steps: "選ぶ → 起動 → ストレージ管理",
        tip: "コードは書きません。承認済みアプリだけ起動します。",
      },
    },
  };
}

async function buildStateExtras(base, options = {}) {
  const state = { ...base };
  const includeCopilot = options.includeCopilot !== false;
  const includeThumbnail = options.includeThumbnail !== false;
  try {
    const { fetchToolsStatus } = require("./toolInstaller");
    const st = await fetchToolsStatus();
    state.tools = {
      ok: st.ok,
      online: st.online,
      error: st.error || null,
      uv: st.uv?.installed ? st.uv.version || "OK" : "未導入",
      git: st.git?.installed ? st.git.version || "OK" : "未導入",
      uvRequired: st.uv?.required,
      gitRequired: st.git?.required,
      updateNeeded: !!(st.uv?.updateNeeded || st.git?.updateNeeded),
    };
  } catch (e) {
    state.tools = { ok: false, online: false, error: e.message, uv: "?", git: "?" };
  }
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (folder && state.mode === "workspace") {
    const { readCreatorWorkflow, MODES } = require("./creatorWorkflow");
    const wfMode = readCreatorWorkflow(folder.uri.fsPath);
    try {
      const { getSaveContext } = require("./saveFlow");
      state.saveContext = await getSaveContext(folder.uri.fsPath);
    } catch (e) {
      const { getNoraOpsConfig } = require("./config");
      const { hasNoraOpsRepoBinding } = require("./repoSetup");
      const { readWorkspaceSession } = require("./pathsMeta");
      const cfg = getNoraOpsConfig();
      const session = readWorkspaceSession(folder.uri.fsPath);
      state.saveContext = {
        ready: true,
        error: e.message,
        options: [],
        serverBaseUrl: cfg.serverBaseUrl || null,
        giteaBaseUrl: cfg.giteaBaseUrl || null,
        serverConfigured: !!cfg.serverBaseUrl,
        giteaConfigured: !!(cfg.giteaBaseUrl && cfg.serverBaseUrl),
        serverOnline: false,
        hasRemote: hasNoraOpsRepoBinding(folder.uri.fsPath),
        giteaFullName: session?.giteaFullName || null,
      };
    }
    const { detectCreatorProgress } = require("./creatorProgress");
    const prog = detectCreatorProgress(folder.uri.fsPath);
    const session = readWorkspaceSession(folder.uri.fsPath);
    state.envScaffold = {
      hasDeps: prog.hasDeps,
      depCount: prog.depCount || 0,
      depNames: prog.depNames || [],
      pyprojectPath: prog.pyprojectPath || null,
      files: buildEnvFileChecklist(folder.uri.fsPath),
    };
    if (wfMode === MODES.IMPORT) {
      const { ensureImportPublishReady } = require("./importPublishReady");
      ensureImportPublishReady(folder.uri.fsPath);
    }
    const { buildImportWizardState } = require("./importWizard");
    state.importWizard = buildImportWizardState(folder.uri.fsPath);
    const { discoverRequirementsFiles, suggestRequirementsPath } = require("./importEnvAssist");
    const discoveredRequirements = discoverRequirementsFiles(folder.uri.fsPath);
    state.discoveredRequirements = discoveredRequirements;
    let importReq = session?.importRequirementsPath || null;
    if (wfMode === MODES.IMPORT && !importReq) {
      const suggested = suggestRequirementsPath(folder.uri.fsPath, discoveredRequirements);
      if (suggested) {
        importReq = suggested;
        writeWorkspaceSession(folder.uri.fsPath, { importRequirementsPath: suggested });
      }
    }
    state.importRequirementsPath = importReq;
    if (wfMode === MODES.IMPORT) {
      state.envDepsPrompt = "";
    } else {
      try {
        state.envDepsPrompt = await fetchEnvDepsPrompt(session?.displayName || path.basename(folder.uri.fsPath));
      } catch (e) {
        state.envDepsPrompt = `（プロンプト取得エラー: ${e.message}）`;
      }
    }
    if (includeThumbnail) {
      try {
        const { readThumbnailPreview } = require("./thumbnailAsset");
        state.thumbnailPreview = readThumbnailPreview(folder.uri.fsPath);
      } catch {
        /* ignore */
      }
    }
    if (includeCopilot) {
      try {
        const { buildCopilotPanelState, formatUsageForUi } = require("./copilotByokSetup");
        const panel = await buildCopilotPanelState(folder.uri.fsPath);
        state.copilotAi = {
          ...panel.brief,
          serverReachable: panel.serverReachable,
          serverEnabled: panel.serverEnabled,
          extensions: panel.extensions,
          configHints: panel.configHints,
          usageUi: panel.usageUi || formatUsageForUi(panel.usage, panel.repoUsage, panel.usageContext),
          usage: panel.usage,
          repoUsage: panel.repoUsage,
          usageContext: panel.usageContext,
        };
      } catch (e) {
        state.copilotAi = { serverEnabled: false, error: e.message };
      }
    }
  }
  return state;
}

async function buildStateWithTools(options = {}) {
  const base = buildState();
  return buildStateExtras(base, options);
}

async function postState(options = {}) {
  if (!homePanel) return;
  const folder = vscode.workspace.workspaceFolders?.[0];
  const force = options.force === true;
  if (!force) {
    const cached = homeStateCache.get();
    if (cached) {
      if (cached.mode === "workspace" && folder) {
        attachMockUiState(cached, folder.uri.fsPath);
      }
      homePanel.webview.postMessage({ type: "state", ...cached });
      return;
    }
  }
  const gen = ++homeRefreshGen;
  const base = buildState();
  if (base.mode === "workspace" && folder) {
    attachMockUiState(base, folder.uri.fsPath);
  }
  homePanel.webview.postMessage({ type: "state", ...base });
  try {
    const full = await buildStateExtras(base, {
      includeCopilot: options.includeCopilot,
      includeThumbnail: options.includeThumbnail,
    });
    if (gen !== homeRefreshGen) return;
    if (full.mode === "workspace" && folder) {
      attachMockUiState(full, folder.uri.fsPath);
    }
    homeStateCache.set(full);
    homePanel.webview.postMessage({ type: "state", ...full });
  } catch {
    /* 同期 state のみ表示 */
  }
}

async function handleHomeMessage(context, msg, webview) {
    if (msg.type === "refresh") postState({ force: true });
    if (msg.type === "setCreatorWorkflow" && msg.mode) {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) return;
      const { writeCreatorWorkflow, defaultViewForMode } = require("./creatorWorkflow");
      const mode = writeCreatorWorkflow(folder.uri.fsPath, msg.mode);
      webview.postMessage({ type: "creatorWorkflowChanged", mode, view: defaultViewForMode(mode) });
      await postState({ force: true });
    }
    if (msg.type === "runCopilotCheck") {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) {
        vscode.window.showWarningMessage("フォルダを開いてから実行してください。");
        return;
      }
      const { runCopilotReadinessWithUi } = require("./copilotByokCheck");
      await runCopilotReadinessWithUi(context, folder.uri.fsPath);
      await postState();
    }
    if (msg.type === "installCopilot") {
      const { installCopilotExtensions } = require("./copilotByokSetup");
      await installCopilotExtensions();
      await postState();
    }
    if (msg.type === "applyByok") {
      const { applyByokSettingsFromServer } = require("./copilotByokSetup");
      await applyByokSettingsFromServer();
      await postState();
    }
    if (msg.type === "openAiUsage") {
      const { openAiUsageInBrowser } = require("./copilotByokSetup");
      await openAiUsageInBrowser();
    }
    if (msg.type === "runConcierge") {
      webview.postMessage({ type: "openConciergeModal" });
    }
    if (msg.type === "openMockModal") {
      webview.postMessage({ type: "navigateCreatorView", view: "mock" });
    }
    if (msg.type === "mockGeneratePrompt") {
      const folder = requireWorkspaceFolder();
      if (!folder) return;
      const appTitle = String(msg.appTitle || "").trim();
      const operationSteps = String(msg.operationSteps || "").trim();
      const targetPlatform = String(msg.targetPlatform || "browser").trim();
      if (!appTitle) {
        webview.postMessage({ type: "mockError", message: "アプリタイトルを入力してください。", field: "title" });
        return;
      }
      if (operationSteps.length < 1) {
        webview.postMessage({
          type: "mockError",
          message: "アプリの要件定義（操作手順）を 1 文字以上で入力してください。",
          field: "steps",
        });
        return;
      }
      try {
        const { buildMockPrompt, writeMockSpec, normalizeTargetPlatform } = require("./mockPrompts");
        const { ensureMockScaffold } = require("./scaffold");
        ensureMockScaffold(folder.uri.fsPath);
        writeMockSpec(folder.uri.fsPath, { appTitle, operationSteps, targetPlatform });
        const prompt = buildMockPrompt({
          appTitle,
          operationSteps,
          targetPlatform: normalizeTargetPlatform(targetPlatform),
        });
        await vscode.env.clipboard.writeText(prompt);
        const { buildMockPreviewPayload } = require("./mockPrompts");
        webview.postMessage({
          type: "mockPromptReady",
          prompt,
          copied: true,
          appTitle,
          operationSteps,
          preview: buildMockPreviewPayload(folder.uri.fsPath),
        });
        vscode.window.showInformationMessage(
          "プロンプトをコピーしました。② AI チャットに貼り付けてください。"
        );
        setTimeout(() => postState({ force: true }).catch(() => {}), 500);
      } catch (e) {
        webview.postMessage({ type: "mockError", message: e.message });
      }
    }
    if (msg.type === "openAiChatTool") {
      const { openAiChatToolBeside, saveAiChatUrl, getAiChatUrl } = require("./aiChatTool");
      const draft = String(msg.url || "").trim();
      if (draft && draft !== getAiChatUrl()) {
        try {
          await saveAiChatUrl(draft);
        } catch (e) {
          webview.postMessage({ type: "mockError", message: e.message });
          return;
        }
      }
      const r = await openAiChatToolBeside({ context, revealSetup: true });
      if (r.ok) {
        webview.postMessage({ type: "aiChatToolOpened" });
      }
    }
    if (msg.type === "focusAiChatSetting") {
      const { focusAiChatSettingInSetup } = require("./aiChatTool");
      await focusAiChatSettingInSetup(context);
    }
    if (msg.type === "mockRefreshPreview") {
      const folder = requireWorkspaceFolder();
      if (!folder) return;
      pushMockPreviewToWebview(webview, folder.uri.fsPath);
      await postState({ force: true });
    }
    if (msg.type === "mockOpenIndex") {
      const folder = requireWorkspaceFolder();
      if (!folder) return;
      const { noraJoin } = require("./scaffold");
      const indexPath = noraJoin(folder.uri.fsPath, "mock", "index.html");
      if (!fs.existsSync(indexPath)) {
        const { ensureMockScaffold } = require("./scaffold");
        ensureMockScaffold(folder.uri.fsPath);
      }
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(indexPath));
      await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside });
      webview.postMessage({ type: "mockIndexOpened" });
    }
    if (msg.type === "devGeneratePrompt") {
      const folder = requireWorkspaceFolder();
      if (!folder) return;
      try {
        const { ensureDevScaffold } = require("./scaffold");
        const { buildDevImplementPrompt, resolveImplementationStack } = require("./devPrompts");
        const { readMockSpec } = require("./mockPrompts");
        const { ensureLaunchConfig } = require("./launchConfig");
        ensureDevScaffold(folder.uri.fsPath, {
          displayName: readWorkspaceSession(folder.uri.fsPath)?.displayName,
        });
        const { ensurePackagesScaffold } = require("./scaffold");
        ensurePackagesScaffold(folder.uri.fsPath);
        const spec = readMockSpec(folder.uri.fsPath) || {};
        const prompt = buildDevImplementPrompt(folder.uri.fsPath);
        const stack = resolveImplementationStack(spec);
        webview.postMessage({ type: "devPromptReady", prompt, stack });
        ensureLaunchConfig(folder.uri.fsPath);
        setTimeout(() => postState({ force: true }).catch(() => {}), 400);
      } catch (e) {
        webview.postMessage({ type: "devError", message: e.message });
      }
    }
    if (msg.type === "copyDevPrompt" && msg.prompt) {
      await vscode.env.clipboard.writeText(String(msg.prompt));
      vscode.window.showInformationMessage(
        "実装用プロンプトをコピーしました。生成 AI チャットに貼り付けてください。"
      );
      webview.postMessage({ type: "devPromptCopied" });
    }
    if (msg.type === "openDevMain") {
      const folder = requireWorkspaceFolder();
      if (!folder) return;
      const { ensureDevScaffold } = require("./scaffold");
      const { devMainPath } = require("./devPrompts");
      ensureDevScaffold(folder.uri.fsPath);
      const mainPath = devMainPath(folder.uri.fsPath);
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(mainPath));
      await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside });
      webview.postMessage({ type: "devMainOpened" });
    }
    if (msg.type === "openPyproject") {
      const folder = requireWorkspaceFolder();
      if (!folder) return;
      const { ensurePyprojectScaffold } = require("./scaffold");
      const { pyprojectPath } = require("./projectPaths");
      ensurePyprojectScaffold(folder.uri.fsPath);
      const pyPath = pyprojectPath(folder.uri.fsPath);
      if (!fs.existsSync(pyPath)) {
        vscode.window.showWarningMessage("pyproject.toml がありません。環境タブで雛形を作成してください。");
        return;
      }
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(pyPath));
      await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside });
      webview.postMessage({ type: "pyprojectOpened" });
    }
    if (msg.type === "openReadme") {
      const folder = requireWorkspaceFolder();
      if (!folder) return;
      const { resolveScaffoldRoot } = require("./scaffold");
      const wsSession = readWorkspaceSession(folder.uri.fsPath);
      const readmePath = path.join(resolveScaffoldRoot(folder.uri.fsPath), "README.md");
      if (!fs.existsSync(readmePath)) {
        fs.writeFileSync(
          readmePath,
          `# ${wsSession?.displayName || path.basename(folder.uri.fsPath)}\n\n## 概要\n\n（アプリの説明を書いてください）\n`,
          "utf8"
        );
      }
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(readmePath));
      await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside });
      await postState({ force: true });
    }
    if (msg.type === "launchDevApp") {
      const folder = requireWorkspaceFolder();
      if (!folder) return;
      const ws = folder.uri.fsPath;
      const { devMainPath } = require("./devPrompts");
      const mainPath = devMainPath(ws);
      const { ensureDevScaffold, ensurePackagesScaffold } = require("./scaffold");
      const { ensureLaunchConfig } = require("./launchConfig");
      const { getPythonEnvStatus } = require("./pythonEnv");
      ensureDevScaffold(ws);
      ensurePackagesScaffold(ws);
      if (!fs.existsSync(mainPath)) {
        vscode.window.showWarningMessage(
          "main.py がありません。「作る」タブで AI のコードを貼り付けてください。"
        );
        webview.postMessage({ type: "navigateCreatorView", view: "dev" });
        return;
      }
      const py = getPythonEnvStatus(ws);
      if (!py.ready) {
        const pick = await vscode.window.showWarningMessage(
          "Python 環境（venv）がまだ用意されていません。先に「用意する」を実行しますか？",
          "用意する",
          "このまま起動"
        );
        if (pick === "用意する") {
          await vscode.commands.executeCommand("noraops.ensurePythonEnv");
        }
      }
      ensureLaunchConfig(ws);
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(mainPath));
      await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.One });
      const NORAOPS_LAUNCH = "NoraOps: アプリを実行 (F5)";
      let started = await vscode.debug.startDebugging(folder, NORAOPS_LAUNCH);
      if (!started) {
        started = await vscode.commands.executeCommand("workbench.action.debug.start");
      }
      if (started) {
        vscode.window.showInformationMessage(
          "main.py をデバッグ起動しました。ターミナルで出力を確認できます。"
        );
      } else {
        vscode.window.showWarningMessage(
          "デバッグの開始に失敗しました。実行とデバッグから「" + NORAOPS_LAUNCH + "」を選んで F5 を押してください。"
        );
      }
      await postState({ force: true });
    }
    if (msg.type === "copyMockEditTip" && msg.text) {
      await vscode.env.clipboard.writeText(String(msg.text));
      vscode.window.showInformationMessage(
        "編集用チップをコピーしました。index.html 全文の末尾に貼り付けてください。"
      );
    }
    if (msg.type === "refreshEnvDepsPrompt") {
      const folder = requireWorkspaceFolder();
      if (!folder) return;
      const { readCreatorWorkflow, MODES } = require("./creatorWorkflow");
      if (readCreatorWorkflow(folder.uri.fsPath) === MODES.IMPORT) {
        vscode.window.showInformationMessage(
          "公開モードでは requirements.txt を指定して「プロンプトを作成」を使ってください。"
        );
        return;
      }
      const session = readWorkspaceSession(folder.uri.fsPath);
      try {
        const { buildEnvDepsPrompt } = require("./devPrompts");
        const prompt = buildEnvDepsPrompt(
          folder.uri.fsPath,
          session?.displayName || path.basename(folder.uri.fsPath)
        );
        webview.postMessage({ type: "envDepsPromptReady", prompt });
      } catch (e) {
        webview.postMessage({ type: "envDepsPromptReady", prompt: `（生成エラー: ${e.message}）` });
      }
    }
    if (msg.type === "pickImportRequirements") {
      const folder = requireWorkspaceFolder();
      if (!folder) return;
      const { resolveScaffoldRoot } = require("./scaffold");
      const { writeWorkspaceSession } = require("./pathsMeta");
      const root = resolveScaffoldRoot(folder.uri.fsPath);
      const uris = await vscode.window.showOpenDialog({
        canSelectMany: false,
        canSelectFiles: true,
        canSelectFolders: false,
        filters: { "Requirements": ["txt"] },
        defaultUri: vscode.Uri.file(root),
        openLabel: "選択",
        title: "requirements.txt を選択",
      });
      if (!uris?.length) return;
      const picked = uris[0].fsPath;
      const rel = path.relative(root, picked).replace(/\\/g, "/");
      if (rel.startsWith("..") || path.isAbsolute(rel)) {
        vscode.window.showWarningMessage("ワークスペース内の requirements.txt を選んでください。");
        return;
      }
      writeWorkspaceSession(folder.uri.fsPath, { importRequirementsPath: rel });
      webview.postMessage({ type: "importRequirementsPicked", path: rel });
      await postState({ force: true });
    }
    if (msg.type === "generateImportEnvPrompt") {
      const folder = requireWorkspaceFolder();
      if (!folder) return;
      const session = readWorkspaceSession(folder.uri.fsPath);
      const reqPath = msg.path || session?.importRequirementsPath;
      if (!reqPath) {
        vscode.window.showWarningMessage(
          "requirements.txt を指定してください。ワークスペース内にあれば「ファイルを指定」、なければ「Python から取得」を使えます。"
        );
        return;
      }
      try {
        const { buildRequirementsToPyprojectPrompt } = require("./devPrompts");
        const prompt = buildRequirementsToPyprojectPrompt(
          folder.uri.fsPath,
          reqPath,
          session?.displayName || path.basename(folder.uri.fsPath)
        );
        webview.postMessage({ type: "envDepsPromptReady", prompt });
      } catch (e) {
        vscode.window.showWarningMessage(e.message);
        webview.postMessage({ type: "envDepsPromptReady", prompt: "", error: e.message });
      }
    }
    if (msg.type === "captureImportRequirementsFromPython") {
      const folder = requireWorkspaceFolder();
      if (!folder) return;
      const { pickPythonExecutable, captureRequirementsFromPython } = require("./importEnvAssist");
      try {
        const pythonExe = await pickPythonExecutable();
        if (!pythonExe) return;
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "NoraOps: 依存一覧を取得中（pip freeze）",
            cancellable: false,
          },
          async () => {
            const { relPath, lineCount } = await captureRequirementsFromPython(
              folder.uri.fsPath,
              pythonExe
            );
            writeWorkspaceSession(folder.uri.fsPath, { importRequirementsPath: relPath });
            webview.postMessage({ type: "importRequirementsPicked", path: relPath });
            vscode.window.showInformationMessage(
              `requirements.txt を取得しました（${lineCount} 件）: ${relPath}`
            );
            await postState({ force: true });
          }
        );
      } catch (e) {
        vscode.window.showWarningMessage(e.message || String(e));
      }
    }
    if (msg.type === "getSaveInventory") {
      const folder = requireWorkspaceFolder();
      if (!folder) return;
      try {
        const { buildSaveInventory } = require("./saveInventory");
        webview.postMessage({
          type: "saveInventoryReady",
          inventory: buildSaveInventory(folder.uri.fsPath),
        });
      } catch (e) {
        webview.postMessage({ type: "saveInventoryReady", error: e.message });
      }
    }
    if (msg.type === "copyMockPrompt" && msg.prompt) {
      await vscode.env.clipboard.writeText(msg.prompt);
      vscode.window.showInformationMessage(
        "プロンプトをコピーしました。AI チャットに貼り付け → 返ってきた HTML を index.html に丸ごと貼り付けて保存してください。"
      );
    }
    if (msg.type === "conciergeAnalyze") {
      try {
        const { analyzeConcierge } = require("./concierge");
        const result = await analyzeConcierge(
          msg.problem || "",
          msg.inputDesc || "",
          msg.outputDesc || ""
        );
        webview.postMessage({ type: "conciergeResult", result });
      } catch (e) {
        webview.postMessage({ type: "conciergeError", message: e.message });
      }
    }
    if (msg.type === "openReleaseModal") {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) {
        vscode.window.showWarningMessage("フォルダを開いてから実行してください。");
        return;
      }
      const { refreshRules, getActiveRulesBundle, isLastOnline } = require("./savePipeline");
      const { runChecks } = require("./checkRunner");
      const { validateReleaseReadiness } = require("./releaseValidation");
      await refreshRules();
      const summary = runChecks(folder.uri.fsPath, getActiveRulesBundle(), isLastOnline());
      const v = validateReleaseReadiness(folder.uri.fsPath, summary);
      webview.postMessage({
        type: "releaseChecklist",
        checklist: v.checklist,
        ok: v.ok,
        errors: v.errors,
      });
      if (!v.ok) {
        vscode.window.showWarningMessage(
          "公開リリースの前提を満たしていません:\n" + v.errors.join("\n")
        );
      }
    }
    if (msg.type === "cloneFromPublished") {
      try {
        const { searchPublishedApps } = require("./runner/catalogClient");
        const { openPublishedAppForEdit } = require("./openAppForEdit");
        const items = await searchPublishedApps("");
        if (!items.length) {
          vscode.window.showWarningMessage("公開アプリが見つかりません（nora-published topic）。");
          return;
        }
        const pick = await vscode.window.showQuickPick(
          items.map((it) => ({
            label: it.full_name || `${it.owner}/${it.name}`,
            description: it.description || "",
            owner: it.owner,
            name: it.name,
          })),
          { title: "公開アプリから取得", placeHolder: "ベースにするアプリを選んでください" }
        );
        if (!pick) return;
        await openPublishedAppForEdit(pick.owner, pick.name);
        vscode.window.showInformationMessage(
          "取得したフォルダで開発できます。編集権がない場合は「新規リポジトリを作成」で別名保存してください。"
        );
      } catch (e) {
        vscode.window.showErrorMessage(`公開アプリの取得: ${e.message}`);
      }
    }
    if (msg.type === "copyConciergePrompt" && msg.prompt) {
      await vscode.env.clipboard.writeText(msg.prompt);
      vscode.window.showInformationMessage("Copilot 用プロンプトをコピーしました。Agent モードのチャットに貼り付けてください。");
    }
    if (msg.type === "showConciergePrompt" && msg.prompt) {
      const pick = await vscode.window.showInformationMessage(
        "このプロンプトを Copilot Agent に貼り付けて実装を開始してください。",
        { modal: true, detail: String(msg.prompt || "").slice(0, 12000) },
        "コピー",
        "閉じる"
      );
      if (pick === "コピー") {
        await vscode.env.clipboard.writeText(msg.prompt);
        vscode.window.showInformationMessage("コンシェルジュプロンプトをコピーしました。");
      }
    }
    if (msg.type === "runCopilotSetup") {
      const folder = vscode.workspace.workspaceFolders?.[0];
      const { runFullByokSetup } = require("./copilotByokSetup");
      await runFullByokSetup(context, folder?.uri.fsPath, { runReadiness: !!folder });
      await postState();
    }
    if (msg.type === "openCopilotByokDoc") {
      const candidates = [
        path.join(context.extensionPath, "..", "NoraOps", "Copilot-BYOK連携.md"),
      ];
      const docPath = candidates.find((p) => fs.existsSync(p));
      if (docPath) {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(docPath));
        await vscode.window.showTextDocument(doc, { preview: true });
      } else {
        const { openCopilotSettings } = require("./copilotByokCheck");
        await openCopilotSettings();
      }
    }
    if (msg.type === "runHealthCheck") {
      const { runHealthCheckWithUi } = require("./healthCheckUi");
      await runHealthCheckWithUi(homePanel);
    }
    if (msg.type === "openHealthServerPage") {
      const { openServerDiagnosticsPage } = require("./healthCheckUi");
      await openServerDiagnosticsPage();
    }
    if (msg.type === "releaseExecute") {
      const { getNoraOpsConfig } = require("./config");
      const { testServerConnection } = require("./setupConnection");
      const cfg = getNoraOpsConfig();
      const conn = await testServerConnection(cfg.serverBaseUrl);
      if (!conn.ok) {
        webview.postMessage({
          type: "showAiNotice",
          kind: "warn",
          title: "接続を確認できません",
          body:
            `接続先: ${conn.baseUrl || cfg.serverBaseUrl || "未設定"}\n` +
            (conn.error || "サーバーに接続できません。") +
            "\n\n公開リリースの前に、設定（サーバー接続）とネットワークを確認してください。",
        });
        return;
      }
      await vscode.commands.executeCommand("noraops.saveExecute", {
        action: "release",
        publishVersion: msg.publishVersion || "",
      });
    }
    if (msg.type === "saveExecute" && msg.action) {
      await vscode.commands.executeCommand("noraops.saveExecute", {
        action: msg.action,
        forceNewRepo: msg.forceNewRepo === true,
        newAppIdentity: msg.newAppIdentity === true,
        publishRunner: msg.publishRunner === true,
        publishVersion: msg.publishVersion || "",
      });
    }
    if (msg.type === "checkBindingStatus") {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder || !homePanel) return;
      const { readCreatorWorkflow, MODES } = require("./creatorWorkflow");
      const { analyzeAppBinding, reconcileBindingIdentity } = require("./appBinding");
      const { ensureImportPublishReady } = require("./importPublishReady");
      if (readCreatorWorkflow(folder.uri.fsPath) === MODES.IMPORT) {
        ensureImportPublishReady(folder.uri.fsPath);
      }
      await reconcileBindingIdentity(folder.uri.fsPath);
      const result = await analyzeAppBinding(folder.uri.fsPath);
      webview.postMessage({ type: "bindingStatus", result });
      if (result.ok) await postState({ force: true });
    }
    if (msg.type === "syncAppIdBinding") {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) return;
      const { syncSessionAppIdFromManifest, analyzeAppBinding } = require("./appBinding");
      const r = syncSessionAppIdFromManifest(folder.uri.fsPath);
      const result = await analyzeAppBinding(folder.uri.fsPath);
      webview.postMessage({ type: "bindingStatus", result });
      webview.postMessage({
        type: "showAiNotice",
        kind: r.ok ? "ok" : "warn",
        title: r.ok ? "記録を合わせました" : "修正できませんでした",
        body: r.ok
          ? `公開設定の ID に PC 記録を更新しました。`
          : "公開設定がまだありません。保存タブで「はじめて保存」を実行してください。",
      });
      await postState();
    }
    if (msg.type === "switchRepoBinding") {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) return;
      const { switchSessionToRegistryRepo, analyzeAppBinding } = require("./appBinding");
      const r = switchSessionToRegistryRepo(folder.uri.fsPath, msg.registry);
      const result = await analyzeAppBinding(folder.uri.fsPath);
      webview.postMessage({ type: "bindingStatus", result });
      webview.postMessage({
        type: "showAiNotice",
        kind: r.ok ? "ok" : "warn",
        title: r.ok ? "保存先を切り替えました" : "切り替えできませんでした",
        body: r.ok
          ? `保存先を ${r.fullName} に更新しました。`
          : "サーバー登録情報が見つかりません。",
      });
      await postState();
    }
    if (msg.type === "createNewRepoBinding") {
      const pick = await vscode.window.showInformationMessage(
        "新しい Gitea リポジトリを作成します",
        {
          modal: true,
          detail:
            "同じ appId で別リポ: manifest の appId はそのまま、新しいリポジトリ名で保存\n\n" +
            "新 appId で別アプリ: 新しい appId を割り当て、別アプリとして登録",
        },
        "同じ appId で別リポ",
        "新 appId で別アプリ"
      );
      if (!pick) return;
      await vscode.commands.executeCommand("noraops.saveExecute", {
        action: "new-repo",
        forceNewRepo: true,
        newAppIdentity: pick === "新 appId で別アプリ",
      });
    }
    if (msg.type === "primaryAction") {
      switch (msg.action) {
        case "ensureScaffold":
          await runEnsureScaffoldInHome();
          return;
        case "openMock":
          webview.postMessage({ type: "navigateCreatorView", view: "mock" });
          return;
        case "openDev":
          webview.postMessage({ type: "navigateCreatorView", view: "dev" });
          return;
        case "openConcierge":
          if (!requireWorkspaceFolder()) return;
          webview.postMessage({ type: "navigateCreatorView", view: "dev" });
          webview.postMessage({ type: "openConciergeModal" });
          return;
        case "ensurePython":
          webview.postMessage({ type: "navigateCreatorView", view: "env" });
          await vscode.commands.executeCommand("noraops.ensurePythonEnv");
          return;
        case "runApp":
          if (!requireWorkspaceFolder()) return;
          await vscode.commands.executeCommand("workbench.action.debug.start");
          await postState();
          return;
        case "openRunner":
          await vscode.commands.executeCommand("noraops.openRunner");
          return;
        default:
          return;
      }
    }
    if (msg.type === "openHistory") await vscode.commands.executeCommand("noraops.openHistory");
    if (msg.type === "restoreSaveSnapshot" && msg.snapshotId) {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) {
        vscode.window.showWarningMessage("フォルダを開いてから実行してください。");
        return;
      }
      const ws = folder.uri.fsPath;
      const { listSaveSnapshots, restoreSaveSnapshot } = require("./saveHistory");
      const snap = listSaveSnapshots(ws).find((s) => s.id === msg.snapshotId);
      const label = snap?.label || msg.snapshotId;
      const ok = await vscode.window.showWarningMessage(
        `「${label}」の内容にこの PC のフォルダを戻します。\n\n` +
          `⚠ 戻すと、いまの編集内容は失われ、戻す前の状態には二度と戻れません。よろしいですか？\n\n` +
          `（クラウド上の最新コピーは変わりません）`,
        { modal: true },
        "戻す",
        "キャンセル"
      );
      if (ok !== "戻す") return;
      const result = restoreSaveSnapshot(ws, msg.snapshotId);
      if (!result.ok) {
        vscode.window.showErrorMessage(
          `切り戻しに失敗しました: ${result.reason || result.errors?.[0]?.message || "不明"}`
        );
        webview.postMessage({ type: "saveSnapshotRestored", ok: false, result });
        return;
      }
      await vscode.commands.executeCommand("workbench.files.action.refreshFilesExplorer");
      const { runWorkspaceChecks } = require("./savePipeline");
      await runWorkspaceChecks(ws);
      await postState();
      vscode.window.showInformationMessage(
        `切り戻しました: ${result.restored.length} ファイル復元` +
          (result.deleted.length ? ` · ${result.deleted.length} 件削除` : "")
      );
      webview.postMessage({ type: "saveSnapshotRestored", ok: true, result });
    }
    if (msg.type === "navigate" && msg.target) {
      /* shell が処理 */
      return;
    }
    if (msg.type === "openSetup") await vscode.commands.executeCommand("noraops.openSetup");
    if (msg.type === "ensurePython") {
      const folder = requireWorkspaceFolder();
      if (folder) {
        const { ensurePackagesScaffold } = require("./scaffold");
        try {
          ensurePackagesScaffold(folder.uri.fsPath);
        } catch {
          /* ignore */
        }
      }
      await vscode.commands.executeCommand("noraops.ensurePythonEnv");
    }
    if (msg.type === "pythonOpenLog") {
      const { showPythonOutputChannel } = require("./pythonEnv");
      showPythonOutputChannel();
    }
    if (msg.type === "pythonListPackages") {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) {
        vscode.window.showWarningMessage("フォルダを開いてから実行してください。");
        return;
      }
      if (homePanel) {
        webview.postMessage({ type: "pythonPackages", loading: true });
      }
      const { listPythonPackages } = require("./pythonEnv");
      const result = await listPythonPackages(folder.uri.fsPath);
      if (homePanel) {
        webview.postMessage({ type: "pythonPackages", ...result });
      }
    }
    if (msg.type === "pythonCopyPath") {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (folder) {
        const { copyPythonPath } = require("./pythonEnv");
        await copyPythonPath(folder.uri.fsPath);
      }
    }
    if (msg.type === "pythonSetInterpreter") {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (folder) {
        const { getPythonEnvStatus, setWorkspaceInterpreter } = require("./pythonEnv");
        const st = getPythonEnvStatus(folder.uri.fsPath);
        if (!st.pythonExe) {
          vscode.window.showWarningMessage("先に Python 環境を用意してください。");
          return;
        }
        await setWorkspaceInterpreter(folder.uri.fsPath, st.pythonExe, { usePythonCommand: true });
        vscode.window.showInformationMessage(
          "インタプリタを設定しました。まだ VS Code 右下が変わらない場合は、ウィンドウを再読み込みしてください。"
        );
        await postState();
      }
    }
    if (msg.type === "policyFixAuto") {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (folder) {
        const { applyAutoFixes } = require("./policyFix");
        const { buildPolicyUiItems } = require("./policyFix");
        const { getLastCheckSummary } = require("./savePipeline");
        const items = buildPolicyUiItems(getLastCheckSummary());
        const result = await applyAutoFixes(folder.uri.fsPath, items);
        if (result.fixed?.length) {
          vscode.window.showInformationMessage(`追加・修正しました: ${result.fixed.join(", ")}`);
        } else {
          vscode.window.showInformationMessage("自動修正を試みました。表示を確認してください。");
        }
        await postState();
      }
    }
    if (msg.type === "policyShowDetail") {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (folder) {
        const { showPolicyDetails, buildPolicyUiItems } = require("./policyFix");
        const { getLastCheckSummary } = require("./savePipeline");
        await showPolicyDetails(folder.uri.fsPath, buildPolicyUiItems(getLastCheckSummary()));
        await postState();
      }
    }
    if (msg.type === "policyAction" && msg.action === "checkLayout") {
      await vscode.commands.executeCommand("noraops.checkLayout");
      await postState();
    }
    if (msg.type === "pythonRecreate") {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (folder) {
        postPythonProgress({ message: "作り直し中…" });
        const { recreatePythonEnvWithUi } = require("./pythonEnv");
        try {
          await recreatePythonEnvWithUi(folder.uri.fsPath, { postPythonProgress });
        } finally {
          postPythonNotice(null);
          await postState();
        }
      }
    }
    if (msg.type === "pythonRemove") {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (folder) {
        postPythonProgress({ message: "削除中…" });
        const { removePythonEnvWithConfirm } = require("./pythonEnv");
        const result = await removePythonEnvWithConfirm(folder.uri.fsPath);
        if (result.ok) postPythonNotice({ kind: "deleted", message: result.notice || "削除しました" });
        else postPythonNotice(null);
        await postState();
      }
    }
    if (msg.type === "openFolder") {
      const uris = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false });
      if (uris?.[0]) {
        await vscode.commands.executeCommand("vscode.openFolder", uris[0], false);
      }
    }
    if (msg.type === "continueApp" && msg.workspacePath) {
      await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(msg.workspacePath), false);
    }
    if (msg.type === "openRunner") {
      await vscode.commands.executeCommand("noraops.openRunner");
    }
    if (msg.type === "openStorage") {
      const { createStoragePanel } = require("./storagePanel");
      createStoragePanel(context);
    }
    if (msg.type === "ensureScaffold") {
      await runEnsureScaffoldInHome();
    }
    if (msg.type === "confirmWorkspaceFolder") {
      const folder = requireWorkspaceFolder();
      if (!folder) return;
      if (msg.accept === true) {
        try {
          await runEnsureScaffoldInHome({ silent: true });
          webview.postMessage({ type: "workspaceFolderConfirmed", ok: true });
        } catch (e) {
          webview.postMessage({ type: "workspaceFolderConfirmed", ok: false, message: e.message });
        }
      } else {
        webview.postMessage({ type: "workspaceFolderConfirmed", ok: false, declined: true });
      }
      return;
    }
    if (msg.type === "removeWorkspaceScaffold") {
      const folder = requireWorkspaceFolder();
      if (!folder) return;
      const { removeWorkspaceScaffold, SCAFFOLD_REL_PATHS } = require("./scaffold");
      const existing = SCAFFOLD_REL_PATHS.filter((rel) =>
        fs.existsSync(path.join(folder.uri.fsPath, rel))
      );
      if (!existing.length) {
        vscode.window.showInformationMessage("削除対象の雛形ファイルは見つかりませんでした。");
        return;
      }
      const pick = await vscode.window.showWarningMessage(
        "NoraOps 雛形ファイルを削除しますか？",
        {
          modal: true,
          detail:
            "次のファイルを削除します（ユーザーが編集した内容も失われます）:\n\n" +
            existing.map((r) => "· " + r).join("\n"),
        },
        "削除する"
      );
      if (pick !== "削除する") return;
      const result = removeWorkspaceScaffold(folder.uri.fsPath);
      vscode.window.showInformationMessage(
        result.removed.length
          ? `雛形を削除しました: ${result.removed.join(", ")}`
          : "削除できたファイルはありませんでした。"
      );
      await postState({ force: true });
      pushMockPreviewToWebview(webview, folder.uri.fsPath);
    }
    if (msg.type === "openLaunchEntryModal") {
      const folder = requireWorkspaceFolder();
      if (!folder) return;
      const { buildLaunchEntryCatalog } = require("./entryPicker");
      webview.postMessage({
        type: "launchEntryCatalog",
        catalog: buildLaunchEntryCatalog(folder.uri.fsPath),
      });
    }
    if (msg.type === "setLaunchEntry" && msg.choice) {
      const folder = requireWorkspaceFolder();
      if (!folder) return;
      const { writeManifestEntry } = require("./entryPicker");
      writeManifestEntry(folder.uri.fsPath, msg.choice);
      const launchLabel =
        msg.choice.kind === "module" ? `python -m ${msg.choice.module}` : msg.choice.rel;
      webview.postMessage({ type: "launchEntryUpdated", launchEntry: launchLabel });
      vscode.window.showInformationMessage(`起動: ${launchLabel}`);
      homeStateCache.clear();
      await postState({ force: true });
    }
    if (msg.type === "runConciergeMatch" && msg.fullName) {
      const parts = String(msg.fullName).split("/", 2);
      if (parts.length < 2) return;
      const [owner, name] = parts;
      try {
        await vscode.commands.executeCommand("noraops.openRunner");
        const { runPublishedApp } = require("./runner/appRunner");
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: "NoraOps: 起動", cancellable: false },
          async (progress) => runPublishedApp({ owner, name, full_name: msg.fullName }, (p) => progress.report(p))
        );
        vscode.window.showInformationMessage(`${msg.fullName} を起動しました。`);
      } catch (e) {
        vscode.window.showErrorMessage(`起動に失敗: ${e.message}`);
      }
    }
    if (msg.type === "startAiAssist") {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (msg.prompt) {
        await vscode.env.clipboard.writeText(String(msg.prompt));
      }
      const { runAiAssistSetup } = require("./aiAssist");
      const r = await runAiAssistSetup(context, folder?.uri.fsPath, {
        skipUpgradePrompt: false,
        allowPersonalCopilot: msg.allowPersonalCopilot === true,
      });
      if (r.modal) {
        webview.postMessage({ type: "showAiNotice", ...r.modal });
      } else if (r.ok) {
        if (r.notice) {
          webview.postMessage({ type: "showAiNotice", ...r.notice });
        } else if (msg.prompt) {
          webview.postMessage({
            type: "showAiNotice",
            kind: "ok",
            title: "AI チャットを開きました",
            body: "AI チャットを開きました。\n\nクリップボードにプロンプトをコピー済みです。チャットに貼り付けて開発を始めてください。",
            offerHelp: true,
          });
        }
      }
      await postState();
    }
    if (msg.type === "openAiSetupHelp") {
      const { openAiSetupHelp } = require("./aiSetupGuide");
      await openAiSetupHelp();
    }
    if (msg.type === "copyEnvDepsPrompt") {
      if (msg.prompt) {
        await vscode.env.clipboard.writeText(String(msg.prompt));
        if (homePanel) {
          webview.postMessage({
            type: "showAiNotice",
            kind: "ok",
            title: "コピーしました",
            body: "環境セットアップ用プロンプトをコピーしました。AI チャットに貼り付けてください。",
          });
        }
      }
    }
    if (msg.type === "checkServerConnection") {
      const { getNoraOpsConfig } = require("./config");
      const { testServerConnection } = require("./setupConnection");
      const cfg = getNoraOpsConfig();
      try {
        const result = await testServerConnection(cfg.serverBaseUrl);
        webview.postMessage({ type: "connectionStatus", result });
      } catch (e) {
        webview.postMessage({
          type: "connectionStatus",
          result: { ok: false, message: e.message },
        });
      }
    }
    if (msg.type === "pickLaunchEntry") {
      const folder = requireWorkspaceFolder();
      if (!folder) return;
      try {
        const { buildLaunchEntryCatalog } = require("./entryPicker");
        webview.postMessage({
          type: "launchEntryCatalog",
          catalog: buildLaunchEntryCatalog(folder.uri.fsPath),
        });
      } catch (e) {
        vscode.window.showErrorMessage(`起動ファイル一覧: ${e.message}`);
      }
    }
    if (msg.type === "saveThumbnail" || msg.type === "applyThumbnail") {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) {
        vscode.window.showWarningMessage("フォルダを開いてからサムネイルを設定してください。");
        return;
      }
      try {
        await saveThumbnailToWorkspace(folder.uri.fsPath, {
          dataUrl: msg.dataUrl,
          fromClipboard: msg.type === "saveThumbnailFromClipboard" || !msg.dataUrl,
        });
        await vscode.commands.executeCommand("workbench.files.action.refreshFilesExplorer");
        vscode.window.showInformationMessage(
          "サムネイルを保存しました（nora/assets/thumbnail.png）。Gitea 保存時に zip に含まれ、Runner に表示されます。"
        );
      } catch (e) {
        vscode.window.showErrorMessage(`サムネイル: ${e.message}`);
      }
      await postState();
      if (homePanel) {
        webview.postMessage({ type: "thumbnailSaved", ok: true });
      }
    }
    if (msg.type === "saveThumbnailFromClipboard") {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) return;
      try {
        await saveThumbnailToWorkspace(folder.uri.fsPath, { fromClipboard: true });
        await vscode.commands.executeCommand("workbench.files.action.refreshFilesExplorer");
        vscode.window.showInformationMessage("クリップボードの画像をサムネイルに保存しました。");
      } catch (e) {
        vscode.window.showErrorMessage(`サムネイル: ${e.message}`);
      }
      await postState();
      if (homePanel) {
        webview.postMessage({ type: "thumbnailSaved", ok: true });
      }
    }
    if (msg.type === "openRepoRequirementsDoc") {
      const candidates = [
        path.join(context.extensionPath, "..", "NoraOps", "Giteaリポジトリ要件.md"),
        path.join(context.extensionPath, "docs", "Giteaリポジトリ要件.md"),
      ];
      const docPath = candidates.find((p) => fs.existsSync(p));
      if (!docPath) {
        vscode.window.showWarningMessage("Giteaリポジトリ要件.md が見つかりません。");
        return;
      }
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(docPath));
      await vscode.window.showTextDocument(doc, { preview: true });
    }
    if (msg.type === "scrollTo" && msg.target) {
      const el = msg.target;
      webview.postMessage({ type: "scrollTo", target: el });
    }
    if (msg.type === "setupTools") {
      postToolsProgress({ stage: "busy", message: "セットアップを開始…" });
      await vscode.commands.executeCommand("noraops.setupTools");
      await postState();
    }
    if (msg.type === "checkTools") {
      postToolsProgress({ stage: "busy", message: "状態を確認中…" });
      await vscode.commands.executeCommand("noraops.checkTools");
      await postState();
    }
    if (msg.type === "newApp") {
      const uris = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        openLabel: "このフォルダで始める",
      });
      if (uris?.[0]) {
      const { ensureScaffoldForProfile } = require("./scaffold");
      const { writeCreatorProfile, MODES } = require("./creatorWorkflow");
      writeCreatorProfile(uris[0].fsPath, MODES.GREENFIELD);
      ensureScaffoldForProfile(uris[0].fsPath, { profile: MODES.GREENFIELD });
        await vscode.commands.executeCommand("vscode.openFolder", uris[0], false);
        vscode.window.showInformationMessage("雛形を入れました。大きなボタンに従って進めてください。");
      }
    }
    if (msg.type === "xllmPickFolder") {
      const folder = requireWorkspaceFolder();
      if (!folder) return;
      const { resolveScaffoldRoot } = require("./scaffold");
      const root = resolveScaffoldRoot(folder.uri.fsPath);
      const uris = await vscode.window.showOpenDialog({
        canSelectMany: true,
        canSelectFiles: false,
        canSelectFolders: true,
        defaultUri: vscode.Uri.file(root),
        openLabel: "フォルダを追加",
        title: "プロンプトに含めるフォルダ（配下のファイルすべて）",
      });
      if (!uris?.length) return;
      const paths = [];
      for (const uri of uris) {
        const rel = path.relative(root, uri.fsPath).replace(/\\/g, "/");
        if (rel.startsWith("..") || path.isAbsolute(rel)) {
          vscode.window.showWarningMessage(`ワークスペース外は選べません: ${uri.fsPath}`);
          continue;
        }
        paths.push(rel);
      }
      if (!paths.length) return;
      const existing = Array.isArray(msg.existingPaths) ? msg.existingPaths : [];
      const merged = [...new Set([...existing, ...paths])];
      webview.postMessage({ type: "xllmScopePicked", paths: merged, subMode: "folder", merge: true });
    }
    if (msg.type === "xllmListFileTree") {
      const folder = requireWorkspaceFolder();
      if (!folder) return;
      try {
        const { buildExportFileTree } = require("./xllmFileTree");
        const tree = buildExportFileTree(folder.uri.fsPath);
        webview.postMessage({ type: "xllmFileTree", ...tree });
      } catch (e) {
        webview.postMessage({ type: "xllmExportError", message: e.message || String(e) });
      }
    }
    if (msg.type === "creatorUiSave") {
      const folder = requireWorkspaceFolder();
      if (!folder || !msg.ui || typeof msg.ui !== "object") return;
      const { writeCreatorUi } = require("./creatorUiState");
      writeCreatorUi(folder.uri.fsPath, msg.ui);
    }
    if (msg.type === "xllmGenerateExport") {
      const folder = requireWorkspaceFolder();
      if (!folder) return;
      const scopeMode = msg.scopeMode === "pick" ? "pick" : "all";
      const scope =
        scopeMode === "pick"
          ? { mode: "pick", relPaths: Array.isArray(msg.scopePaths) ? msg.scopePaths : [] }
          : { mode: "all" };
      if (scopeMode === "pick" && !scope.relPaths.length) {
        webview.postMessage({
          type: "xllmExportError",
          message: "ファイル / フォルダを選ぶか、「ワークスペース全体」を選んでください。",
        });
        return;
      }
      try {
        const { refreshRules, runWorkspaceChecks } = require("./savePipeline");
        await refreshRules();
        const checkSummary = await runWorkspaceChecks(folder.uri.fsPath);
        const { buildExportMarkdown, getModeLabel, normalizeExportMode } = require("./xllmExport");
        const { normalizeCompressMode } = require("./xllmCompress");
        const { legacyModeToPromptKey } = require("./promptResolve");
        const exportMode = normalizeExportMode(msg.exportMode);
        const promptKey =
          msg.promptKey || legacyModeToPromptKey(exportMode);
        const compressMode = normalizeCompressMode(msg.compressMode);
        const result = buildExportMarkdown({
          workspaceRoot: folder.uri.fsPath,
          userRequest: String(msg.userRequest || ""),
          scope,
          mode: exportMode,
          promptKey,
          errorLog: String(msg.errorLog || ""),
          checkSummary,
          compressMode,
        });
        if (!result.ok) {
          webview.postMessage({
            type: "xllmExportError",
            message: result.message || "エクスポートできませんでした。",
          });
          return;
        }
        await vscode.env.clipboard.writeText(result.markdown);
        webview.postMessage({
          type: "xllmExportReady",
          markdown: result.markdown,
          fileCount: result.fileCount,
          charCount: result.charCount,
          sourceCharCount: result.sourceCharCount,
          compressMode: result.compressMode,
          tokenEstimate: result.tokenEstimate,
          copied: true,
          checkNotice: result.checkNotice || null,
        });
        if (result.checkNotice?.secErrors) {
          vscode.window.showWarningMessage(
            `xLLM: セキュリティ違反が ${result.checkNotice.secErrors} 件あります。プロンプトに注意事項を入れました。外部 AI に送る前に確認してください。`
          );
        } else if (result.checkNotice?.hasIssues) {
          vscode.window.showInformationMessage(
            `xLLM: チェックで指摘 ${(result.checkNotice.secErrors || 0) + (result.checkNotice.polErrors || 0) + (result.checkNotice.warnCount || 0)} 件 — プロンプトに要約を入れました。`
          );
        }
        vscode.window.showInformationMessage(
          `xLLM プロンプトをコピーしました（${result.fileCount} ファイル · ${result.promptKey || getModeLabel(exportMode)}）。外部 AI チャットに貼り付けてください。`
        );
      } catch (e) {
        webview.postMessage({ type: "xllmExportError", message: e.message || String(e) });
      }
    }
    if (msg.type === "xllmCaptureErrorClipboard") {
      try {
        const { extractErrorSnippet } = require("./xllmErrorCapture");
        const raw = await vscode.env.clipboard.readText();
        const text = extractErrorSnippet(raw);
        webview.postMessage({
          type: "xllmErrorCaptured",
          text,
          source: "clipboard",
          empty: !String(raw || "").trim(),
        });
        if (!String(raw || "").trim()) {
          vscode.window.showWarningMessage("クリップボードが空です。ターミナルでエラー部分を選択してコピーしてください。");
        }
      } catch (e) {
        webview.postMessage({ type: "xllmExportError", message: e.message || String(e) });
      }
    }
    if (msg.type === "xllmCaptureErrorWorkspaceLog") {
      const folder = requireWorkspaceFolder();
      if (!folder) return;
      try {
        const { readWorkspaceLogTail, extractErrorSnippet } = require("./xllmErrorCapture");
        const raw = readWorkspaceLogTail(folder.uri.fsPath);
        const text = extractErrorSnippet(raw);
        webview.postMessage({
          type: "xllmErrorCaptured",
          text,
          source: "log",
          empty: !String(raw || "").trim(),
        });
        if (!String(raw || "").trim()) {
          vscode.window.showWarningMessage("logs/log.txt が見つからないか空です。");
        }
      } catch (e) {
        webview.postMessage({ type: "xllmExportError", message: e.message || String(e) });
      }
    }
    if (msg.type === "xllmCopyExport" && msg.markdown) {
      await vscode.env.clipboard.writeText(String(msg.markdown));
      vscode.window.showInformationMessage("xLLM プロンプトをコピーしました。");
    }
    if (msg.type === "xllmCaptureResponseClipboard") {
      try {
        const raw = await vscode.env.clipboard.readText();
        webview.postMessage({
          type: "xllmResponseCaptured",
          text: raw,
          empty: !String(raw || "").trim(),
          append: msg.append !== false,
        });
      } catch (e) {
        webview.postMessage({
          type: "xllmResponseCaptured",
          text: "",
          empty: true,
          error: e.message || String(e),
        });
      }
    }
    if (msg.type === "xllmParseResponse") {
      const folder = requireWorkspaceFolder();
      if (!folder) return;
      try {
        const { planApply, summarizePlan } = require("./xllmApply");
        const { plan, parseCount, parseMeta } = planApply(folder.uri.fsPath, String(msg.markdown || ""));
        if (!parseCount) {
          webview.postMessage({
            type: "xllmParseError",
            message:
              "ファイルを認識できませんでした。チャットでコード部分を選択 → Ctrl+C →「クリップボードから追記」を試してください。",
            hint: "split",
          });
          return;
        }
        webview.postMessage({
          type: "xllmParseReady",
          plan,
          counts: summarizePlan(plan),
          parseMeta: parseMeta || null,
        });
        xllmPlanByWorkspace.set(folder.uri.fsPath, {
          plan,
          markdown: String(msg.markdown || ""),
        });
      } catch (e) {
        webview.postMessage({ type: "xllmParseError", message: e.message || String(e) });
      }
    }
    if (msg.type === "xllmApplyFiles") {
      const folder = requireWorkspaceFolder();
      if (!folder) return;
      const paths = new Set(Array.isArray(msg.paths) ? msg.paths : []);
      if (!paths.size) return;
      const cached = xllmPlanByWorkspace.get(folder.uri.fsPath);
      const markdown = String(msg.markdown || cached?.markdown || "");
      if (!markdown) {
        webview.postMessage({
          type: "xllmParseError",
          message: "先に「解析」を実行してから適用してください。",
        });
        return;
      }
      try {
        const { planApply, applyItems } = require("./xllmApply");
        const { plan: fullPlan } = planApply(folder.uri.fsPath, markdown);
        const toApply = fullPlan.filter((p) => paths.has(p.path) && p.status !== "unchanged");
        if (!toApply.length) {
          vscode.window.showInformationMessage("適用対象がありません。");
          return;
        }
        const confirm = await vscode.window.showWarningMessage(
          `${toApply.length} ファイルを上書きします:\n${toApply
            .slice(0, 8)
            .map((p) => `· ${p.path} (${p.status === "new" ? "新規" : "変更"})`)
            .join("\n")}${toApply.length > 8 ? `\n…他 ${toApply.length - 8} 件` : ""}\n\n適用前の状態は xLLM 履歴に自動保存されます。`,
          { modal: true },
          "適用"
        );
        if (confirm !== "適用") return;
        const { applied, errors, snapshotId, snapshotLabel } = applyItems(
          folder.uri.fsPath,
          toApply,
          { label: `適用 ${toApply.length} ファイル` }
        );
        if (errors.length) {
          vscode.window.showWarningMessage(`一部失敗: ${errors.map((e) => e.path).join(", ")}`);
        }
        const { runWorkspaceChecks } = require("./savePipeline");
        await runWorkspaceChecks(folder.uri.fsPath);
        const { plan: afterPlan } = planApply(folder.uri.fsPath, markdown);
        xllmPlanByWorkspace.set(folder.uri.fsPath, { plan: afterPlan, markdown });
        webview.postMessage({
          type: "xllmApplyDone",
          applied,
          errors,
          snapshotId,
          snapshotLabel,
          plan: afterPlan,
        });
        vscode.window.showInformationMessage(
          `xLLM: ${applied.length} ファイルを適用しました。履歴からいつでも切り戻せます。`
        );
        await vscode.commands.executeCommand("workbench.files.action.refreshFilesExplorer");
        await postState({ force: true });
      } catch (e) {
        webview.postMessage({ type: "xllmParseError", message: e.message || String(e) });
      }
    }
    if (msg.type === "xllmListHistory") {
      const folder = requireWorkspaceFolder();
      if (!folder) return;
      const { listSnapshots } = require("./xllmHistory");
      webview.postMessage({
        type: "xllmHistoryReady",
        snapshots: listSnapshots(folder.uri.fsPath),
        maxUnpinned: require("./xllmHistory").MAX_UNPINNED,
      });
    }
    if (msg.type === "xllmTogglePin" && msg.snapshotId) {
      const folder = requireWorkspaceFolder();
      if (!folder) return;
      const { togglePin, listSnapshots, MAX_UNPINNED } = require("./xllmHistory");
      togglePin(folder.uri.fsPath, msg.snapshotId);
      webview.postMessage({
        type: "xllmHistoryReady",
        snapshots: listSnapshots(folder.uri.fsPath),
        maxUnpinned: MAX_UNPINNED,
      });
    }
    if (msg.type === "xllmRestoreSnapshot" && msg.snapshotId) {
      const folder = requireWorkspaceFolder();
      if (!folder) return;
      const { restoreSnapshot, listSnapshots, MAX_UNPINNED } = require("./xllmHistory");
      const confirm = await vscode.window.showWarningMessage(
        "この時点のファイル内容に切り戻します。現在の内容は上書きされます。",
        { modal: true },
        "切り戻す"
      );
      if (confirm !== "切り戻す") return;
      const result = restoreSnapshot(folder.uri.fsPath, msg.snapshotId);
      if (!result.ok) {
        vscode.window.showErrorMessage(result.reason || "切り戻しに失敗しました。");
        return;
      }
      const { runWorkspaceChecks } = require("./savePipeline");
      await runWorkspaceChecks(folder.uri.fsPath);
      await vscode.commands.executeCommand("workbench.files.action.refreshFilesExplorer");
      webview.postMessage({
        type: "xllmRestoreDone",
        result,
        snapshots: listSnapshots(folder.uri.fsPath),
        maxUnpinned: MAX_UNPINNED,
      });
      vscode.window.showInformationMessage(
        `切り戻しました: ${result.restored.length} ファイル復元` +
          (result.deleted.length ? ` · ${result.deleted.length} 新規ファイル削除` : "")
      );
      await postState({ force: true });
    }
}

function _setPanelRef(panel) {
  homePanel = panel;
}

function _clearPanelRef() {
  homePanel = undefined;
  homeStateCache.clear();
  if (mockPreviewWatcher) {
    mockPreviewWatcher.dispose();
    mockPreviewWatcher = undefined;
  }
  mockWatchRoot = null;
}

async function bootstrapHomeView(context, webview, options = {}) {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (folder) {
    ensureMockPreviewWatcher(folder.uri.fsPath);
    pushMockPreviewToWebview(webview, folder.uri.fsPath);
  }
  const { readCreatorUi } = require("./creatorUiState");
  const { listXllmChoices } = require("./creatorPrompts");
  const { PRESET_META, COMPRESS_HELP, DEFAULT_COMPRESS_MODE } = require("./xllmCompress");
  await postState({ force: true, includeCopilot: false, includeThumbnail: false });
  webview.postMessage({
    type: "creatorBootstrap",
    workspacePath: folder?.uri.fsPath || null,
    soft: options.soft === true,
    creatorUi: folder ? readCreatorUi(folder.uri.fsPath) : null,
    xllmPromptChoices: folder ? listXllmChoices(folder.uri.fsPath) : [],
    xllmCompressPresets: PRESET_META,
    xllmCompressHelp: COMPRESS_HELP,
    xllmCompressDefault: DEFAULT_COMPRESS_MODE,
  });
  if (!options.soft) {
    setTimeout(() => postState({ force: true }), 800);
  }
}

async function createHomePanel(context, options = {}) {
  const { showNoraOpsView } = require("./noraOpsShell");
  return showNoraOpsView(context, "creator", options);
}

async function refreshHomePanel() {
  homeStateCache.clear();
  await postState({ force: true });
}

function postToolsProgress(progress) {
  if (!homePanel) return;
  homePanel.webview.postMessage({
    type: "toolsProgress",
    message: progress?.message || "",
    stage: progress?.stage || "",
  });
}

function postPythonProgress(progress) {
  if (!homePanel) return;
  homePanel.webview.postMessage({
    type: "pythonProgress",
    message: progress?.message || "",
  });
}

function postPythonNotice(notice) {
  if (!homePanel) return;
  homePanel.webview.postMessage({ type: "pythonNotice", notice: notice || null });
}

function postSaveResult(result) {
  if (!homePanel) return;
  homePanel.webview.postMessage({ type: "saveResult", result: result || null, busy: result?.busy === true });
  if (result?.busy) return;
  if (result?.push && !result.push.ok && !result.push.offline && !result.push.skipped && !result.push.localOnly) {
    const { describePushFailureDetail } = require("./saveFlow");
    const detail = describePushFailureDetail(result.push);
    if (detail) {
      homePanel.webview.postMessage({
        type: "showAiNotice",
        kind: detail.kind || "warn",
        title: detail.title || "クラウド送信に失敗しました",
        body: detail.body,
        steps: detail.steps || [],
        offerSetup: !!detail.offerSetup,
      });
    }
    return;
  }
  if (result?.push?.ok && result?.publish && result.publish.ok === false && !result.publish.skipped) {
    const { describePublishFailureDetail } = require("./publishFailureDetail");
    const detail = describePublishFailureDetail(result.publish, result.push);
    if (detail) {
      homePanel.webview.postMessage({
        type: "showAiNotice",
        kind: detail.kind || "warn",
        title: detail.title,
        body: detail.body,
        steps: detail.steps || [],
      });
    }
  }
}

function focusSavePicker() {
  if (!homePanel) return;
  homePanel.reveal(vscode.ViewColumn.One);
  homePanel.webview.postMessage({ type: "openSavePicker" });
}

async function pasteThumbnailFromClipboard() {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    vscode.window.showWarningMessage("フォルダを開いてから実行してください。");
    return;
  }
  try {
    await saveThumbnailToWorkspace(folder.uri.fsPath, { fromClipboard: true });
    await vscode.commands.executeCommand("workbench.files.action.refreshFilesExplorer");
    vscode.window.showInformationMessage("サムネイルを保存しました（nora/assets/thumbnail.png）");
    refreshHomePanel();
  } catch (e) {
    vscode.window.showErrorMessage(`サムネイル: ${e.message}`);
  }
}

module.exports = {
  createHomePanel,
  refreshHomePanel,
  postToolsProgress,
  postPythonProgress,
  postPythonNotice,
  postSaveResult,
  focusSavePicker,
  pasteThumbnailFromClipboard,
  runEnsureScaffoldInHome,
  handleHomeMessage,
  bootstrapHomeView,
  _setPanelRef,
  _clearPanelRef,
};
