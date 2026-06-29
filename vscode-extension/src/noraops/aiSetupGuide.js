const vscode = require("vscode");
const { requestJson } = require("./noraopsApi");
const { getNoraOpsConfig } = require("./config");

async function fetchAiSetupGuide() {
  const { serverBaseUrl } = getNoraOpsConfig();
  if (!serverBaseUrl) return null;
  try {
    const { status, json } = await requestJson(
      "GET",
      `${serverBaseUrl.replace(/\/$/, "")}/api/v1/noraops/ai/setup-guide`
    );
    if (status === 200) return json;
  } catch {
    /* ignore */
  }
  return null;
}

function fallbackHelpUrl() {
  const { serverBaseUrl } = getNoraOpsConfig();
  const base = (serverBaseUrl || "").replace(/\/$/, "");
  return base ? `${base}/help?t=secure-ai` : "";
}

async function resolveHelpUrl() {
  const guide = await fetchAiSetupGuide();
  return guide?.helpUrl || fallbackHelpUrl();
}

async function openAiSetupHelp(options = {}) {
  const url = options.url || (await resolveHelpUrl());
  if (!url) {
    vscode.window.showWarningMessage("サーバー URL が未設定です。NoraOps 接続設定を確認してください。");
    return { ok: false };
  }
  await vscode.env.openExternal(vscode.Uri.parse(url));
  return { ok: true, url };
}

function modalWithHelp(base, extra = {}) {
  return { ...base, ...extra, offerHelp: true };
}

module.exports = {
  fetchAiSetupGuide,
  fallbackHelpUrl,
  resolveHelpUrl,
  openAiSetupHelp,
  modalWithHelp,
};
