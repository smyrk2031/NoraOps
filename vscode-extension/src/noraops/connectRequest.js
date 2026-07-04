/**
 * Connect タブ — 任意 URL への HTTP GET/POST 実行
 */

const http = require("http");
const https = require("https");
const { formatRequestError } = require("./httpEnv");
const {
  parseContentDisposition,
  isTextContentType,
  looksBinaryBuffer,
} = require("./connectRequestUtil");

const MAX_BODY_BYTES = 10 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30000;

function buildRequestHeaders(profile) {
  const headers = { Accept: "*/*" };
  const method = (profile.method || "GET").toUpperCase();
  if (method === "POST") {
    headers["Content-Type"] = profile.contentType || "application/json";
  }
  for (const row of profile.headers || []) {
    if (row?.key) headers[row.key] = String(row.value ?? "");
  }
  return headers;
}

/**
 * @param {object} profile
 * @param {{ timeoutMs?: number }} [options]
 */
function executeConnectRequest(profile, options = {}) {
  const method = (profile.method || "GET").toUpperCase();
  const urlStr = String(profile.url || "").trim();
  if (!urlStr) return Promise.reject(new Error("URL が空です"));
  let u;
  try {
    u = new URL(urlStr);
  } catch {
    return Promise.reject(new Error("URL の形式が不正です"));
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return Promise.reject(new Error("http / https のみ対応しています"));
  }

  const lib = u.protocol === "https:" ? https : http;
  const headers = buildRequestHeaders(profile);
  let payload = null;
  if (method === "POST") {
    const body = String(profile.body ?? "");
    if (body.length) {
      payload = Buffer.from(body, "utf8");
      if (!headers["Content-Length"]) headers["Content-Length"] = String(payload.length);
    }
  }

  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const started = Date.now();

  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname + u.search,
        method,
        headers,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        let total = 0;
        let truncated = false;
        res.on("data", (chunk) => {
          total += chunk.length;
          if (total > MAX_BODY_BYTES) {
            truncated = true;
            const room = MAX_BODY_BYTES - (total - chunk.length);
            if (room > 0) chunks.push(chunk.subarray(0, room));
            res.destroy();
            return;
          }
          chunks.push(chunk);
        });
        const finish = () => {
          const buf = Buffer.concat(chunks);
          const contentType = res.headers["content-type"] || "";
          const disposition = res.headers["content-disposition"];
          const suggestedFilename = parseContentDisposition(disposition);
          const status = res.statusCode || 0;
          const respHeaders = { ...res.headers };
          const binary =
            !!suggestedFilename ||
            (!isTextContentType(contentType) && (looksBinaryBuffer(buf) || buf.length > 0));
          let bodyText = null;
          let bodyBase64 = null;
          if (binary) {
            bodyBase64 = buf.toString("base64");
          } else {
            bodyText = buf.toString("utf8");
            try {
              const parsed = JSON.parse(bodyText);
              bodyText = JSON.stringify(parsed, null, 2);
            } catch {
              /* plain text */
            }
          }
          resolve({
            ok: status >= 200 && status < 300,
            status,
            statusText: res.statusMessage || "",
            durationMs: Date.now() - started,
            contentType,
            headers: respHeaders,
            bodyText,
            isBinary: binary,
            bodyBase64,
            suggestedFilename,
            bodySize: buf.length,
            truncated,
          });
        };
        res.on("end", finish);
        res.on("close", finish);
      }
    );
    req.on("error", (err) => reject(new Error(formatRequestError(err, urlStr))));
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("タイムアウト（30秒）"));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

module.exports = {
  executeConnectRequest,
  MAX_BODY_BYTES,
  parseContentDisposition,
  isTextContentType,
};
