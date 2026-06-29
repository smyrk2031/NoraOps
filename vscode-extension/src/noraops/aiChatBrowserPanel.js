const vscode = require("vscode");

/** @type {vscode.WebviewPanel | undefined} */
let aiChatPanel;

function escapeHtmlAttr(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function panelTitleForUrl(urlString) {
  try {
    return `AI · ${new URL(urlString).hostname}`;
  } catch {
    return "AI Chat";
  }
}

function buildAiChatHtml(urlString) {
  const src = escapeHtmlAttr(urlString);
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src https: http:; style-src 'unsafe-inline';">
<style>
  html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: var(--vscode-editor-background, #1e1e1e); }
  iframe { border: 0; width: 100%; height: 100%; display: block; }
</style>
</head>
<body>
<iframe
  src="${src}"
  sandbox="allow-scripts allow-forms allow-same-origin allow-downloads allow-popups allow-popups-to-escape-sandbox"
  allow="clipboard-read; clipboard-write"
  referrerpolicy="no-referrer-when-downgrade"
></iframe>
</body>
</html>`;
}

/**
 * NoraOps 拡張の Webview タブで URL を開く（Simple Browser 非搭載環境向け）。
 * @param {string} urlString
 */
function openAiChatBrowserPanel(urlString) {
  const title = panelTitleForUrl(urlString);

  if (aiChatPanel) {
    aiChatPanel.title = title;
    aiChatPanel.webview.html = buildAiChatHtml(urlString);
    aiChatPanel.reveal(undefined, false);
    return "webview-reuse";
  }

  aiChatPanel = vscode.window.createWebviewPanel(
    "noraopsAiChat",
    title,
    vscode.ViewColumn.Active,
    {
      enableScripts: false,
      retainContextWhenHidden: true,
      localResourceRoots: [],
    }
  );

  aiChatPanel.webview.html = buildAiChatHtml(urlString);
  aiChatPanel.onDidDispose(() => {
    aiChatPanel = undefined;
  });

  return "webview-create";
}

module.exports = {
  openAiChatBrowserPanel,
  buildAiChatHtml,
};
