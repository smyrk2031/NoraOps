const vscode = require("vscode");

const SESSION_KEY = "noraops.sessionToken";

/** @type {import('vscode').ExtensionContext | null} */
let _context = null;
/** @type {string} */
let _cachedToken = "";

function bindExtensionContext(context) {
  _context = context;
}

async function loadSessionToken() {
  if (!_context) {
    _cachedToken = "";
    return "";
  }
  _cachedToken = (await _context.secrets.get(SESSION_KEY)) || "";
  return _cachedToken;
}

function getSessionToken() {
  return _cachedToken || "";
}

async function setSessionToken(token) {
  if (!_context) return;
  const v = (token || "").trim();
  if (v) {
    await _context.secrets.store(SESSION_KEY, v);
    _cachedToken = v;
  } else {
    await _context.secrets.delete(SESSION_KEY);
    _cachedToken = "";
  }
}

async function clearSessionToken() {
  await setSessionToken("");
}

async function requestOtp(serverBaseUrl, email) {
  const { requestJson } = require("./noraopsApi");
  const base = serverBaseUrl.replace(/\/$/, "");
  const { status, json } = await requestJson("POST", `${base}/api/v1/noraops/auth/otp/request`, {
    email: String(email || "").trim(),
  });
  if (status >= 400) {
    const d = json?.detail;
    const msg = typeof d === "string" ? d : `otp/request HTTP ${status}`;
    throw new Error(msg);
  }
  return json;
}

async function verifyOtp(serverBaseUrl, email, otp) {
  const { requestJson } = require("./noraopsApi");
  const base = serverBaseUrl.replace(/\/$/, "");
  const { status, json } = await requestJson("POST", `${base}/api/v1/noraops/auth/otp/verify`, {
    email: String(email || "").trim(),
    otp: String(otp || "").trim(),
  });
  if (status >= 400) {
    const d = json?.detail;
    const msg = typeof d === "string" ? d : d?.message || `otp/verify HTTP ${status}`;
    throw new Error(msg);
  }
  const token = json?.sessionToken;
  if (!token) throw new Error("sessionToken missing in response");
  await setSessionToken(token);
  return json;
}

async function logout(serverBaseUrl) {
  const { requestJson, getAuthHeaders } = require("./noraopsApi");
  const base = serverBaseUrl.replace(/\/$/, "");
  try {
    await requestJson("POST", `${base}/api/v1/noraops/auth/logout`, null, await getAuthHeaders());
  } catch {
    /* ignore */
  }
  await clearSessionToken();
}

async function loginOtpInteractive(serverBaseUrl) {
  const email = await vscode.window.showInputBox({
    title: "NoraOps メールログイン",
    prompt: "社内メールアドレスを入力してください。6桁コードが送信されます。",
    placeHolder: "you@corp.example.com",
    validateInput: (v) => {
      const s = (v || "").trim();
      if (!s.includes("@")) return "メールアドレスを入力してください";
      return null;
    },
  });
  if (!email) return { ok: false, cancelled: true };

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "NoraOps: OTP 送信" },
    () => requestOtp(serverBaseUrl, email)
  );

  const otp = await vscode.window.showInputBox({
    title: "NoraOps メールログイン",
    prompt: "メールに届いた6桁コードを入力してください。",
    placeHolder: "123456",
    password: true,
    validateInput: (v) => {
      const s = (v || "").trim();
      if (s.length !== 6 || !/^\d+$/.test(s)) return "6桁の数字を入力してください";
      return null;
    },
  });
  if (!otp) return { ok: false, cancelled: true };

  const result = await verifyOtp(serverBaseUrl, email, otp);
  return { ok: true, ...result };
}

module.exports = {
  bindExtensionContext,
  loadSessionToken,
  getSessionToken,
  setSessionToken,
  clearSessionToken,
  requestOtp,
  verifyOtp,
  logout,
  loginOtpInteractive,
};
