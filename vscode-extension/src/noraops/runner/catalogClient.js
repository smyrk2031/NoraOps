const { getNoraOpsConfig } = require("../config");
const { fetchPublishedCatalog } = require("../portalApi");

async function searchPublishedApps(query) {
  const { serverBaseUrl } = getNoraOpsConfig();
  return fetchPublishedCatalog(serverBaseUrl, query || "");
}

module.exports = { searchPublishedApps };
