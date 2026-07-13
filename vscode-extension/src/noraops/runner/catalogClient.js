const { getNoraOpsConfig } = require("../config");
const { fetchPublishedCatalog } = require("../portalApi");

async function searchPublishedApps(query, options = {}) {
  const { serverBaseUrl } = getNoraOpsConfig();
  return fetchPublishedCatalog(serverBaseUrl, query || "", options);
}

module.exports = { searchPublishedApps };
