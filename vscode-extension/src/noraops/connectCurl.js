/**
 * Connect プロファイル → curl コマンド文字列
 */

function shellEscapeSingle(value) {
  return `'${String(value ?? "").replace(/'/g, `'\\''`)}'`;
}

/**
 * @param {{ method?: string, url?: string, headers?: {key:string,value:string}[], body?: string, contentType?: string }} profile
 */
function buildCurlCommand(profile) {
  const method = String(profile.method || "GET").toUpperCase();
  const url = String(profile.url || "").trim();
  if (!url) throw new Error("URL が空です");
  const parts = ["curl", "-sS", "-X", method, shellEscapeSingle(url)];
  const headers = Array.isArray(profile.headers) ? profile.headers : [];
  const hasContentType = headers.some((h) => String(h.key || "").toLowerCase() === "content-type");
  for (const h of headers) {
    const key = String(h.key || "").trim();
    if (!key) continue;
    parts.push("-H", shellEscapeSingle(`${key}: ${h.value ?? ""}`));
  }
  if (method === "POST") {
    const body = String(profile.body ?? "");
    if (!hasContentType && profile.contentType) {
      parts.push("-H", shellEscapeSingle(`Content-Type: ${profile.contentType}`));
    }
    if (body.length) {
      parts.push("-d", shellEscapeSingle(body));
    }
  }
  return parts.join(" ");
}

module.exports = {
  buildCurlCommand,
  shellEscapeSingle,
};
