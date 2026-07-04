const vscode = require("vscode");
const {
  listBuiltinPrompts,
  listCustom,
  setBuiltinEnabled,
  addCustom,
  updateCustom,
  deleteCustom,
  reorderCustom,
} = require("./creatorPrompts");
const { checkBuiltinPromptUpdates, applyBuiltinPromptUpdates } = require("./promptSync");
const { getCatalogVersion } = require("./builtinPromptCatalog");

/** @type {import('vscode').WebviewPanel | undefined} */
let promptPanelRef;

function _setPanelRef(panel) {
  promptPanelRef = panel;
}

function _clearPanelRef() {
  promptPanelRef = undefined;
}

function requireWorkspaceFolder() {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    vscode.window.showWarningMessage("フォルダを開いてからプロンプト帳を使ってください。");
    return null;
  }
  return folder;
}

async function buildBootstrapPayload(workspaceRoot) {
  const sync = workspaceRoot
    ? await checkBuiltinPromptUpdates(workspaceRoot)
    : { online: false, hasUpdate: false, localVersion: getCatalogVersion() };
  return {
    workspacePath: workspaceRoot,
    builtins: workspaceRoot
      ? listBuiltinPrompts(workspaceRoot, { includeBody: true })
      : [],
    custom: workspaceRoot ? listCustom(workspaceRoot) : [],
    catalogVersion: getCatalogVersion(),
    sync,
  };
}

async function bootstrapPromptView(context, webview, options = {}) {
  const folder = vscode.workspace.workspaceFolders?.[0];
  const ws = folder?.uri.fsPath || null;
  const payload = await buildBootstrapPayload(ws);
  webview.postMessage({
    type: "promptBootstrap",
    ...payload,
    soft: options.soft === true,
  });
}

async function handlePromptMessage(context, msg, webview) {
  const folder = requireWorkspaceFolder();
  if (!folder) {
    if (msg.type === "promptBootstrap") return;
    webview.postMessage({ type: "promptError", message: "ワークスペースが開いていません。" });
    return;
  }
  const ws = folder.uri.fsPath;

  if (msg.type === "promptList") {
    const payload = await buildBootstrapPayload(ws);
    webview.postMessage({ type: "promptState", ...payload });
    return;
  }

  if (msg.type === "promptBuiltinToggle" && msg.key) {
    setBuiltinEnabled(ws, msg.key, !!msg.enabled);
    const payload = await buildBootstrapPayload(ws);
    webview.postMessage({ type: "promptState", ...payload });
    return;
  }

  if (msg.type === "promptSyncCheck") {
    const sync = await checkBuiltinPromptUpdates(ws);
    webview.postMessage({ type: "promptSyncStatus", sync });
    return;
  }

  if (msg.type === "promptSyncApply") {
    const result = await applyBuiltinPromptUpdates(ws);
    const payload = await buildBootstrapPayload(ws);
    webview.postMessage({ type: "promptState", ...payload, sync: result });
    if (result.updatedCount > 0) {
      vscode.window.showInformationMessage(
        `基本プロンプトを更新しました（${result.updatedCount} 件）。`
      );
    } else if (result.online && !result.hasUpdate) {
      vscode.window.showInformationMessage("基本プロンプトは最新です。");
    } else if (!result.online) {
      vscode.window.showWarningMessage("サーバーに接続できません。同梱の基本プロンプトを使用します。");
    }
    return;
  }

  if (msg.type === "promptCustomAdd") {
    const { custom, prompt } = addCustom(ws, {
      title: msg.title,
      body: msg.body,
      enabled: msg.enabled,
    });
    webview.postMessage({
      type: "promptState",
      ...(await buildBootstrapPayload(ws)),
      custom,
      focusId: prompt.id,
    });
    return;
  }

  if (msg.type === "promptCustomUpdate" && msg.id) {
    const result = updateCustom(ws, msg.id, {
      title: msg.title,
      body: msg.body,
      enabled: msg.enabled,
    });
    if (!result) {
      webview.postMessage({ type: "promptError", message: "プロンプトが見つかりません。" });
      return;
    }
    webview.postMessage({ type: "promptState", ...(await buildBootstrapPayload(ws)) });
    return;
  }

  if (msg.type === "promptCustomDeleteRequest" && msg.id) {
    const title = String(msg.title || "このプロンプト").trim();
    const pick = await vscode.window.showWarningMessage(
      `「${title}」を削除しますか？`,
      { modal: true },
      "削除する"
    );
    if (pick !== "削除する") return;
    deleteCustom(ws, msg.id);
    webview.postMessage({ type: "promptState", ...(await buildBootstrapPayload(ws)) });
    return;
  }

  if (msg.type === "promptCustomDelete" && msg.id) {
    deleteCustom(ws, msg.id);
    webview.postMessage({ type: "promptState", ...(await buildBootstrapPayload(ws)) });
    return;
  }

  if (msg.type === "promptCustomReorder" && msg.id) {
    reorderCustom(ws, msg.id, msg.direction === "up" ? "up" : "down");
    webview.postMessage({ type: "promptState", ...(await buildBootstrapPayload(ws)) });
  }
}

module.exports = {
  bootstrapPromptView,
  handlePromptMessage,
  _setPanelRef,
  _clearPanelRef,
};
