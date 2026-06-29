const fs = require("fs");
const path = require("path");
const vscode = require("vscode");

/** 初心者向け: 何が問題で、何をすればいいか */
const POLICY_HINTS = {
  "pol.readme_exists": {
    short: "README.md がありません",
    todo: "アプリの説明ファイルを追加します（自動で入れられます）",
    autoFix: true,
  },
  "pol.nora_manifest": {
    short: "nora/manifest.json がありません",
    todo: "Gitea 保存用の NoraOps 設定です（自動で入れられます）",
    autoFix: true,
  },
  "pol.pyproject_exists": {
    short: "pyproject.toml がありません",
    todo: "Python パッケージ管理用です。ルートでも nora/packages/ でも OK（自動で入れられます）",
    autoFix: true,
  },
  "pol.gitignore_exists": {
    short: ".gitignore がありません",
    todo: "秘密情報を Git に載せないための設定です（自動で入れられます）",
    autoFix: true,
  },
  "pol.gitignore_covers_env": {
    short: ".gitignore に .env の除外がありません",
    todo: "パスワード等が Git に入らないよう追記します（自動で直せます）",
    autoFix: true,
  },
};

function enrichFinding(f) {
  const hint = POLICY_HINTS[f.ruleId] || {};
  return {
    ruleId: f.ruleId,
    severity: f.severity,
    message: f.message,
    file: f.file,
    short: hint.short || f.message,
    todo: hint.todo || "NoraOps ホームの「詳細を見る」で確認してください",
    autoFix: hint.autoFix === true,
    action: hint.action || null,
    fixAction: f.fixAction,
  };
}

function buildPolicyUiItems(summary) {
  const findings = summary?.findings?.filter((f) => f.category === "policy") || [];
  // 初心者向け: 保存を止める error のみ「やること」に出す（レイアウト warn は出さない）
  return findings.filter((f) => f.severity === "error").map(enrichFinding);
}

function mergeGitignorePatterns(workspaceRoot) {
  const giPath = path.join(workspaceRoot, ".gitignore");
  const tplPath = path.join(__dirname, "..", "..", "resources", "templates", "gitignore.default");
  const required = [".env", ".env.*", "*.pem", "*.key", "credentials*.json", ".venv/", "venv/"];
  let text = fs.existsSync(giPath) ? fs.readFileSync(giPath, "utf8") : "";
  if (!text.trim() && fs.existsSync(tplPath)) {
    text = fs.readFileSync(tplPath, "utf8");
  }
  const lines = new Set(text.split(/\r?\n/));
  let changed = false;
  for (const p of required) {
    const has = [...lines].some((l) => l.trim() === p || l.trim().includes(p.replace("*", "")));
    if (!has) {
      lines.add(p);
      changed = true;
    }
  }
  if (changed || !fs.existsSync(giPath)) {
    const body = [...lines].filter((l) => l !== "").join("\n") + "\n";
    fs.mkdirSync(path.dirname(giPath), { recursive: true });
    fs.writeFileSync(giPath, body, "utf8");
    return { ok: true, created: !fs.existsSync(giPath), path: ".gitignore" };
  }
  return { ok: true, skipped: true };
}

async function applyAutoFixes(workspaceRoot, items) {
  const fixable = items.filter((i) => i.autoFix);
  if (!fixable.length) return { ok: false, message: "自動で直せる項目がありません", fixed: [] };

  const fixed = [];
  const needsScaffold = fixable.some((i) =>
    ["template_readme", "scaffold_nora", "template_pyproject"].includes(i.fixAction)
  );
  if (needsScaffold) {
    const { ensureScaffoldForProfile } = require("./scaffold");
    const r = ensureScaffoldForProfile(workspaceRoot);
    if (r.created?.length) fixed.push(...r.created);
  }

  if (fixable.some((i) => i.fixAction === "auto_gitignore")) {
    const r = mergeGitignorePatterns(workspaceRoot);
    if (r.path && !r.skipped) fixed.push(r.path);
    else if (r.skipped) fixed.push(".gitignore（既に OK）");
  }

  const { runWorkspaceChecks } = require("./savePipeline");
  await runWorkspaceChecks(workspaceRoot);
  const { refreshHomePanel } = require("./homePanel");
  refreshHomePanel();

  return { ok: true, fixed: [...new Set(fixed)] };
}

async function showPolicyDetails(workspaceRoot, items) {
  const lines = items.map((i, n) => `${n + 1}. ${i.short}\n   → ${i.todo}`);
  const autoCount = items.filter((i) => i.autoFix).length;
  const buttons = ["閉じる"];
  if (autoCount > 0) buttons.unshift("自動で直す");

  const pick = await vscode.window.showWarningMessage(
    `整理が必要な項目: ${items.length} 件`,
    { modal: true, detail: lines.join("\n\n") },
    ...(autoCount > 0 ? ["自動で直す", "閉じる"] : ["閉じる"])
  );

  if (pick === "自動で直す") {
    const result = await applyAutoFixes(workspaceRoot, items);
    if (result.fixed?.length) {
      vscode.window.showInformationMessage(`追加・修正しました: ${result.fixed.join(", ")}`);
    } else {
      vscode.window.showInformationMessage("自動修正を試みました。ホームの表示を確認してください。");
    }
  }
}

module.exports = {
  buildPolicyUiItems,
  applyAutoFixes,
  showPolicyDetails,
  mergeGitignorePatterns,
  POLICY_HINTS,
};
