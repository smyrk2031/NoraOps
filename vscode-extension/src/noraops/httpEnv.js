/**
 * プロキシ環境の検出（拡張プロセスの環境変数）。
 * Node の http.request は既定で HTTP_PROXY を使わないが、
 * 運用・トラブルシュートの説明用に収集する。
 */

const { getNoraOpsProxySettings } = require("./proxySettings");

function readProxyEnv() {
  return {
    HTTP_PROXY: process.env.HTTP_PROXY || process.env.http_proxy || "",
    HTTPS_PROXY: process.env.HTTPS_PROXY || process.env.https_proxy || "",
    NO_PROXY: process.env.NO_PROXY || process.env.no_proxy || "",
  };
}

/** OS 環境変数 + NoraOps 設定タブのプロキシ（NoraOps 優先） */
function readEffectiveProxyEnv() {
  const os = readProxyEnv();
  let nora = { HTTP_PROXY: "", HTTPS_PROXY: "" };
  try {
    nora = getNoraOpsProxySettings();
  } catch {
    /* vscode 未初期化時 */
  }
  return {
    HTTP_PROXY: nora.HTTP_PROXY || os.HTTP_PROXY,
    HTTPS_PROXY: nora.HTTPS_PROXY || os.HTTPS_PROXY,
    NO_PROXY: os.NO_PROXY,
  };
}

/** uv / 子プロセス用（Creator・Runner の venv 構築など） */
function buildChildProcessEnv(extra = {}) {
  const proxy = readEffectiveProxyEnv();
  const env = { ...process.env, ...extra };
  if (proxy.HTTP_PROXY) {
    env.HTTP_PROXY = proxy.HTTP_PROXY;
    env.http_proxy = proxy.HTTP_PROXY;
  }
  if (proxy.HTTPS_PROXY) {
    env.HTTPS_PROXY = proxy.HTTPS_PROXY;
    env.https_proxy = proxy.HTTPS_PROXY;
  }
  if (proxy.NO_PROXY) {
    env.NO_PROXY = proxy.NO_PROXY;
    env.no_proxy = proxy.NO_PROXY;
  }
  return env;
}

function hasSystemProxy() {
  const p = readEffectiveProxyEnv();
  return !!(p.HTTP_PROXY || p.HTTPS_PROXY);
}

function isPrivateOrLocalHost(hostname) {
  const h = String(hostname || "").toLowerCase();
  if (!h || h === "localhost") return true;
  if (h.endsWith(".local")) return true;
  if (/^127\./.test(h)) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  const m = /^172\.(\d+)\./.exec(h);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n >= 16 && n <= 31) return true;
  }
  return false;
}

function proxyHintsForUrl(urlString) {
  const hints = [];
  const proxy = readProxyEnv();
  if (!proxy.HTTP_PROXY && !proxy.HTTPS_PROXY) {
    return hints;
  }
  try {
    const u = new URL(urlString);
    if (isPrivateOrLocalHost(u.hostname)) {
      hints.push(
        "この PC に HTTP_PROXY / HTTPS_PROXY が設定されています。NoraOps 拡張の API 呼び出しは直接接続ですが、他ツールやブラウザと挙動が異なることがあります。"
      );
      hints.push(
        `社内サーバー (${u.hostname}) へは NO_PROXY に追加する運用が一般的です: 例 NO_PROXY=127.0.0.1,localhost,10.*,192.168.*`
      );
    }
  } catch {
    /* ignore */
  }
  hints.push(
    "FastAPI サーバー側: nora-backend は httpx の trust_env を既定 OFF（NORAOPS_HTTP_TRUST_ENV=0）。Gitea/Azure がプロキシに奪われにくくなっています。"
  );
  return hints;
}

function formatRequestError(err, url) {
  const code = err?.code || "";
  const msg = err?.message || String(err);
  if (code === "UNABLE_TO_VERIFY_LEGO" || /certificate|cert|SSL|TLS/i.test(msg)) {
    return (
      `TLS 証明書エラー: ${msg}\n` +
      "社内 CA の HTTPS では OS にルート証明書を入れるか、検証用に http で試してください。"
    );
  }
  if (code === "ECONNREFUSED") {
    return `接続拒否 (${url}): サーバー未起動・ポート・IIS リライトを確認`;
  }
  if (code === "ENOTFOUND") {
    return `ホスト名を解決できません: DNS または URL の誤り`;
  }
  if (/timeout/i.test(msg) || code === "ETIMEDOUT") {
    return `タイムアウト: ファイアウォール・プロキシ・サーバー負荷を確認`;
  }
  if (/407|Proxy Authentication/i.test(msg)) {
    return `プロキシ認証が必要です。社内 NoraOps サーバー URL は NO_PROXY に含めて直接接続してください。`;
  }
  return msg;
}

module.exports = {
  readProxyEnv,
  readEffectiveProxyEnv,
  buildChildProcessEnv,
  hasSystemProxy,
  isPrivateOrLocalHost,
  proxyHintsForUrl,
  formatRequestError,
};
