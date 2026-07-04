/**
 * 単一 Webview パネルで Setting / Prompt / Creator / Runner を切り替え
 */
const fs = require("fs");
const path = require("path");
const vscode = require("vscode");

/** @type {vscode.WebviewPanel | undefined} */
let shellPanel;
/** @type {'setup'|'connect'|'prompt'|'creator'|'runner'|null} */
let activeView = null;
/** @type {import('vscode').ExtensionContext | null} */
let shellContext = null;

const VIEW_HTML = {
  setup: "noraops-setup.html",
  connect: "noraops-connect.html",
  prompt: "noraops-prompt.html",
  creator: "noraops-home.html",
  runner: "noraops-runner.html",
};

const VIEW_TITLE = {
  setup: "NoraOps Setting",
  connect: "NoraOps · Connect",
  prompt: "NoraOps · Prompt",
  creator: "NoraOps · Creator",
  runner: "NoraOps · Runner",
};

function normalizeViewTarget(target) {
  if (target === "memo") return "prompt";
  if (target === "setup" || target === "connect" || target === "prompt" || target === "creator" || target === "runner") {
    return target;
  }
  return null;
}

function getLocalResourceRoots(context) {
  const roots = [vscode.Uri.file(path.join(context.extensionPath, "media"))];
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (folder) roots.push(folder.uri);
  return roots;
}

function applyWebviewResourceRoots(context) {
  if (!shellPanel) return;
  shellPanel.webview.options = {
    enableScripts: true,
    retainContextWhenHidden: true,
    localResourceRoots: getLocalResourceRoots(context),
  };
}

function clearModuleRefs() {
  for (const mod of ["./setupPanel", "./connectPanel", "./homePanel", "./runner/runnerPanel", "./promptPanel"]) {
    try {
      require(mod)._clearPanelRef();
    } catch {
      /* ignore */
    }
  }
}

function syncModuleRef(view, panel) {
  clearModuleRefs();
  if (view === "setup") require("./setupPanel")._setPanelRef(panel);
  else if (view === "connect") require("./connectPanel")._setPanelRef(panel);
  else if (view === "prompt") require("./promptPanel")._setPanelRef(panel);
  else if (view === "creator") require("./homePanel")._setPanelRef(panel);
  else if (view === "runner") require("./runner/runnerPanel")._setPanelRef(panel);
}

async function routeMessage(msg) {
  if (!shellContext || !shellPanel) return;
  if (msg.type === "navigate" && msg.target) {
    const target = normalizeViewTarget(msg.target);
    if (target) {
      await showNoraOpsView(shellContext, target);
    }
    return;
  }
  if (activeView === "setup") {
    await require("./setupPanel").handleSetupMessage(shellContext, msg, shellPanel.webview);
  } else if (activeView === "connect") {
    await require("./connectPanel").handleConnectMessage(shellContext, msg, shellPanel.webview);
  } else if (activeView === "prompt") {
    await require("./promptPanel").handlePromptMessage(shellContext, msg, shellPanel.webview);
  } else if (activeView === "creator") {
    await require("./homePanel").handleHomeMessage(shellContext, msg, shellPanel.webview);
  } else if (activeView === "runner") {
    await require("./runner/runnerPanel").handleRunnerMessage(shellContext, msg, shellPanel.webview);
  }
}

async function bootstrapView(context, view) {
  if (view === "setup") {
    await require("./setupPanel").bootstrapSetupView(context, shellPanel.webview);
  } else if (view === "connect") {
    await require("./connectPanel").bootstrapConnectView(context, shellPanel.webview);
  } else if (view === "prompt") {
    await require("./promptPanel").bootstrapPromptView(context, shellPanel.webview);
  } else if (view === "creator") {
    await require("./homePanel").bootstrapHomeView(context, shellPanel.webview);
  } else if (view === "runner") {
    await require("./runner/runnerPanel").bootstrapRunnerView(context, shellPanel.webview);
  }
}

/**
 * @param {import('vscode').ExtensionContext} context
 * @param {'setup'|'connect'|'prompt'|'creator'|'runner'} view
 * @param {{ viewColumn?: vscode.ViewColumn }} [options]
 */
async function showNoraOpsView(context, view, options = {}) {
  shellContext = context;
  const normalized = normalizeViewTarget(view) || view;
  const sameView = shellPanel && activeView === normalized;

  if (!shellPanel) {
    shellPanel = vscode.window.createWebviewPanel(
      "noraopsShell",
      VIEW_TITLE[normalized] || "NoraOps",
      options.viewColumn ?? vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    applyWebviewResourceRoots(context);
    shellPanel.webview.onDidReceiveMessage((msg) => {
      routeMessage(msg).catch((e) => console.error("[NoraOps shell]", e));
    });
    shellPanel.onDidDispose(() => {
      shellPanel = undefined;
      activeView = null;
      shellContext = null;
      clearModuleRefs();
    });
  } else {
    shellPanel.reveal(options.viewColumn ?? shellPanel.viewColumn);
    applyWebviewResourceRoots(context);
  }

  if (!sameView) {
    activeView = normalized;
    shellPanel.title = VIEW_TITLE[normalized] || "NoraOps";
    const htmlPath = path.join(context.extensionPath, "media", VIEW_HTML[normalized]);
    shellPanel.webview.html = fs.readFileSync(htmlPath, "utf8");
    syncModuleRef(normalized, shellPanel);
    await bootstrapView(context, normalized);
  } else if (normalized === "setup") {
    await require("./setupPanel").bootstrapSetupView(context, shellPanel.webview, { soft: true });
  } else if (normalized === "connect") {
    await require("./connectPanel").bootstrapConnectView(context, shellPanel.webview, { soft: true });
  } else if (normalized === "prompt") {
    await require("./promptPanel").bootstrapPromptView(context, shellPanel.webview, { soft: true });
  } else if (normalized === "creator") {
    await require("./homePanel").bootstrapHomeView(context, shellPanel.webview, { soft: true });
  } else if (normalized === "runner") {
    await require("./runner/runnerPanel").bootstrapRunnerView(context, shellPanel.webview, { soft: true });
  }

  return shellPanel;
}

function getShellPanel() {
  return shellPanel;
}

function getActiveView() {
  return activeView;
}

module.exports = {
  showNoraOpsView,
  getShellPanel,
  getActiveView,
};
