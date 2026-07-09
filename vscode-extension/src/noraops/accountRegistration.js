const { getAuthHeaders } = require("./authHeaders");
const { hasAccessToken } = require("./accessTokenAuth");
const { requestJson } = require("./noraopsApi");

/**
 * @typedef {"pending_email"|"pending_activation"|"provision_incomplete"|"provisioned"|"not_required"|"unknown"} RegistrationStatus
 */

async function fetchRegistrationStatus(serverBaseUrl) {
  const base = (serverBaseUrl || "").replace(/\/$/, "");
  if (!base) return { ok: false, error: "serverBaseUrl missing" };
  const headers = await getAuthHeaders();
  const { status, json } = await requestJson(
    "GET",
    `${base}/api/v1/noraops/auth/registration-status`,
    null,
    { headers }
  );
  if (status >= 400) {
    const d = json?.detail;
    const msg = typeof d === "string" ? d : d?.message || `registration-status HTTP ${status}`;
    return { ok: false, error: msg, status };
  }
  return { ok: true, ...json };
}

async function validateAccessTokenWithServer(serverBaseUrl) {
  const base = (serverBaseUrl || "").replace(/\/$/, "");
  if (!base) return { ok: false, reason: "serverBaseUrl missing" };
  if (!hasAccessToken()) return { ok: false, reason: "not_configured" };
  const headers = await getAuthHeaders();
  const { status, json } = await requestJson(
    "GET",
    `${base}/api/v1/noraops/auth/me`,
    null,
    { headers }
  );
  if (status === 401 || status === 403) {
    return { ok: false, reason: "invalid", status, detail: json?.detail };
  }
  if (status >= 400) {
    const d = json?.detail;
    const msg = typeof d === "string" ? d : d?.message || `me HTTP ${status}`;
    return { ok: false, reason: "error", status, detail: msg };
  }
  const provisioned = Boolean(json?.provisioned);
  return { ok: true, provisioned, registrationStatus: json?.registrationStatus };
}

async function registerUserEmail(serverBaseUrl, email) {
  const base = (serverBaseUrl || "").replace(/\/$/, "");
  const { status, json } = await requestJson(
    "POST",
    `${base}/api/v1/noraops/auth/register-email`,
    { email: String(email || "").trim() }
  );
  if (status >= 400) {
    const d = json?.detail;
    const msg = typeof d === "string" ? d : d?.message || `register-email HTTP ${status}`;
    throw new Error(msg);
  }
  return json;
}

async function reissueAccessToken(serverBaseUrl, email) {
  const base = (serverBaseUrl || "").replace(/\/$/, "");
  const { status, json } = await requestJson(
    "POST",
    `${base}/api/v1/noraops/auth/reissue-access-token`,
    { email: String(email || "").trim() }
  );
  if (status >= 400) {
    const d = json?.detail;
    const msg = typeof d === "string" ? d : d?.message || `reissue-access-token HTTP ${status}`;
    throw new Error(msg);
  }
  return json;
}

async function retryGiteaProvision(serverBaseUrl, email) {
  const base = (serverBaseUrl || "").replace(/\/$/, "");
  const { status, json } = await requestJson(
    "POST",
    `${base}/api/v1/noraops/auth/retry-gitea-provision`,
    { email: String(email || "").trim() }
  );
  if (status >= 400) {
    const d = json?.detail;
    const msg = typeof d === "string" ? d : d?.message || `retry-gitea-provision HTTP ${status}`;
    throw new Error(msg);
  }
  return json;
}

function registrationStatusLabel(status, requiresEmail, requiresAccessToken) {
  if (!requiresEmail) {
    return { ok: true, title: "アカウント", detail: "メール登録不要（open モード）", lamp: "ok" };
  }
  switch (status) {
    case "provisioned":
      if (requiresAccessToken && !hasAccessToken()) {
        return {
          ok: false,
          title: "アカウント",
          detail: "登録済み — NoraAccessToken を Setting に貼り付けてください",
          lamp: "warn",
        };
      }
      return { ok: true, title: "アカウント", detail: "登録完了 — 保存・実行が利用できます", lamp: "ok" };
    case "provision_incomplete":
      return {
        ok: false,
        title: "アカウント",
        detail: "Gitea 登録未完了 — メール再送または Gitea 登録の再試行ができます",
        lamp: "warn",
      };
    case "pending_activation":
      return {
        ok: false,
        title: "アカウント",
        detail: "メール確認待ち — URL を開いてトークンを取得してください",
        lamp: "warn",
      };
    case "pending_email":
      return {
        ok: false,
        title: "アカウント",
        detail: "初回登録: メールアドレスを入力して登録してください",
        lamp: "ng",
      };
    default:
      return { ok: false, title: "アカウント", detail: "登録状態を確認できません", lamp: "muted" };
  }
}

module.exports = {
  fetchRegistrationStatus,
  validateAccessTokenWithServer,
  registerUserEmail,
  reissueAccessToken,
  retryGiteaProvision,
  registrationStatusLabel,
  hasAccessToken,
};
