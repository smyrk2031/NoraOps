const vscode = require("vscode");
const { getNoraOpsConfig } = require("./config");
const { fetchClientLatest } = require("./portalApi");

function parseVersion(v) {
  const parts = String(v || "0")
    .split(".")
    .map((n) => parseInt(n, 10) || 0);
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

function isNewer(remote, local) {
  const a = parseVersion(remote);
  const b = parseVersion(local);
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}

async function checkExtensionUpdate(context, options = {}) {
  const cfg = getNoraOpsConfig();
  if (cfg.clientUpdateCheck === false) return null;

  const ext = vscode.extensions.getExtension("softrail.noraops4code");
  const localVersion = ext?.packageJSON?.version || "0.0.0";

  let remote;
  try {
    remote = await fetchClientLatest(cfg.serverBaseUrl);
  } catch (e) {
    if (!options.silent) {
      vscode.window.showWarningMessage(`拡張の更新確認に失敗: ${e.message}`);
    }
    return null;
  }

  if (!remote?.version || !isNewer(remote.version, localVersion)) {
    if (options.showCurrent) {
      vscode.window.showInformationMessage(`NoraOps4code ${localVersion}（最新です）`);
    }
    return null;
  }

  const notes = remote.releaseNotes ? `\n${remote.releaseNotes}` : "";
  const pick = await vscode.window.showInformationMessage(
    `NoraOps4code の新しい版があります: ${remote.version}（いま ${localVersion}）${notes}`,
    "ダウンロードを開く",
    "あとで"
  );
  if (pick === "ダウンロードを開く" && remote.vsixUrl) {
    await vscode.env.openExternal(vscode.Uri.parse(remote.vsixUrl));
  }
  return remote;
}

module.exports = { checkExtensionUpdate, isNewer };
