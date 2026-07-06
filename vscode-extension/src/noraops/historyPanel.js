const fs = require("fs");
const path = require("path");
const vscode = require("vscode");
const { listSaveSnapshots, restoreSaveSnapshot } = require("./saveHistory");

let historyPanel;

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleString("ja-JP", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso || "";
  }
}

function createHistoryPanel(context) {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    vscode.window.showWarningMessage("フォルダを開いてから履歴を表示してください。");
    return;
  }

  if (historyPanel) {
    historyPanel.reveal(vscode.ViewColumn.Beside);
    postHistory(folder.uri.fsPath);
    return historyPanel;
  }

  historyPanel = vscode.window.createWebviewPanel(
    "noraopsHistory",
    "NoraOps バックアップ履歴",
    vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  const htmlPath = path.join(context.extensionPath, "media", "noraops-history.html");
  historyPanel.webview.html = fs.readFileSync(htmlPath, "utf8");

  historyPanel.webview.onDidReceiveMessage(async (msg) => {
    const ws = folder.uri.fsPath;
    if (msg.type === "restore" && msg.id) {
      const snap = listSaveSnapshots(ws).find((s) => s.id === msg.id);
      const label = snap?.label || msg.id;
      const ok = await vscode.window.showWarningMessage(
        `「${label}」の内容にこの PC のフォルダを戻します。\n\n` +
          `⚠ 戻すと、いまの編集内容は失われ、戻す前の状態には二度と戻れません。よろしいですか？\n\n` +
          `（クラウド上の最新コピーは変わりません）`,
        { modal: true },
        "戻す",
        "キャンセル"
      );
      if (ok !== "戻す") return;
      const result = restoreSaveSnapshot(ws, msg.id);
      if (!result.ok) {
        vscode.window.showErrorMessage(
          `切り戻しに失敗しました: ${result.reason || result.errors?.[0]?.message || "不明"}`
        );
        return;
      }
      await vscode.commands.executeCommand("workbench.files.action.refreshFilesExplorer");
      const { runWorkspaceChecks } = require("./savePipeline");
      await runWorkspaceChecks(ws);
      const { refreshHomePanel } = require("./homePanel");
      await refreshHomePanel();
      vscode.window.showInformationMessage(
        `切り戻しました: ${result.restored.length} ファイル復元` +
          (result.deleted.length ? ` · ${result.deleted.length} 件削除` : "")
      );
      postHistory(ws);
    }
    if (msg.type === "refresh") {
      postHistory(ws);
    }
  });

  historyPanel.onDidDispose(() => {
    historyPanel = undefined;
  });

  postHistory(folder.uri.fsPath);
  return historyPanel;
}

function postHistory(workspaceRoot) {
  if (!historyPanel) return;
  const items = listSaveSnapshots(workspaceRoot).map((s) => ({
    id: s.id,
    date: formatDate(s.createdAt),
    label: s.label,
    fileCount: s.fileCount,
    fullName: s.fullName,
  }));
  historyPanel.webview.postMessage({ type: "history", items });
}

module.exports = { createHistoryPanel };
