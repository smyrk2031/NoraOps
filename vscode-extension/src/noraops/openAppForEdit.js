const fs = require("fs");
const path = require("path");
const vscode = require("vscode");
const { getNoraOpsConfig } = require("./config");
const { fetchPublishedAppDetail } = require("./portalApi");
const { downloadAndExtractArtifact, devAppsRoot, cacheKey } = require("./artifactDownload");

async function openPublishedAppForEdit(owner, name) {
  const cfg = getNoraOpsConfig();
  if (!cfg.serverBaseUrl) {
    throw new Error("noraops.server.baseUrl が未設定です。");
  }

  const detail = await fetchPublishedAppDetail(cfg.serverBaseUrl, owner, name);
  const { createPushSession } = require("./noraopsApi");
  const session = await createPushSession(cfg.serverBaseUrl, cfg.deviceLabel, "read");
  const token = session.pushToken;
  if (!token) throw new Error("read session token missing");

  const dest = path.join(devAppsRoot(), cacheKey(owner, name));
  if (fs.existsSync(dest)) {
    fs.rmSync(dest, { recursive: true, force: true });
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  await downloadAndExtractArtifact(cfg.serverBaseUrl, owner, name, dest, token);

  const wsCfg = vscode.workspace.getConfiguration("noraops");
  await wsCfg.update("mode", "creator", vscode.ConfigurationTarget.Global);

  await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(dest), false);
  vscode.window.showInformationMessage(
    `開発用ワークスペースを開きました: ${detail.full_name || `${owner}/${name}`}`
  );
  return dest;
}

module.exports = { openPublishedAppForEdit };
