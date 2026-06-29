/** Gitea リポ ID（giteaRepoId）ベースの紐づけ整合性 */

const vscode = require("vscode");
const { readWorkspaceSession } = require("./pathsMeta");
const { readNoraManifest } = require("./appEntry");
const { getNoraOpsRepoMeta, bindNoraOpsRepo } = require("./repoMeta");
const { getNoraOpsConfig } = require("./config");
const { requestJson } = require("./noraopsApi");
const { fetchRegistryByAppId, analyzeAppBinding } = require("./appBinding");
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
async function validateBindingBeforeSave(workspaceRoot) {
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

  const hasError = issues.some((i) => i.severity === "error");
  if (hasError) {
    const headline =
      binding.headline !== "保存先とアプリ ID は一致しています"
        ? binding.headline
        : "保存先の ID が一致しません";
    return {
      ok: false,
      block: true,
      headline,
      detail: binding.detail,
      binding: { ...binding, issues },
    };
  }

  if (!binding.ok) {
    return { ok: false, block: false, binding };
  }

  return { ok: true, binding };
}

async function confirmBindingConflictOrProceed(validation) {
  if (!validation?.block) return true;
  const choice = await vscode.window.showErrorMessage(
    `${validation.headline}\n\n${validation.detail || "別アプリの保存先と混ざる可能性があります。"}`,
    { modal: true },
    "保存を中止",
    "クラウドタブで確認"
  );
  if (choice === "クラウドタブで確認") {
    vscode.commands.executeCommand("noraops.openHome");
  }
  return false;
}

module.exports = {
  fetchRegistryByGiteaId,
  refreshGiteaBindingQuiet,
  validateBindingBeforeSave,
  confirmBindingConflictOrProceed,
};
