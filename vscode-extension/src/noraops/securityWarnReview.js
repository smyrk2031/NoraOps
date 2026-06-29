const path = require("path");
const vscode = require("vscode");
const { getActiveSecWarns, markReviewed, suppressFingerprints } = require("./securityWarnStore");

/** @type {vscode.ExtensionContext | null} */
let extContext = null;
/** @type {vscode.WebviewPanel | null} */
let panel = null;

function initSecurityWarnReview(context) {
  extContext = context;
}

/**
 * @param {string} workspaceRoot
 * @param {object} summary
 * @param {{ mode?: 'run'|'publish' }} opts
 */
async function openSecurityWarnReview(workspaceRoot, summary, opts = {}) {
  if (!extContext) {
    vscode.window.showErrorMessage("NoraOps: 拡張コンテキストがありません。");
    return;
  }

  const items = getActiveSecWarns(workspaceRoot, summary);
  if (!items.length) {
    vscode.window.showInformationMessage("未処理のセキュリティ警告はありません。");
    return;
  }

  if (!panel) {
    panel = vscode.window.createWebviewPanel(
      "noraopsSecurityWarn",
      "NoraOps セキュリティ警告",
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    panel.onDidDispose(() => {
      panel = null;
    });
    panel.webview.onDidReceiveMessage(async (msg) => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) return;
      const ws = folder.uri.fsPath;
      if (msg.type === "goto" && msg.file) {
        const uri = vscode.Uri.file(path.join(ws, msg.file));
        const doc = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(doc, { preview: false });
        const line = Math.max(0, (msg.line || 1) - 1);
        const pos = new vscode.Position(line, 0);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
      }
      if (msg.type === "done") {
        if (msg.reviewed?.length) markReviewed(ws, msg.reviewed);
        if (msg.suppressed?.length) suppressFingerprints(ws, msg.suppressed);
        vscode.window.showInformationMessage(
          `セキュリティ警告を更新しました（確認 ${msg.reviewed?.length || 0} / 抑制 ${msg.suppressed?.length || 0}）。`
        );
        panel?.dispose();
      }
      if (msg.type === "close") {
        panel?.dispose();
      }
    });
  } else {
    panel.reveal();
  }

  const htmlPath = path.join(extContext.extensionPath, "media", "noraops-security-warn.html");
  panel.webview.html = (await vscode.workspace.fs.readFile(vscode.Uri.file(htmlPath))).toString();

  panel.webview.postMessage({
    type: "init",
    items: items.map((it) => ({
      fp: it.fp,
      ruleId: it.ruleId,
      message: it.message,
      file: it.file,
      line: it.line,
      snippet: it.snippet,
    })),
    mode: opts.mode || "run",
  });
}

module.exports = { initSecurityWarnReview, openSecurityWarnReview };
