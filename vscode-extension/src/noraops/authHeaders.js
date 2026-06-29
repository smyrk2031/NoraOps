const { getAccessToken } = require("./accessTokenAuth");

async function getAuthHeaders() {
  const headers = {};
  const access = getAccessToken();
  if (access) {
    headers["X-NoraOps-Access-Token"] = access;
    return headers;
  }
  try {
    const { getSessionToken } = require("./sessionAuth");
    const session = getSessionToken();
    if (session) headers["X-NoraOps-Session-Token"] = session;
  } catch {
    /* ignore */
  }
  try {
    const { getDeviceToken } = require("./deviceAuth");
    const device = getDeviceToken();
    if (device) headers["X-NoraOps-Device-Token"] = device;
  } catch {
    /* ignore */
  }
  return headers;
}

module.exports = { getAuthHeaders };
