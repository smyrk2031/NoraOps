const vscode = require("vscode");

const ACCESS_KEY = "noraops.accessToken";

/** @type {import('vscode').ExtensionContext | null} */
let _context = null;
/** @type {string} */
let _cachedToken = "";

function bindExtensionContext(context) {
  _context = context;
}

async function loadAccessToken() {
  if (!_context) {
    _cachedToken = "";
    return "";
  }
  const fromSecret = (await _context.secrets.get(ACCESS_KEY)) || "";
  const fromConfig = (vscode.workspace.getConfiguration("noraops").get("accessToken") || "").trim();
  _cachedToken = fromSecret || fromConfig;
  return _cachedToken;
}

function getAccessToken() {
  return _cachedToken || "";
}

async function setAccessToken(token) {
  const v = (token || "").trim();
  if (_context) {
    if (v) {
      await _context.secrets.store(ACCESS_KEY, v);
    } else {
      await _context.secrets.delete(ACCESS_KEY);
    }
  }
  const cfg = vscode.workspace.getConfiguration("noraops");
  await cfg.update("accessToken", v, vscode.ConfigurationTarget.Global);
  _cachedToken = v;
}

async function clearAccessToken() {
  await setAccessToken("");
}

function hasAccessToken() {
  return Boolean((getAccessToken() || "").trim());
}

function maskedAccessTokenHint() {
  const token = (getAccessToken() || "").trim();
  if (!token) return "";
  if (token.length <= 8) return "••••";
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

module.exports = {
  bindExtensionContext,
  loadAccessToken,
  getAccessToken,
  setAccessToken,
  clearAccessToken,
  hasAccessToken,
  maskedAccessTokenHint,
};
