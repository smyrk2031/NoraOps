/**
 * 基本プロンプトカタログのバージョン比較
 */

const { compareSemver } = require("../toolManager");
const { getCatalogVersion } = require("./builtinPromptCatalog");

function isCatalogVersionNewer(remoteVer, localVer) {
  const local = localVer || getCatalogVersion();
  if (!remoteVer || !local) return false;
  try {
    return compareSemver(String(remoteVer), String(local)) > 0;
  } catch {
    return String(remoteVer) !== String(local);
  }
}

module.exports = { isCatalogVersionNewer };
