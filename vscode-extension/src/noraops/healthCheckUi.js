const vscode = require("vscode");
const { getNoraOpsConfig } = require("./config");
const { runClientHealthCheck, formatHealthReport } = require("./healthCheck");

async function runHealthCheckWithUi(webviewPanel) {
  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "NoraOps: 動作確認",
      cancellable: false,
    },
    async () => runClientHealthCheck()
  );

  const reportText = formatHealthReport(result);
  if (webviewPanel?.webview) {
    webviewPanel.webview.postMessage({ type: "healthResult", result, reportText });
  }

  const doc = await vscode.workspace.openTextDocument({
    content: `# NoraOps 動作確認\n\n\`\`\`\n${reportText}\n\`\`\`\n`,
    language: "markdown",
  });
  await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });

  if (result.ok) {
    vscode.window.showInformationMessage(
      `動作確認: ${result.passed}/${result.total} 項目 OK`
    );
  } else {
    vscode.window.showWarningMessage(
      `動作確認: ${result.passed}/${result.total} OK — 詳細は横のドキュメントを確認`
    );
  }
  return result;
}

async function openServerDiagnosticsPage() {
  const cfg = getNoraOpsConfig();
  if (!cfg.serverBaseUrl) {
    vscode.window.showWarningMessage("noraops.server.baseUrl が未設定です。");
    return;
  }
  const url = `${cfg.serverBaseUrl.replace(/\/$/, "")}/noraops/diagnostics/run`;
  await vscode.env.openExternal(vscode.Uri.parse(url));
}

module.exports = { runHealthCheckWithUi, openServerDiagnosticsPage };
