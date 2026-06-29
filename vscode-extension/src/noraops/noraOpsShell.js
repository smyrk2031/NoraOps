/**
 * 単一 Webview パネルで 設定 / Creator / Runner を切り替え（エディタタブを占有しない）。
 */
const fs = require("fs");
const path = require("path");
const vscode = require("vscode");

/** @type {vscode.WebviewPanel | undefined} */
let shellPanel;
/** @type {'setup'|'creator'|'runner'|null} */
let activeView = null;
/** @type {import('vscode').ExtensionContext | null} */
let shellContext = null;

const VIEW_HTML = {
  setup: "noraops-setup.html",
  creator: "noraops-home.html",
  runner: "noraops-runner.html",
};

const VIEW_TITLE = {
  setup: "NoraOps Setting",
  creator: "NoraOps · Creator",
  runner: "NoraOps · Runner",
};

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
  try {
    require("./setupPanel")._clearPanelRef();
  } catch {
    /* ignore */
  }
  try {
    require("./homePanel")._clearPanelRef();
  } catch {
    /* ignore */
  }
  try {
    require("./runner/runnerPanel")._clearPanelRef();
  } catch {
    /* ignore */
  }
}

function syncModuleRef(view, panel) {
  clearModuleRefs();
  if (view === "setup") require("./setupPanel")._setPanelRef(panel);
  else if (view === "creator") require("./homePanel")._setPanelRef(panel);
  else if (view === "runner") require("./runner/runnerPanel")._setPanelRef(panel);
}

async function routeMessage(msg) {
  if (!shellContext || !shellPanel) return;
  if (msg.type === "navigate" && msg.target) {
    const target =
      msg.target === "setup" || msg.target === "creator" || msg.target === "runner"
        ? msg.target
        : null;
    if (target) {
      await showNoraOpsView(shellContext, target);
    }
    return;
  }
  if (activeView === "setup") {
    await require("./setupPanel").handleSetupMessage(shellContext, msg, shellPanel.webview);
  } else if (activeView === "creator") {
    await require("./homePanel").handleHomeMessage(shellContext, msg, shellPanel.webview);
  } else if (activeView === "runner") {
    await require("./runner/runnerPanel").handleRunnerMessage(shellContext, msg, shellPanel.webview);
  }
}

async function bootstrapView(context, view) {
  if (view === "setup") {
    await require("./setupPanel").bootstrapSetupView(context, shellPanel.webview);
  } else if (view === "creator") {
    await require("./homePanel").bootstrapHomeView(context, shellPanel.webview);
  } else if (view === "runner") {
    await require("./runner/runnerPanel").bootstrapRunnerView(context, shellPanel.webview);
  }
}

/**
 * @param {import('vscode').ExtensionContext} context
 * @param {'setup'|'creator'|'runner'} view
 * @param {{ viewColumn?: vscode.ViewColumn }} [options]
 */
async function showNoraOpsView(context, view, options = {}) {
  shellContext = context;
  const sameView = shellPanel && activeView === view;

  if (!shellPanel) {
    shellPanel = vscode.window.createWebviewPanel(
      "noraopsShell",
      VIEW_TITLE[view] || "NoraOps",
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
    activeView = view;
    shellPanel.title = VIEW_TITLE[view] || "NoraOps";
    const htmlPath = path.join(context.extensionPath, "media", VIEW_HTML[view]);
    shellPanel.webview.html = fs.readFileSync(htmlPath, "utf8");
    syncModuleRef(view, shellPanel);
    await bootstrapView(context, view);
  } else if (view === "setup") {
    await require("./setupPanel").bootstrapSetupView(context, shellPanel.webview, { soft: true });
  } else if (view === "creator") {
    await require("./homePanel").bootstrapHomeView(context, shellPanel.webview, { soft: true });
  } else if (view === "runner") {
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
