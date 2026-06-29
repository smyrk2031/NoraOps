#!/usr/bin/env node
/**
 * サーバー側リポジトリ監査 — 拡張 checkRunner と同一エンジン。
 * Usage: node scripts/repo-audit-cli.js --workspace <path> --rules <bundle.json>
 */

const fs = require("fs");
const path = require("path");
const { runChecks } = require("../src/noraops/checkRunner");
const { resolvePyproject } = require("../src/noraops/pyprojectResolve");

function parseArgs(argv) {
  const out = { workspace: null, rules: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--workspace" && argv[i + 1]) out.workspace = argv[++i];
    else if (argv[i] === "--rules" && argv[i + 1]) out.rules = argv[++i];
  }
  return out;
}

function readReadmeExcerpt(workspaceRoot) {
  for (const rel of ["README.md", "README.html"]) {
    const abs = path.join(workspaceRoot, rel);
    if (!fs.existsSync(abs)) continue;
    try {
      const text = fs.readFileSync(abs, "utf8");
      return { path: rel, excerpt: text.trim().slice(0, 2000) };
    } catch {
      /* ignore */
    }
  }
  return null;
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.workspace || !args.rules) {
    process.stderr.write("Usage: node scripts/repo-audit-cli.js --workspace <dir> --rules <bundle.json>\n");
    process.exit(2);
  }
  const workspace = path.resolve(args.workspace);
  if (!fs.existsSync(workspace)) {
    process.stderr.write(`Workspace not found: ${workspace}\n`);
    process.exit(2);
  }
  let bundle;
  try {
    bundle = JSON.parse(fs.readFileSync(args.rules, "utf8"));
  } catch (e) {
    process.stderr.write(`Invalid rules bundle: ${e.message}\n`);
    process.exit(2);
  }

  const summary = runChecks(workspace, bundle, true);
  const py = resolvePyproject(workspace);
  const readme = readReadmeExcerpt(workspace);

  const payload = {
    ok: true,
    workspace,
    readme,
    pyproject: py.ok
      ? {
          rel: py.pyprojectRel,
          source: py.source,
          ambiguous: py.ambiguous,
          alternateRels: py.alternateRels || [],
        }
      : { rel: null, source: null, ambiguous: false, alternateRels: [] },
    summary: {
      secErrorCount: summary.secErrors.length,
      secWarnCount: summary.secWarns.length,
      polErrorCount: summary.polErrors.length,
      warnCount: summary.warns.length,
      ok: summary.secErrors.length === 0 && summary.polErrors.length === 0,
    },
    findings: summary.findings.map((f) => ({
      ruleId: f.ruleId,
      severity: f.severity,
      category: f.category,
      message: f.message,
      file: f.file,
      line: f.line || 0,
      snippet: f.snippet || null,
    })),
  };
  process.stdout.write(JSON.stringify(payload));
}

main();
