const vscode = require("vscode");

const TOKEN_KEY = "noraops.deviceToken";

/** @type {import('vscode').ExtensionContext | null} */
let _context = null;

function bindExtensionContext(context) {
  _context = context;
}

function getDeviceToken() {
  return (_context && _context.globalState.get(TOKEN_KEY)) || "";
}

async function setDeviceToken(token) {
  if (!_context) return;
  await _context.globalState.update(TOKEN_KEY, token || "");
}

async function clearDeviceToken() {
  await setDeviceToken("");
}

async function exchangeDeviceCode(serverBaseUrl, code) {
  const { requestJson } = require("./noraopsApi");
  const base = serverBaseUrl.replace(/\/$/, "");
  const { status, json } = await requestJson(
    "POST",
    `${base}/api/v1/noraops/auth/device-exchange`,
    { code: String(code || "").trim() }
  );
  if (status >= 400) {
    const d = json?.detail;
    const msg = typeof d === "string" ? d : `device-exchange HTTP ${status}`;
    throw new Error(msg);
  }
  const token = json?.deviceToken;
  if (!token) throw new Error("deviceToken missing in response");
  await setDeviceToken(token);
  return token;
}

async function registerDeviceInteractive(serverBaseUrl) {
  const code = await vscode.window.showInputBox({
    title: "NoraOps デバイス登録",
    prompt:
      "ポータル（IIS 認証済みブラウザ）で発行した 6 桁コードを入力してください。",
    placeHolder: "123456",
    validateInput: (v) => {
      const s = (v || "").trim();
      if (s.length < 4) return "コードを入力してください";
      return null;
    },
  });
  if (!code) return { ok: false, cancelled: true };
  const token = await exchangeDeviceCode(serverBaseUrl, code);
  return { ok: true, deviceToken: token };
}

module.exports = {
  bindExtensionContext,
  getDeviceToken,
  setDeviceToken,
  clearDeviceToken,
  exchangeDeviceCode,
  registerDeviceInteractive,
};
