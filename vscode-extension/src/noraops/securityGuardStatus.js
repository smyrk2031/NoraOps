const { refreshRules, getActiveRulesBundle } = require("./savePipeline");
const { readBundledRules } = require("./rulesClient");
const { getCachedRuntimeConfig, refreshRuntimeConfig } = require("./runtimeConfig");
const { refreshPackageAllowlist } = require("./packageAllowlist");
const { getNoraOpsConfig } = require("./config");
const { ruleToUi, compareSecurityRuleSets, getSecurityAllowlist, buildRuleLogicExplanation } = require("./checkRunner");

const { getUserIpWhitelist, MAX_ENTRIES } = require("./ipUserWhitelist");
const { RULE_LABELS, RULE_SAMPLES, RULE_NG_EXAMPLES } = require("./securityRuleCatalog");

function buildPackageGuardStatus(runtime, allowlist, serverOnline) {
  const indexUrl = (runtime?.pypiIndexUrl || "").trim();
  const packageCount =
    runtime?.packageAllowlistCount ?? allowlist?.packages?.size ?? 0;
  const active = Boolean(serverOnline && indexUrl && packageCount > 0);
  let reason = "有効";
  if (!serverOnline) reason = "サーバー未接続";
  else if (!indexUrl) reason = "PyPI index 未設定（pypiserver 未使用）";
  else if (packageCount <= 0) reason = "許可リスト未登録";
  return {
    active,
    indexUrl: indexUrl || "",
    packageCount,
    fallbackEnabled: runtime?.pypiFallbackEnabled !== false,
    etag: allowlist?.etag || runtime?.packageAllowlistEtag || "",
    reason,
  };
}

function enrichRuleUi(ruleUi, allow) {
  const meta = RULE_LABELS[ruleUi.id] || { title: ruleUi.id, desc: ruleUi.message };
  const logic = buildRuleLogicExplanation(ruleUi.definition, allow);
  const ngExamples = RULE_NG_EXAMPLES[ruleUi.id] || [];
  return {
    ...ruleUi,
    title: meta.title,
    desc: meta.desc,
    sample: RULE_SAMPLES[ruleUi.id] || ngExamples[0] || "",
    ngExamples,
    logic,
  };
}

async function getSecurityGuardOverview() {
  const online = await refreshRules();
  const activeBundle = getActiveRulesBundle() || readBundledRules();
  const bundled = readBundledRules();
  const cfg = getNoraOpsConfig();
  let runtime = getCachedRuntimeConfig() || {};
  let serverOnline = false;
  if (cfg.serverBaseUrl) {
    runtime = (await refreshRuntimeConfig(cfg.serverBaseUrl).catch(() => runtime)) || runtime;
    serverOnline = runtime.online === true;
  }
  const allowlist = cfg.serverBaseUrl
    ? await refreshPackageAllowlist(cfg.serverBaseUrl).catch(() => null)
    : null;

  const activeRules = (activeBundle?.security?.rules || []).filter((r) => r.enabled !== false);
  const bundledRules = (bundled?.security?.rules || []).filter((r) => r.enabled !== false);
  const allow = getSecurityAllowlist(activeBundle?.security || bundled?.security);
  const diff = compareSecurityRuleSets(bundledRules, activeRules);
  const source = activeBundle?.source === "server" ? "server" : "bundled";
  const packageGuard = buildPackageGuardStatus(runtime, allowlist, serverOnline);

  return {
    source,
    sourceLabel: source === "server" ? "サーバー運用" : "拡張同梱",
    etag: activeBundle?.etag || "",
    fetchedAt: new Date().toISOString(),
    rulesOnline: online,
    serverOnline,
    runGuardMode: "strict",
    runGuardLabel: online
      ? "実行ブロック: 有効（サーバー連携）"
      : "実行ブロック: 有効（同梱ルール・オフライン）",
    ruleCount: activeRules.length,
    bundledRuleCount: bundledRules.length,
    diff,
    allowlist: activeBundle?.security?.allowlist || bundled?.security?.allowlist || {},
    rules: activeRules.map((r) => enrichRuleUi(ruleToUi(r, allow), allow)),
    bundledRules: bundledRules.map((r) => enrichRuleUi(ruleToUi(r, allow), allow)),
    engineNote:
      "検出ロジック（アルゴリズム）は拡張に内蔵。サーバー連携時も pattern・severity・allowlist 等のパラメータだけ差し替え。",
    userIpWhitelist: {
      ips: getUserIpWhitelist(),
      maxEntries: MAX_ENTRIES,
      note: "救済措置: 登録 IP は warn のみ（F5 可・毎回警告）。システム allowlist（127.0.0.1 等）とは別です。",
    },
    packageGuard,
  };
}

async function getSecurityGuardRow() {
  const overview = await getSecurityGuardOverview();
  const pkg = overview.packageGuard.active
    ? ` · パッケージ許可 ${overview.packageGuard.packageCount} 件`
    : "";
  return {
    id: "security",
    ok: true,
    title: "セキュリティガード",
    detail: `${overview.sourceLabel} · ${overview.ruleCount} ルール · ${overview.runGuardLabel}${pkg}`,
    securityInfo: overview,
  };
}

module.exports = {
  getSecurityGuardOverview,
  getSecurityGuardRow,
  RULE_LABELS,
  RULE_SAMPLES,
  RULE_NG_EXAMPLES,
};
