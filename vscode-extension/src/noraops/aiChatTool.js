const vscode = require("vscode");
const { openAiChatBrowserPanel } = require("./aiChatBrowserPanel");

function getAiChatUrl() {
  const cfg = vscode.workspace.getConfiguration("noraops");
  return String(cfg.get("aiChat.url") || "").trim();
}

function normalizeAiChatUrl(raw) {
  const s = String(raw || "").trim();
  if (!s) return { ok: false, error: "URL を入力してください。" };
  let url = s;
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return { ok: false, error: "http または https の URL を指定してください。" };
    }
    return { ok: true, url: u.toString() };
  } catch {
    return { ok: false, error: "URL の形式が正しくありません。" };
  }
}

async function saveAiChatUrl(raw) {
  const norm = normalizeAiChatUrl(raw);
  if (!norm.ok) {
    throw new Error(norm.error);
  }
  const cfg = vscode.workspace.getConfiguration("noraops");
  await cfg.update("aiChat.url", norm.url, vscode.ConfigurationTarget.Global);
  return norm.url;
}

/**
 * IDE 内で AI チャット URL を開く（環境に応じて手段を切り替え）。
 * 1. simpleBrowser.show（VS Code）
 * 2. workbench.action.browser.open（統合ブラウザ / Cursor 等）
 * 3. NoraOps 自前 Webview（iframe）
 * 4. 外部ブラウザ
 * @param {string} urlString
 */
async function openAiChatInIde(urlString) {
  try {
    await vscode.commands.executeCommand("simpleBrowser.show", urlString);
    return "simpleBrowser.show";
  } catch {
    /* Cursor 等では未提供のことが多い */
  }

  try {
    await vscode.commands.executeCommand("workbench.action.browser.open", urlString);
    return "integratedBrowser";
  } catch {
    /* 統合ブラウザ未対応 or DI エラー */
  }

  try {
    return openAiChatBrowserPanel(urlString);
  } catch {
    /* webview 作成失敗 */
  }

  const opened = await vscode.env.openExternal(vscode.Uri.parse(urlString));
  if (opened) {
    return "externalBrowser";
  }

  throw new Error("IDE 内・外部ブラウザのいずれでも開けませんでした。");
}

/**
 * 設定済み URL で AI チャットを開く。
 * @param {{ revealSetup?: boolean, context?: import('vscode').ExtensionContext }} [options]
 */
async function openAiChatToolBeside(options = {}) {
  const raw = getAiChatUrl();
  if (!raw) {
    if (options.revealSetup !== false && options.context) {
      const pick = await vscode.window.showWarningMessage(
        "AI チャットツールの URL が未設定です",
        {
          modal: true,
          detail:
            "NoraOps Setting の「AI チャットツール URL」に ChatGPT 等の URL を設定してください。",
        },
        "Setting を開く"
      );
      if (pick === "Setting を開く") {
        await focusAiChatSettingInSetup(options.context);
      }
    }
    return { ok: false, reason: "not_configured" };
  }

  const norm = normalizeAiChatUrl(raw);
  if (!norm.ok) {
    vscode.window.showErrorMessage(norm.error);
    return { ok: false, reason: "invalid_url" };
  }

  try {
    const mode = await openAiChatInIde(norm.url);
    if (mode === "externalBrowser") {
      vscode.window.showInformationMessage(
        "この環境では Simple Browser が使えないため、外部ブラウザで開きました。"
      );
    }
    return { ok: true, url: norm.url, mode };
  } catch (e) {
    vscode.window.showErrorMessage(`AI チャットを開けませんでした: ${e.message}`);
    return { ok: false, reason: "open_failed", message: e.message };
  }
}

async function focusAiChatSettingInSetup(context) {
  const { showNoraOpsView } = require("./noraOpsShell");
  const panel = await showNoraOpsView(context, "setup");
  if (panel?.webview) {
    panel.webview.postMessage({ type: "focusAiChatSetting" });
  }
}

module.exports = {
  getAiChatUrl,
  normalizeAiChatUrl,
  saveAiChatUrl,
  openAiChatInIde,
  openAiChatToolBeside,
  focusAiChatSettingInSetup,
};
