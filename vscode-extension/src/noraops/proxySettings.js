const vscode = require("vscode");

function getNoraOpsProxySettings() {
  const cfg = vscode.workspace.getConfiguration("noraops");
  return {
    HTTP_PROXY: String(cfg.get("proxy.httpUrl") || "").trim(),
    HTTPS_PROXY: String(cfg.get("proxy.httpsUrl") || "").trim(),
  };
}

async function saveNoraOpsProxy(httpUrl, httpsUrl) {
  const cfg = vscode.workspace.getConfiguration("noraops");
  await cfg.update("proxy.httpUrl", String(httpUrl || "").trim(), vscode.ConfigurationTarget.Global);
  await cfg.update("proxy.httpsUrl", String(httpsUrl || "").trim(), vscode.ConfigurationTarget.Global);
}

module.exports = { getNoraOpsProxySettings, saveNoraOpsProxy };
