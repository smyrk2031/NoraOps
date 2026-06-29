const fs = require("fs");
const path = require("path");
const vscode = require("vscode");
const { runGit } = require("./gitExec");

let historyPanel;

async function loadHistoryLines(workspaceRoot, limit = 30) {
  try {
    const out = await runGit(workspaceRoot, ["log", `--max-count=${limit}`, "--pretty=format:%h|%ci|%s"]);
    if (!out) return [];
    return out.split("\n").map((line) => {
      const [hash, date, ...rest] = line.split("|");
      return { hash, date, message: rest.join("|") || "保存" };
    });
  } catch {
    return [];
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
    return historyPanel;
  }

  historyPanel = vscode.window.createWebviewPanel(
    "noraopsHistory",
    "NoraOps 履歴",
    vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  const htmlPath = path.join(context.extensionPath, "media", "noraops-history.html");
  historyPanel.webview.html = fs.readFileSync(htmlPath, "utf8");

  historyPanel.webview.onDidReceiveMessage(async (msg) => {
    if (msg.type === "restore" && msg.hash) {
      const ok = await vscode.window.showWarningMessage(
        `${msg.hash} の版に戻しますか？いまの変更は戻す前に自動保存されます。`,
        { modal: true },
        "戻す"
      );
      if (ok !== "戻す") return;
      try {
        await vscode.commands.executeCommand("noraops.save");
        await runGit(folder.uri.fsPath, ["checkout", msg.hash, "--", "."]);
        vscode.window.showInformationMessage("この版の内容をワークスペースに反映しました。");
      } catch (e) {
        vscode.window.showErrorMessage(`戻す操作に失敗: ${e.message}`);
      }
    }
    if (msg.type === "refresh") {
      const items = await loadHistoryLines(folder.uri.fsPath);
      historyPanel.webview.postMessage({ type: "history", items });
    }
  });

  historyPanel.onDidDispose(() => {
    historyPanel = undefined;
  });

  loadHistoryLines(folder.uri.fsPath).then((items) => {
    historyPanel?.webview.postMessage({ type: "history", items });
  });

  return historyPanel;
}

module.exports = { createHistoryPanel };
