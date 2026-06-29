const { getServerBaseUrl } = require("./config");
const { requestJson } = require("./noraopsApi");

/**
 * Runner 利用などをサーバーへ記録（失敗しても UI は止めない）。
 */
async function logRunnerActivity(appFullName, action = "launch", extra = {}) {
  const base = getServerBaseUrl();
  if (!base || !appFullName) return;
  try {
    const user =
      (typeof process !== "undefined" && process.env && process.env.USERNAME) ||
      (typeof process !== "undefined" && process.env && process.env.USER) ||
      "";
    await requestJson("POST", `${base.replace(/\/$/, "")}/api/v1/portal/runner-activity`, {
      app_full_name: appFullName,
      action,
      user_label: user,
      payload: extra,
    });
  } catch {
    /* ignore */
  }
}

module.exports = { logRunnerActivity };
