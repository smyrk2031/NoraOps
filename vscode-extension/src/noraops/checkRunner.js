const fs = require("fs");
const path = require("path");
const { globMatch, matchesGlobs } = require("./globUtils");
const {
  DEFAULT_SECURITY_IP_ALLOWLIST,
  DEFAULT_SECURITY_IPV6_ALLOWLIST,
  getSecurityAllowlist,
  isAllowlistedIp,
  shouldFlagGlobalIpLiteral,
} = require("./securityAllowlist");
const { getUserIpWhitelist, isUserIpWhitelisted } = require("./ipUserWhitelist");

const TEXT_EXT = new Set([
  ".py", ".js", ".ts", ".tsx", ".json", ".yaml", ".yml", ".toml", ".md", ".html", ".css", ".env", ".txt",
]);

const SKIP_DIRS = new Set([".git", "node_modules", ".venv", "venv", "__pycache__", "dist", "build"]);

function walkFiles(root, maxFiles = 500) {
  const out = [];
  function walk(dir) {
    if (out.length >= maxFiles) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (out.length >= maxFiles) break;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name)) continue;
        walk(full);
      } else if (ent.isFile()) {
        const ext = path.extname(ent.name).toLowerCase();
        if (TEXT_EXT.has(ext) || ent.name === ".env") {
          out.push({ full, rel: path.relative(root, full).replace(/\\/g, "/") });
        }
      }
    }
  }
  walk(root);
  return out;
}

const IP_RE = /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g;
const IPV6_RE = /\b(?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{0,4}\b/gi;

function stripLineComments(line, rel) {
  if (!rel) return line;
  const r = rel.replace(/\\/g, "/");
  if (/\.(py|js|ts|tsx|sh|yaml|yml|toml)$/.test(r)) {
    const idx = line.indexOf("#");
    if (idx >= 0) return line.slice(0, idx);
  }
  if (/\.(js|ts|tsx)$/.test(r)) {
    const idx = line.indexOf("//");
    if (idx >= 0) return line.slice(0, idx);
  }
  return line;
}


function scanSecurityText(rel, text, rules, allow, userIpWhitelist) {
  const findings = [];
  const userWl = userIpWhitelist ?? getUserIpWhitelist();
  const lines = text.split(/\r?\n/);
  for (const rule of rules) {
    if (rule.enabled === false) continue;
    if (!matchesGlobs(rel, rule.globs, rule.excludeGlobs)) continue;
    if (rule.kind === "regex" && rule.pattern) {
      let re;
      try {
        re = new RegExp(rule.pattern, "gm");
      } catch {
        continue;
      }
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) {
          findings.push({
            ruleId: rule.id,
            severity: rule.severity || "error",
            message: rule.message,
            file: rel,
            line: i + 1,
            category: "security",
            blocksPublish: rule.blocksPublish === true,
            snippet: (lines[i] || "").trim().slice(0, 160),
          });
          re.lastIndex = 0;
        }
      }
    } else if (rule.kind === "custom" && rule.custom === "ip_literal") {
      for (let i = 0; i < lines.length; i++) {
        const scanLine = stripLineComments(lines[i], rel);
        const ipv4 = scanLine.match(IP_RE) || [];
        const ipv6 = scanLine.match(IPV6_RE) || [];
        for (const ip of [...ipv4, ...ipv6]) {
          if (!shouldFlagGlobalIpLiteral(ip, allow)) continue;
          const relief = isUserIpWhitelisted(ip, userWl);
          findings.push({
            ruleId: rule.id,
            severity: relief ? "warn" : rule.severity || "error",
            message: relief
              ? `救済ホワイトリスト登録済み IP（${ip}）の直書き。F5 は可能ですが、ホスト名や環境変数への移行を推奨します。`
              : rule.message,
            file: rel,
            line: i + 1,
            category: "security",
            blocksPublish: rule.blocksPublish === true,
            snippet: (scanLine || "").trim().slice(0, 160),
            userReliefWhitelist: relief || undefined,
            matchedIp: relief ? ip : undefined,
          });
        }
      }
    }
  }
  return findings;
}

function scanDirtyDocuments(workspaceRoot, rules, allow, userIpWhitelist) {
  let vscode;
  try {
    vscode = require("vscode");
  } catch {
    return [];
  }
  if (!vscode?.workspace?.textDocuments) return [];

  const root = path.resolve(workspaceRoot);
  const findings = [];
  for (const doc of vscode.workspace.textDocuments) {
    if (doc.isUntitled || doc.uri.scheme !== "file") continue;
    const full = doc.uri.fsPath;
    if (!full.startsWith(root)) continue;
    const rel = path.relative(root, full).replace(/\\/g, "/");
    if (!rel || rel.startsWith("..")) continue;
    if (!doc.isDirty) continue;
    findings.push(...scanSecurityText(rel, doc.getText(), rules, allow, userIpWhitelist));
  }
  return findings;
}

function scanSecurity(workspaceRoot, securityBundle, online) {
  const findings = [];
  const rules = securityBundle?.rules || [];
  const allow = getSecurityAllowlist(securityBundle);
  const userIpWhitelist = getUserIpWhitelist();
  const files = walkFiles(workspaceRoot);

  for (const { full, rel } of files) {
    let text;
    try {
      text = fs.readFileSync(full, "utf8");
    } catch {
      continue;
    }
    findings.push(...scanSecurityText(rel, text, rules, allow, userIpWhitelist));
  }

  findings.push(...scanDirtyDocuments(workspaceRoot, rules, allow, userIpWhitelist));

  return { findings, online };
}

function scanPolicy(workspaceRoot, repoPolicyBundle) {
  const findings = [];
  const rules = repoPolicyBundle?.rules || [];
  for (const rule of rules) {
    if (rule.enabled === false) continue;
    if (rule.kind === "file_exists") {
      const paths = rule.paths || [];
      const any = paths.some((p) => fs.existsSync(path.join(workspaceRoot, p)));
      if (!any) {
        findings.push({
          ruleId: rule.id,
          severity: rule.severity || "error",
          message: rule.message,
          file: paths[0] || "",
          line: 0,
          category: "policy",
          fixAction: rule.fixAction,
        });
      }
    } else if (rule.kind === "file_exists_any") {
      if (rule.id === "pol.pyproject_exists") {
        const { hasResolvedPyproject } = require("./pyprojectResolve");
        if (!hasResolvedPyproject(workspaceRoot)) {
          findings.push({
            ruleId: rule.id,
            severity: rule.severity || "error",
            message: rule.message,
            file: "pyproject.toml",
            line: 0,
            category: "policy",
            fixAction: rule.fixAction,
          });
        }
        continue;
      }
      const paths = rule.paths || [];
      const any = paths.some((p) => fs.existsSync(path.join(workspaceRoot, p)));
      if (!any) {
        findings.push({
          ruleId: rule.id,
          severity: rule.severity || "error",
          message: rule.message,
          file: paths[0] || "",
          line: 0,
          category: "policy",
          fixAction: rule.fixAction,
        });
      }
    } else if (rule.kind === "pyproject_resolved") {
      const { resolvePyproject } = require("./pyprojectResolve");
      const resolved = resolvePyproject(workspaceRoot);
      if (!resolved.ok) {
        findings.push({
          ruleId: rule.id,
          severity: rule.severity || "error",
          message: rule.message,
          file: "pyproject.toml",
          line: 0,
          category: "policy",
          fixAction: rule.fixAction,
        });
      }
    } else if (rule.kind === "file_must_not_exist") {
      const when = rule.when || {};
      if (when.nora_manifest && !fs.existsSync(path.join(workspaceRoot, "nora", "manifest.json"))) {
        continue;
      }
      for (const p of rule.paths || []) {
        if (fs.existsSync(path.join(workspaceRoot, p))) {
          findings.push({
            ruleId: rule.id,
            severity: rule.severity || "warn",
            message: rule.message,
            file: p,
            line: 0,
            category: "policy",
            fixAction: rule.fixAction,
          });
        }
      }
    } else if (rule.kind === "gitignore_covers") {
      const giPath = path.join(workspaceRoot, ".gitignore");
      if (!fs.existsSync(giPath)) continue;
      const text = fs.readFileSync(giPath, "utf8");
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const patterns = rule.patterns || [];
      const missing = patterns.filter((pat) => {
        const core = pat.replace(/\*/g, "");
        return !lines.some((l) => l === pat || l.includes(core));
      });
      if (missing.length) {
        findings.push({
          ruleId: rule.id,
          severity: rule.severity || "error",
          message: rule.message,
          file: ".gitignore",
          line: 0,
          category: "policy",
          fixAction: rule.fixAction,
        });
      }
    } else if (rule.kind === "app_entry") {
      const { resolveAppEntry } = require("./appEntry");
      const { packagesDir } = require("./projectPaths");
      const projectDir = packagesDir(workspaceRoot);
      const entry = resolveAppEntry(workspaceRoot, projectDir);
      if (!entry) {
        findings.push({
          ruleId: rule.id,
          severity: rule.severity || "error",
          message: rule.message,
          file: "nora/manifest.json",
          line: 0,
          category: "policy",
          fixAction: rule.fixAction,
        });
      }
    }
  }

  return findings;
}

function summarize(findings) {
  const secErrors = findings.filter((f) => f.category === "security" && f.severity === "error");
  const secWarns = findings.filter((f) => f.category === "security" && f.severity === "warn");
  const secPublishWarns = secWarns.filter((f) => f.blocksPublish);
  const polErrors = findings.filter((f) => f.category === "policy" && f.severity === "error");
  const warns = findings.filter((f) => f.severity === "warn");
  return { secErrors, secWarns, secPublishWarns, polErrors, warns, findings };
}

function runChecks(workspaceRoot, bundle, online) {
  const sec = scanSecurity(workspaceRoot, bundle?.security, online);
  const pol = scanPolicy(workspaceRoot, bundle?.repo_policy);
  return summarize([...sec.findings, ...pol]);
}

function describeRuleImpact(rule) {
  if (!rule) return { level: "unknown", label: "—", runBlock: false, publishBlock: false };
  const runBlock = rule.severity === "error";
  const publishBlock = rule.blocksPublish === true;
  let label = "実行時確認";
  if (runBlock) label = "実行ブロック";
  else if (publishBlock) label = "公開前警告";
  else if (rule.severity === "warn") label = "実行時確認";
  return { level: rule.severity || "warn", label, runBlock, publishBlock };
}

function ruleToUi(rule, allowlist) {
  const impact = describeRuleImpact(rule);
  let patternHint = "";
  if (rule.kind === "regex" && rule.pattern) {
    patternHint = rule.pattern;
  } else if (rule.kind === "custom" && rule.custom === "ip_literal") {
    patternHint = "公衆 IP + 172.* + 168系（allowlist・10.* 除外）";
  }
  return {
    id: rule.id,
    message: rule.message || "",
    severity: rule.severity || "warn",
    blocksPublish: rule.blocksPublish === true,
    kind: rule.kind,
    custom: rule.custom || "",
    pattern: rule.pattern || "",
    patternHint,
    impact,
    allowlist: rule.id === "sec.ip_literal" ? allowlist : null,
    definition: rule,
  };
}

function testSecurityRuleText(text, ruleId, securityBundle) {
  const rules = securityBundle?.rules || [];
  const rule = rules.find((r) => r.id === ruleId);
  if (!rule) return { ok: false, error: "ルールが見つかりません", findings: [] };
  const allow = getSecurityAllowlist(securityBundle);
  const sample = String(text || "");
  const rel = rule.kind === "regex" && rule.pattern?.includes("@") ? "__sandbox__/sample.md" : "__sandbox__/sample.py";
  const findings = scanSecurityText(rel, sample, [rule], allow);
  const impact = describeRuleImpact(rule);
  return {
    ok: true,
    hit: findings.length > 0,
    findings,
    impact,
    rule: ruleToUi(rule, allow),
  };
}

function compareSecurityRuleSets(bundledRules, activeRules) {
  const bundledMap = new Map((bundledRules || []).map((r) => [r.id, r]));
  const activeMap = new Map((activeRules || []).map((r) => [r.id, r]));
  const changed = [];
  for (const [id, active] of activeMap) {
    const bundled = bundledMap.get(id);
    if (!bundled) {
      changed.push({ id, type: "added" });
      continue;
    }
    const fields = ["severity", "pattern", "message", "blocksPublish", "enabled"];
    const diffs = fields.filter((f) => JSON.stringify(bundled[f]) !== JSON.stringify(active[f]));
    if (diffs.length) changed.push({ id, type: "modified", fields: diffs });
  }
  for (const id of bundledMap.keys()) {
    if (!activeMap.has(id)) changed.push({ id, type: "removed" });
  }
  return { changed, hasDiff: changed.length > 0 };
}

function readSourceExcerpt(relativeFile, startLine, endLine) {
  try {
    const full = path.join(__dirname, relativeFile);
    const lines = fs.readFileSync(full, "utf8").split(/\r?\n/);
    const slice = lines.slice(Math.max(0, startLine - 1), endLine);
    return slice
      .map((line, i) => `${String(startLine + i).padStart(4, " ")}| ${line}`)
      .join("\n");
  } catch {
    return "（ソースを読み込めませんでした）";
  }
}

function buildRuleLogicCodeBlocks(rule) {
  const common = [
    {
      file: "checkRunner.js",
      title: "scanSecurityText — 入口（globs 判定）",
      startLine: 64,
      endLine: 69,
    },
    {
      file: "globUtils.js",
      title: "matchesGlobs — 対象ファイルの絞り込み",
      startLine: 31,
      endLine: 37,
    },
  ];

  if (rule?.kind === "regex" && rule.pattern) {
    return [
      ...common,
      {
        file: "checkRunner.js",
        title: "kind=regex — 行単位 RegExp マッチ",
        startLine: 70,
        endLine: 91,
      },
    ];
  }

  if (rule?.kind === "custom" && rule.custom === "ip_literal") {
    return [
      ...common,
      {
        file: "checkRunner.js",
        title: "IPv4 / IPv6 リテラル用 RegExp",
        startLine: 40,
        endLine: 41,
      },
      {
        file: "checkRunner.js",
        title: "stripLineComments — 行コメント除去",
        startLine: 43,
        endLine: 55,
      },
      {
        file: "checkRunner.js",
        title: "isAllowlistedIp — allowlist 判定",
        startLine: 57,
        endLine: 61,
      },
      {
        file: "checkRunner.js",
        title: "kind=custom / ip_literal — IP 走査",
        startLine: 92,
        endLine: 110,
      },
    ];
  }

  return common.map((b) => ({
    ...b,
    source: readSourceExcerpt(b.file, b.startLine, b.endLine),
  }));
}

/**
 * ルール JSON だけでは分からない「拡張側の検出アルゴリズム」を人間向けに説明する。
 * サーバー連携時もエンジン本体は拡張内 checkRunner.js 固定（サーバーはパラメータ配信のみ）。
 */
function buildRuleLogicExplanation(rule, allowlist) {
  const steps = [];
  steps.push(
    "判定エンジン: 拡張 checkRunner.js の scanSecurityText()（保存・実行ガード・サンドボックステスト共通）"
  );
  steps.push(
    "サーバー連携時: pattern / severity / message / allowlist 等のパラメータだけサーバーから取得。検出アルゴリズム自体は拡張に内蔵"
  );

  if (rule?.globs?.length) {
    const g = rule.globs.slice(0, 4).join(", ");
    steps.push(`対象ファイル: globs に一致するパスのみ（${g}${rule.globs.length > 4 ? " …" : ""}）`);
  }
  if (rule?.excludeGlobs?.length) {
    const x = rule.excludeGlobs.slice(0, 3).join(", ");
    steps.push(`除外: excludeGlobs（${x}${rule.excludeGlobs.length > 3 ? " …" : ""}）`);
  }

  if (rule?.kind === "regex" && rule.pattern) {
    steps.push("方式 kind=regex: 全文を行に分割 → 各行に RegExp(pattern, \"gm\") を 1 回ずつ適用");
    steps.push("行をまたぐマッチはしません");
    steps.push("コメント除去: なし（# や // の右側も走査対象。除外したい場合は正規表現側で調整）");
    steps.push(`正規表現: /${rule.pattern}/gm`);
  } else if (rule?.kind === "custom" && rule.custom === "ip_literal") {
    steps.push("方式 kind=custom / ip_literal: JSON の pattern は使わず、拡張内蔵の IPv4/IPv6 検出");
    steps.push("対象: 公衆 IP、172.*、168系（192.168.*）。10.*・システム allowlist は無視");
    steps.push("ユーザー救済ホワイトリスト（Setting › セキュリティガード）: 登録済み IP は warn のみ（F5 可・毎回警告）");
    steps.push("各行: Python/YAML/TOML 等は # 以降、JS/TS は // 以降をコメントとして除外してから走査");
    steps.push("IPv4: \\b(0–255)\\.((0–255)\\.){3}(0–255)\\b 相当のリテラル");
    steps.push("IPv6: コロン区切り 16 進リテラル");
    const merged = getSecurityAllowlist({ allowlist });
    steps.push(`allowlist（公衆 IP でも検出しない）: ${[...merged.ips, ...merged.ipv6].join(", ")}`);
    steps.push("1 行に allowlist 外 IP が複数あれば、その数だけヒット");
  } else {
    steps.push(`方式: kind=${rule?.kind || "?"}${rule?.custom ? ` / custom=${rule.custom}` : ""}`);
  }

  let serverNote = "サーバーが配信するのはルール JSON（パラメータ）のみです。";
  if (rule?.kind === "regex") {
    serverNote +=
      " 正規表現 pattern や severity を CMS/JSON で変えると検出内容は変わりますが、行単位 regex というロジックは拡張更新まで固定です。";
  } else if (rule?.custom === "ip_literal") {
    serverNote +=
      " allowlist や severity はサーバー側で変えられますが、IPv4/IPv6 の見つけ方は拡張更新まで固定です。";
  }

  return {
    engine: "checkRunner.js → scanSecurityText()",
    steps,
    serverNote,
    codeBlocks: buildRuleLogicCodeBlocks(rule).map((b) => ({
      ...b,
      source: b.source || readSourceExcerpt(b.file, b.startLine, b.endLine),
    })),
  };
}

module.exports = {
  runChecks,
  walkFiles,
  summarize,
  scanSecurityText,
  testSecurityRuleText,
  describeRuleImpact,
  ruleToUi,
  getSecurityAllowlist,
  compareSecurityRuleSets,
  buildRuleLogicExplanation,
};
