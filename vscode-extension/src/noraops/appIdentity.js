const crypto = require("crypto");
const { packageNameSlug } = require("./pathsMeta");

/** 不変のアプリ ID（UUID）。リポ名とは別。 */
function newAppId() {
  return `nora.app.${crypto.randomUUID()}`;
}

function normalizeAppId(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  return s.startsWith("nora.app.") ? s : `nora.app.${s}`;
}

/** ユーザーが付けた名前 → Gitea リポ slug 候補 */
function repoSlugFromLabel(label) {
  return packageNameSlug(label);
}

module.exports = { newAppId, normalizeAppId, repoSlugFromLabel };
