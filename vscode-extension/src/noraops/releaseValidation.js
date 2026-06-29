const fs = require("fs");
const path = require("path");
const { readNoraManifest } = require("./appEntry");
const { noraJoin, resolveScaffoldRoot } = require("./scaffold");
const { pyprojectPath, hasPyproject } = require("./projectPaths");

/**
 * 公開リリース前の厳格チェック（SEC/POL エラーはブロック）。
 * @returns {{ ok: boolean, errors: string[], warnings: string[], checklist: { id: string, label: string, ok: boolean }[] }}
 */
function validateReleaseReadiness(workspaceRoot, summary) {
  const errors = [];
  const warnings = [];
  const checklist = [];

  const secN = summary?.secErrors?.length || 0;
  const polN = summary?.polErrors?.length || 0;
  checklist.push({
    id: "sec",
    label: "セキュリティ（IP 直書き等）",
    ok: secN === 0,
  });
  if (secN) errors.push(`セキュリティ違反 ${secN} 件`);

  checklist.push({
    id: "pol",
    label: "リポジトリポリシー（README / manifest 等）",
    ok: polN === 0,
  });
  if (polN) errors.push(`ポリシー違反 ${polN} 件`);

  const manifestPath = noraJoin(workspaceRoot, "manifest.json");
  const hasManifest = fs.existsSync(manifestPath);
  checklist.push({ id: "manifest", label: "nora/manifest.json", ok: hasManifest });
  if (!hasManifest) errors.push("nora/manifest.json がありません");

  const pyOk = hasPyproject(workspaceRoot);
  const root = resolveScaffoldRoot(workspaceRoot);
  const pyLabel = pyOk
    ? path.relative(root, pyprojectPath(workspaceRoot)).replace(/\\/g, "/") || "pyproject.toml"
    : "pyproject.toml";
  checklist.push({ id: "pyproject", label: pyLabel, ok: pyOk });
  if (!pyOk) errors.push("pyproject.toml がありません（ルートまたは nora/packages/）");

  const readmeMd = path.join(root, "README.md");
  const readmeHtml = path.join(root, "README.html");
  const hasReadme = fs.existsSync(readmeMd) || fs.existsSync(readmeHtml);
  checklist.push({
    id: "readme",
    label: "README.md / README.html（説明文）",
    ok: hasReadme,
  });
  if (!hasReadme) errors.push("README.md または README.html がありません");

  const man = hasManifest ? readNoraManifest(workspaceRoot) : null;
  const hasEntry = !!(man?.entry || man?.entryModule);
  checklist.push({ id: "entry", label: "manifest の起動 entry", ok: hasEntry });
  if (!hasEntry) errors.push("manifest の entry / entryModule が未設定");

  const { resolveThumbnailAbsPath } = require("./thumbnailAsset");
  const thumb = resolveThumbnailAbsPath(workspaceRoot);
  const hasThumb = fs.existsSync(thumb);
  checklist.push({ id: "thumb", label: "サムネイル（Runner 一覧用）", ok: hasThumb });
  if (!hasThumb) warnings.push("サムネイル未設定（Runner 一覧でアイコンなし）");

  const polWarn = (summary?.warns || []).filter((w) => w.category === "policy").length;
  if (polWarn) warnings.push(`ポリシー警告 ${polWarn} 件（確認推奨）`);

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    checklist,
  };
}

module.exports = { validateReleaseReadiness };
