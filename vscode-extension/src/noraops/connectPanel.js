const fs = require("fs");
const path = require("path");
const vscode = require("vscode");
const {
  listProfiles,
  addProfile,
  updateProfile,
  deleteProfile,
  reorderProfiles,
} = require("./connectProfiles");
const { appendHistory, listHistory, clearHistory } = require("./connectHistory");
const { buildCurlCommand } = require("./connectCurl");
const { executeConnectRequest } = require("./connectRequest");

/** @type {import('vscode').WebviewPanel | undefined} */
let connectPanelRef;

function _setPanelRef(panel) {
  connectPanelRef = panel;
}

function _clearPanelRef() {
  connectPanelRef = undefined;
}

function requireWorkspaceFolder() {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    vscode.window.showWarningMessage("フォルダを開いてから Connect を使ってください。");
    return null;
  }
  return folder;
}

function buildBootstrapPayload(workspaceRoot) {
  return {
    workspacePath: workspaceRoot,
    profiles: workspaceRoot ? listProfiles(workspaceRoot) : [],
    history: workspaceRoot ? listHistory(workspaceRoot) : [],
  };
}

async function bootstrapConnectView(context, webview, options = {}) {
  const folder = vscode.workspace.workspaceFolders?.[0];
  const ws = folder?.uri.fsPath || null;
  webview.postMessage({
    type: "connectBootstrap",
    ...buildBootstrapPayload(ws),
    soft: options.soft === true,
  });
}

async function handleConnectSaveResponse(msg) {
  if (!msg.bodyBase64) {
    vscode.window.showWarningMessage("保存する応答データがありません。");
    return;
  }
  const defaultName = msg.suggestedFilename || "download.bin";
  const folder = vscode.workspace.workspaceFolders?.[0];
  const defaultUri = folder
    ? vscode.Uri.file(path.join(folder.uri.fsPath, defaultName))
    : vscode.Uri.file(defaultName);
  const target = await vscode.window.showSaveDialog({
    defaultUri,
    filters: {
      "All files": ["*"],
    },
  });
  if (!target) return;
  fs.writeFileSync(target.fsPath, Buffer.from(msg.bodyBase64, "base64"));
  vscode.window.showInformationMessage(`保存しました: ${path.basename(target.fsPath)}`);
  const open = await vscode.window.showInformationMessage(
    "ファイルを開きますか？",
    "開く",
    "閉じる"
  );
  if (open === "開く") {
    await vscode.commands.executeCommand("vscode.open", target);
  }
}

async function handleConnectMessage(context, msg, webview) {
  const folder = requireWorkspaceFolder();
  if (!folder) {
    if (msg.type === "connectBootstrap") return;
    webview.postMessage({ type: "connectError", message: "ワークスペースが開いていません。" });
    return;
  }
  const ws = folder.uri.fsPath;

  if (msg.type === "connectList") {
    webview.postMessage({ type: "connectState", ...buildBootstrapPayload(ws) });
    return;
  }

  if (msg.type === "connectAdd") {
    try {
      const { profiles, profile } = addProfile(ws, {
        name: msg.name,
        method: msg.method,
        url: msg.url,
        headers: msg.headers,
        body: msg.body,
        contentType: msg.contentType,
      });
      webview.postMessage({ type: "connectState", profiles, focusId: profile.id });
    } catch (e) {
      webview.postMessage({ type: "connectError", message: e.message || String(e) });
    }
    return;
  }

  if (msg.type === "connectUpdate" && msg.id) {
    try {
      const { profiles, profile } = updateProfile(ws, msg.id, {
        name: msg.name,
        method: msg.method,
        url: msg.url,
        headers: msg.headers,
        body: msg.body,
        contentType: msg.contentType,
      });
      webview.postMessage({ type: "connectState", profiles, focusId: profile.id });
    } catch (e) {
      webview.postMessage({ type: "connectError", message: e.message || String(e) });
    }
    return;
  }

  if (msg.type === "connectDeleteRequest" && msg.id) {
    const p = listProfiles(ws).find((x) => x.id === msg.id);
    const label = p?.name || msg.id;
    const choice = await vscode.window.showWarningMessage(
      `接続「${label}」を削除しますか？`,
      { modal: true },
      "削除"
    );
    if (choice !== "削除") {
      webview.postMessage({ type: "connectDeleteCancelled", id: msg.id });
      return;
    }
    try {
      const profiles = deleteProfile(ws, msg.id);
      webview.postMessage({ type: "connectState", profiles });
    } catch (e) {
      webview.postMessage({ type: "connectError", message: e.message || String(e) });
    }
    return;
  }

  if (msg.type === "connectReorder" && Array.isArray(msg.orderedIds)) {
    const profiles = reorderProfiles(ws, msg.orderedIds);
    webview.postMessage({ type: "connectState", profiles });
    return;
  }

  if (msg.type === "connectExecute" && msg.id) {
    let profile = listProfiles(ws).find((p) => p.id === msg.id);
    if (!profile) {
      webview.postMessage({ type: "connectError", message: "プロファイルが見つかりません。" });
      return;
    }
    const merged = {
      ...profile,
      name: msg.name ?? profile.name,
      method: msg.method || profile.method,
      url: (msg.url ?? profile.url).trim(),
      body: msg.body ?? profile.body,
      contentType: msg.contentType || profile.contentType,
      headers: Array.isArray(msg.headers) ? msg.headers : profile.headers,
    };
    if (!merged.url) {
      webview.postMessage({ type: "connectError", message: "URL を入力してください。" });
      return;
    }
    const dirty =
      merged.url !== profile.url ||
      merged.method !== profile.method ||
      merged.body !== profile.body ||
      merged.contentType !== profile.contentType ||
      JSON.stringify(merged.headers) !== JSON.stringify(profile.headers) ||
      merged.name !== profile.name;
    if (dirty) {
      updateProfile(ws, msg.id, merged);
      profile = merged;
    }
    webview.postMessage({ type: "connectExecuteStarted", id: msg.id });
    try {
      const result = await executeConnectRequest(profile);
      const history = appendHistory(ws, {
        profileId: msg.id,
        profileName: merged.name || profile.name,
        request: {
          method: merged.method,
          url: merged.url,
          headers: merged.headers,
          body: merged.body,
          contentType: merged.contentType,
        },
        result,
      });
      webview.postMessage({
        type: "connectExecuteResult",
        id: msg.id,
        result,
        history,
      });
    } catch (e) {
      const errResult = { ok: false, error: e.message || String(e) };
      const history = appendHistory(ws, {
        profileId: msg.id,
        profileName: merged.name || profile.name,
        request: {
          method: merged.method,
          url: merged.url,
          headers: merged.headers,
          body: merged.body,
          contentType: merged.contentType,
        },
        result: errResult,
      });
      webview.postMessage({
        type: "connectExecuteResult",
        id: msg.id,
        result: errResult,
        history,
      });
    }
    return;
  }

  if (msg.type === "connectCopyCurl") {
    try {
      const cmd = buildCurlCommand({
        method: msg.method,
        url: msg.url,
        headers: msg.headers,
        body: msg.body,
        contentType: msg.contentType,
      });
      await vscode.env.clipboard.writeText(cmd);
      vscode.window.showInformationMessage("curl コマンドをコピーしました。");
      webview.postMessage({ type: "connectCurlCopied" });
    } catch (e) {
      webview.postMessage({ type: "connectError", message: e.message || String(e) });
    }
    return;
  }

  if (msg.type === "connectClearHistoryRequest" && msg.profileId) {
    const p = listProfiles(ws).find((x) => x.id === msg.profileId);
    const label = p?.name || "この接続";
    const choice = await vscode.window.showWarningMessage(
      `「${label}」の実行履歴を削除しますか？`,
      { modal: true },
      "削除"
    );
    if (choice !== "削除") return;
    const history = clearHistory(ws, msg.profileId);
    webview.postMessage({ type: "connectHistoryState", history });
    return;
  }

  if (msg.type === "connectSaveResponse") {
    await handleConnectSaveResponse(msg);
    return;
  }

  if (msg.type === "connectCopyResponse" && msg.text) {
    await vscode.env.clipboard.writeText(msg.text);
    vscode.window.showInformationMessage("応答をクリップボードにコピーしました。");
  }
}

async function createConnectPanel(context, options = {}) {
  const { showNoraOpsView } = require("./noraOpsShell");
  return showNoraOpsView(context, "connect", options);
}

module.exports = {
  _setPanelRef,
  _clearPanelRef,
  bootstrapConnectView,
  handleConnectMessage,
  createConnectPanel,
};
