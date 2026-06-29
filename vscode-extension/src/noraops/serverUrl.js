/** NoraOps サーバー URL の正規化（リバースプロキシ・サブパス対応） */

const DEFAULT_DEV_URL = "http://127.0.0.1:8000";

const DEPLOYMENT_SCENARIOS = [
  {
    id: "local",
    title: "ローカル開発",
    example: "http://127.0.0.1:8000",
    hint: "uvicorn を直接起動しているとき。ブラウザで同じ URL のトップが開ければ OK。",
  },
  {
    id: "lan",
    title: "社内 IP（HTTP）",
    example: "http://192.168.1.50",
    hint: "Win Server や Linux に FastAPI を置き、社内から IP でアクセスする場合。",
  },
  {
    id: "https",
    title: "HTTPS（証明書付き）",
    example: "https://noraops.contoso.local",
    hint: "IIS / リバースプロキシで TLS 終端している場合。ブラウザの鍵マークと同じ URL。",
  },
  {
    id: "subpath",
    title: "IIS + ARR（サブパス /NoraOps など）",
    example: "https://intranet.example.com/NoraOps",
    hint:
      "ポータルのトップが開ける URL をそのまま入力。拡張は {URL}/api/v1/... に接続します。IIS では /NoraOps/* → uvicorn へリライトし、/api まで届くよう設定してください。",
  },
];

/**
 * ユーザーがブラウザで開ける「ポータル URL」を API ベース URL に正規化
 * @param {string} input
 */
function normalizePortalUrl(input) {
  let raw = String(input || "").trim();
  if (!raw) {
    return { ok: false, error: "URL を入力してください。" };
  }
  if (!/^https?:\/\//i.test(raw)) {
    raw = `http://${raw}`;
  }
  let u;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, error: "URL の形式が読み取れません。" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, error: "http または https の URL を指定してください。" };
  }

  let path = u.pathname.replace(/\/+$/, "") || "";
  // 誤って API まで貼った場合はベースに戻す
  path = path.replace(/\/api(\/v1)?(\/.*)?$/i, "");

  const baseUrl = `${u.protocol}//${u.host}${path}`.replace(/\/$/, "");
  const pathPrefix = path || "";

  return {
    ok: true,
    baseUrl,
    portalUrl: baseUrl,
    host: u.hostname,
    pathPrefix,
    isHttps: u.protocol === "https:",
    isLocalhost: /^(localhost|127\.0\.0\.1)$/i.test(u.hostname),
    scenarioHint: guessScenario(baseUrl),
  };
}

function guessScenario(baseUrl) {
  try {
    const u = new URL(baseUrl);
    if (/^(localhost|127\.0\.0\.1)$/i.test(u.hostname)) return "local";
    if (u.pathname && u.pathname !== "/" && u.pathname.length > 1) return "subpath";
    if (u.protocol === "https:") return "https";
    return "lan";
  } catch {
    return "local";
  }
}

function apiUrl(baseUrl, apiPath) {
  const base = (baseUrl || "").replace(/\/$/, "");
  const p = apiPath.startsWith("/") ? apiPath : `/${apiPath}`;
  return `${base}${p}`;
}

function isDefaultDevUrl(url) {
  const n = normalizePortalUrl(url || DEFAULT_DEV_URL);
  return n.ok && n.baseUrl === DEFAULT_DEV_URL;
}

module.exports = {
  DEFAULT_DEV_URL,
  DEPLOYMENT_SCENARIOS,
  normalizePortalUrl,
  apiUrl,
  isDefaultDevUrl,
  guessScenario,
};
