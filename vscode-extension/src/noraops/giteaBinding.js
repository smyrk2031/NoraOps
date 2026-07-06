/** Gitea リポ ID（giteaRepoId）ベースの紐づけ整合性 */

const vscode = require("vscode");
const { readWorkspaceSession } = require("./pathsMeta");
const { readNoraManifest } = require("./appEntry");
const { getNoraOpsRepoMeta, bindNoraOpsRepo } = require("./repoMeta");
const { getNoraOpsConfig } = require("./config");
const { requestJson } = require("./noraopsApi");
const { fetchRegistryByAppId, analyzeAppBinding, reconcileBindingIdentity, syncSessionAppIdFromManifest } = require("./appBinding");
const { normalizeGiteaRepoId } = require("./giteaRepoId");

async function fetchRegistryByGiteaId(giteaRepoId) {
  const id = normalizeGiteaRepoId(giteaRepoId);
  const { serverBaseUrl } = getNoraOpsConfig();
  if (!serverBaseUrl || !id) return { found: false, giteaRepoId: id };
  try {
    const { status, json } = await requestJson(
      "GET",
      `${serverBaseUrl.replace(/\/$/, "")}/api/v1/noraops/apps/binding?gitea_repo_id=${encodeURIComponent(String(id))}`
    );
    if (status === 200 && json) return json;
  } catch {
    /* ignore */
  }
  return { found: false, giteaRepoId: id };
}

/**
 * フォルダ open 時: giteaRepoId でサーバー登録を参照し owner/name を静かに更新。
 */
async function refreshGiteaBindingQuiet(workspaceRoot) {
  if (!workspaceRoot) return { updated: false };
  const session = readWorkspaceSession(workspaceRoot);
  let repoId = normalizeGiteaRepoId(session?.giteaRepoId);

  if (!repoId) {
    const manifest = readNoraManifest(workspaceRoot);
    if (manifest?.appId) {
      const reg = await fetchRegistryByAppId(manifest.appId);
      const fromReg = normalizeGiteaRepoId(reg?.giteaRepoId);
      if (reg?.found && fromReg) {
        bindNoraOpsRepo(workspaceRoot, {
          owner: reg.owner,
          name: reg.name,
          fullName: reg.fullName || `${reg.owner}/${reg.name}`,
          giteaRepoId: fromReg,
          appId: reg.appId,
        });
        return { updated: true, source: "registry_app_id" };
      }
    }
    return { updated: false };
  }

  const reg = await fetchRegistryByGiteaId(repoId);
  if (!reg?.found) return { updated: false, stale: true };

  const meta = getNoraOpsRepoMeta(workspaceRoot);
  const regFull = reg.fullName || `${reg.owner}/${reg.name}`;
  const manifest = readNoraManifest(workspaceRoot);
  const manifestMismatch =
    manifest?.appId && reg.appId && manifest.appId !== reg.appId;

  if (manifestMismatch) {
    return { updated: false, conflict: true, reason: "manifest_registry_appid" };
  }

  const needsUpdate =
    !meta ||
    meta.fullName !== regFull ||
    normalizeGiteaRepoId(session?.giteaRepoId) !== repoId;

  if (needsUpdate) {
    bindNoraOpsRepo(workspaceRoot, {
      owner: reg.owner,
      name: reg.name,
      fullName: regFull,
      giteaRepoId: repoId,
      appId: reg.appId || manifest?.appId || session?.appId,
    });
    return { updated: true, renamed: meta?.fullName !== regFull };
  }

  return { updated: false };
}

/**
 * 保存前: appId / giteaRepoId / owner-name の矛盾を検出。
 */
const BLOCKING_ISSUE_CODES = new Set([
  "session_manifest_appid",
  "session_repo_registry",
  "repo_manifest_appid",
  "gitea_repo_id_mismatch",
  "session_repo_gitea_id",
]);

async function validateBindingBeforeSave(workspaceRoot) {
  await reconcileBindingIdentity(workspaceRoot);
  await refreshGiteaBindingQuiet(workspaceRoot);

  const binding = await analyzeAppBinding(workspaceRoot);
  const session = readWorkspaceSession(workspaceRoot);
  const sessionRepoId = normalizeGiteaRepoId(session?.giteaRepoId);
  const issues = [...(binding.issues || [])];

  const regByApp = binding.registryByApp;
  const regId = normalizeGiteaRepoId(regByApp?.giteaRepoId);
  if (regByApp?.found && regId && sessionRepoId && regId !== sessionRepoId) {
    issues.push({
      code: "gitea_repo_id_mismatch",
      severity: "error",
      sessionRepoId,
      registryRepoId: regId,
    });
  }

  const regByRepo = binding.registryByRepo;
  const repoRegId = normalizeGiteaRepoId(regByRepo?.giteaRepoId);
  if (regByRepo?.found && repoRegId && sessionRepoId && repoRegId !== sessionRepoId) {
    issues.push({
      code: "session_repo_gitea_id",
      severity: "error",
      sessionRepoId,
      registryRepoId: repoRegId,
    });
  }

  const blockingIssues = issues.filter(
    (i) => i.severity === "error" && BLOCKING_ISSUE_CODES.has(i.code)
  );
  if (blockingIssues.length) {
    const primary = blockingIssues[0];
    const headlines = {
      session_manifest_appid: "PC 記録の appId と manifest が食い違っています",
      session_repo_registry: "PC の保存先とサーバー登録が一致しません",
      repo_manifest_appid: "このリポジトリは別のアプリ ID に紐づいています",
      gitea_repo_id_mismatch: "保存先の Gitea ID が一致しません",
      session_repo_gitea_id: "PC 記録の Gitea ID が一致しません",
    };
    return {
      ok: false,
      block: true,
      headline: headlines[primary.code] || binding.headline || "保存先の ID が一致しません",
      detail: binding.detail,
      binding: { ...binding, issues },
    };
  }

  return { ok: true, block: false, binding: { ...binding, issues } };
}

async function confirmBindingConflictOrProceed(validation) {
  if (!validation?.block) return true;
  const choice = await vscode.window.showErrorMessage(
    `${validation.headline}\n\n${validation.detail || "別アプリの保存先と混ざる可能性があります。"}`,
    { modal: true },
    "保存を中止",
    "クラウドタブで確認",
    "PC 記録を manifest に合わせる"
  );
  if (choice === "クラウドタブで確認") {
    vscode.commands.executeCommand("noraops.openHome");
    return false;
  }
  if (choice === "PC 記録を manifest に合わせる") {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (folder) {
      syncSessionAppIdFromManifest(folder.uri.fsPath);
      vscode.window.showInformationMessage("PC 記録を manifest の appId に合わせました。もう一度保存してください。");
    }
    return false;
  }
  return false;
}

module.exports = {
  fetchRegistryByGiteaId,
  refreshGiteaBindingQuiet,
  validateBindingBeforeSave,
  confirmBindingConflictOrProceed,
};
