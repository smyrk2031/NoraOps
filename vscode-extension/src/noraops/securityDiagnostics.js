const path = require("path");
const vscode = require("vscode");

const COLLECTION = vscode.languages.createDiagnosticCollection("noraops-security");

function findingToDiagnostic(f) {
  const line = Math.max(0, (f.line || 1) - 1);
  const range = new vscode.Range(line, 0, line, 256);
  const sev = f.severity === "warn" ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error;
  const d = new vscode.Diagnostic(range, f.message || "セキュリティ違反", sev);
  d.source = "NoraOps";
  d.code = f.ruleId;
  return d;
}

function publishSecurityDiagnostics(workspaceRoot, summary) {
  COLLECTION.clear();
  if (!workspaceRoot || !summary?.findings?.length) return;

  const byFile = new Map();
  for (const f of summary.findings) {
    if (f.category !== "security" || !f.file) continue;
    const key = f.file.replace(/\\/g, "/");
    if (!byFile.has(key)) byFile.set(key, []);
    byFile.get(key).push(findingToDiagnostic(f));
  }

  for (const [rel, diags] of byFile) {
    const uri = vscode.Uri.file(path.join(workspaceRoot, rel));
    COLLECTION.set(uri, diags);
  }
}

function formatSecBlockMessage(summary) {
  const errs = summary?.secErrors || [];
  if (!errs.length) return "";
  const lines = errs.slice(0, 8).map((e) => {
    const loc = e.file ? `${e.file}:${e.line || "?"}` : "（サンドボックス）";
    const snip = e.snippet ? ` — ${e.snippet}` : "";
    return `・[${e.ruleId || "?"}] ${loc} ${e.message || ""}${snip}`;
  });
  if (errs.length > 8) lines.push(`…他 ${errs.length - 8} 件`);
  return lines.join("\n");
}

module.exports = { publishSecurityDiagnostics, formatSecBlockMessage, COLLECTION };
