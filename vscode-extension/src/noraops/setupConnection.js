/**
 * NoraOps サーバー接続テスト（設定パネル・初回セットアップ用）
 */
const { requestJson } = require("./noraopsApi");
const { apiUrl, normalizePortalUrl } = require("./serverUrl");
const { refreshRuntimeConfig } = require("./runtimeConfig");
const { readProxyEnv, hasSystemProxy, proxyHintsForUrl, isPrivateOrLocalHost } = require("./httpEnv");

function step(id, name, ok, detail = "", hint = "") {
  return { id, name, ok, detail, hint };
}

/**
 * @param {string} portalUrlInput ユーザー入力（ポータルトップ URL）
 */
async function testServerConnection(portalUrlInput) {
  const norm = normalizePortalUrl(portalUrlInput);
  if (!norm.ok) {
    return {
      ok: false,
      baseUrl: null,
      portalUrl: portalUrlInput,
      error: norm.error,
      checks: [],
    };
  }

  const base = norm.baseUrl;
  const checks = [];

  checks.push(
    step("normalize", "URL 解釈", true, `接続先: ${base}`, norm.pathPrefix ? `パス: ${norm.pathPrefix}` : "")
  );

  const proxy = readProxyEnv();
  if (hasSystemProxy()) {
    const priv = isPrivateOrLocalHost(norm.host);
    checks.push(
      step(
        "client_proxy",
        "この PC のプロキシ環境変数",
        true,
        `HTTP_PROXY=${proxy.HTTP_PROXY || "—"} / HTTPS_PROXY=${proxy.HTTPS_PROXY || "—"}`,
        priv
          ? "閉域 IP 向けは NO_PROXY 推奨。拡張 API は直接接続（Node http）"
          : "外向き URL の場合はプロキシの影響を確認"
      )
    );
  } else {
    checks.push(step("client_proxy", "この PC のプロキシ環境変数", true, "未設定（直接接続）"));
  }

  try {
    const health = await requestJson("GET", apiUrl(base, "/api/v1/portal/health"));
    const ok = health.status === 200 && health.json?.status === "ok";
    checks.push(
      step(
        "portal_health",
        "NoraOps API（ポータル）",
        ok,
        ok ? "応答 OK" : `HTTP ${health.status}`,
        ok ? "" : "IIS の場合: /NoraOps/api/v1/... がバックエンドの /api/v1/... に届くか確認"
      )
    );
  } catch (e) {
    checks.push(
      step(
        "portal_health",
        "NoraOps API（ポータル）",
        false,
        e.message,
        "ファイアウォール・URL・IIS リライト・uvicorn 起動を確認"
      )
    );
  }

  try {
    const rules = await requestJson("GET", apiUrl(base, "/api/v1/checks/rules"));
    checks.push(
      step("checks_rules", "チェックルール", rules.status === 200, `HTTP ${rules.status}`)
    );
  } catch (e) {
    checks.push(step("checks_rules", "チェックルール", false, e.message));
  }

  let runtime = { online: false };
  try {
    runtime = await refreshRuntimeConfig(base);
    const ok = runtime.online === true;
    checks.push(
      step(
        "runtime_config",
        "ランタイム設定（Gitea 等）",
        ok,
        ok
          ? `Gitea: ${runtime.giteaBaseUrl || "—"} / token: ${runtime.giteaTokenConfigured ? "サーバー設定済" : "未設定"}`
          : "取得できませんでした",
        "サーバー .env の GITEA_BASE_URL / GITEA_TOKEN を確認"
      )
    );
  } catch (e) {
    checks.push(step("runtime_config", "ランタイム設定", false, e.message));
  }

  try {
    const cat = await requestJson("GET", apiUrl(base, "/api/v1/portal/catalog/published"));
    checks.push(
      step(
        "catalog",
        "Runner カタログ",
        cat.status === 200,
        cat.status === 200 ? `${cat.json?.count ?? 0} 件` : `HTTP ${cat.status}`
      )
    );
  } catch (e) {
    checks.push(step("catalog", "Runner カタログ", false, e.message));
  }

  try {
    const binding = await requestJson(
      "GET",
      apiUrl(base, "/api/v1/noraops/apps/binding?app_id=nora.app.health-probe")
    );
    checks.push(
      step(
        "app_registry_api",
        "アプリ紐づけ API",
        binding.status === 200,
        binding.status === 200 ? "registry lookup OK" : `HTTP ${binding.status}`,
        "giteaRepoId / appId ベースの保存先検証（Phase 4）"
      )
    );
  } catch (e) {
    checks.push(step("app_registry_api", "アプリ紐づけ API", false, e.message));
  }

  try {
    const ai = await requestJson("GET", apiUrl(base, "/api/v1/noraops/ai/status"));
    if (ai.status === 503) {
      checks.push(
        step("ai_gateway", "組織 AI（Azure）", true, "未利用（NORAOPS_AI_ENABLED=0）", "Copilot BYOK カードは非表示")
      );
    } else if (ai.status === 200) {
      const j = ai.json || {};
      const on = !!j.enabled;
      checks.push(
        step(
          "ai_gateway",
          "組織 AI（Azure）",
          on && !!j.configured,
          on
            ? j.configured
              ? `有効 · 本日 ${(j.usageToday?.tokens_in || 0) + (j.usageToday?.tokens_out || 0)} tok`
              : "有効だが Azure 未設定（.env）"
            : "無効",
          on ? "設定タブの Copilot / BYOK で拡張・利用量を確認" : ""
        )
      );
    } else {
      checks.push(step("ai_gateway", "組織 AI", false, `HTTP ${ai.status}`));
    }
  } catch (e) {
    checks.push(step("ai_gateway", "組織 AI", false, e.message));
  }

  const passed = checks.filter((c) => c.ok).length;
  const critical = ["portal_health"];
  const ok = critical.every((id) => checks.find((c) => c.id === id)?.ok);

  const proxyHints = proxyHintsForUrl(base);

  return {
    ok,
    baseUrl: base,
    portalUrl: norm.portalUrl,
    norm,
    checks,
    passed,
    total: checks.length,
    runtime,
    portalPageUrl: base,
    diagnosticsUrl: apiUrl(base, "/noraops/diagnostics/run"),
    proxyEnv: proxy,
    proxyHints,
  };
}

module.exports = { testServerConnection };
