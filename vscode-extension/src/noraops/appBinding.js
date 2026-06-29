const { readNoraManifest } = require("./appEntry");
const { readWorkspaceSession, writeWorkspaceSession, recordAppAccess } = require("./pathsMeta");
const { getNoraOpsRepoMeta, bindNoraOpsRepo } = require("./repoMeta");
const { getNoraOpsConfig } = require("./config");
const { requestJson } = require("./noraopsApi");
const { newAppId } = require("./appIdentity");
const { ensurePublishScaffold } = require("./scaffold");

async function fetchRegistryByAppId(appId) {
  const { serverBaseUrl } = getNoraOpsConfig();
  if (!serverBaseUrl || !appId) return { found: false };
  try {
    const { status, json } = await requestJson(
      "GET",
      `${serverBaseUrl.replace(/\/$/, "")}/api/v1/noraops/apps/binding?app_id=${encodeURIComponent(appId)}`
    );
    if (status === 200 && json) return json;
  } catch {
    /* ignore */
  }
  return { found: false, appId };
}

async function fetchRegistryByRepo(owner, name) {
  const { serverBaseUrl } = getNoraOpsConfig();
  if (!serverBaseUrl || !owner || !name) return { found: false };
  try {
    const q = `owner=${encodeURIComponent(owner)}&name=${encodeURIComponent(name)}`;
    const { status, json } = await requestJson(
      "GET",
      `${serverBaseUrl.replace(/\/$/, "")}/api/v1/noraops/apps/binding?${q}`
    );
    if (status === 200 && json) return json;
  } catch {
    /* ignore */
  }
  return { found: false, owner, name };
}

/**
 * Compare manifest, local session, and server registry.
 * @returns {Promise<object>}
 */
async function analyzeAppBinding(workspaceRoot) {
  const { readCreatorProfile, MODES } = require("./creatorWorkflow");
  const importMode = readCreatorProfile(workspaceRoot) === MODES.IMPORT;

  const manifest = readNoraManifest(workspaceRoot);
  const session = readWorkspaceSession(workspaceRoot);
  const meta = getNoraOpsRepoMeta(workspaceRoot);

  const manifestAppId = manifest?.appId || null;
  const sessionAppId = session?.appId || null;
  const sessionRepo = meta?.fullName || null;

  const [registryByApp, registryByRepo] = await Promise.all([
    manifestAppId ? fetchRegistryByAppId(manifestAppId) : Promise.resolve({ found: false }),
    meta ? fetchRegistryByRepo(meta.owner, meta.name) : Promise.resolve({ found: false }),
  ]);

  const registryRepo =
    registryByApp?.found ? `${registryByApp.owner}/${registryByApp.name}` : null;

  const issues = [];
  let status = "ok";
  let headline = "保存先とアプリ ID は一致しています";
  let detail = "";

  if (!manifestAppId) {
    if (importMode) {
      status = "info";
      headline = "公開設定は保存時に自動で整います";
      detail = "「はじめて保存」で Gitea へ送れます。";
      issues.push({ code: "no_manifest_appid", severity: "info" });
    } else {
      status = "warn";
      headline = "公開用の設定ファイルが未整備です";
      detail = "雛形を入れるか、nora/manifest.json を確認してください。";
      issues.push({ code: "no_manifest_appid", severity: "warn" });
    }
  }

  if (manifestAppId && sessionAppId && manifestAppId !== sessionAppId) {
    status = "error";
    headline = "PC 記録の appId と manifest が食い違っています";
    detail = `manifest: ${manifestAppId}\nPC 記録: ${sessionAppId}`;
    issues.push({
      code: "session_manifest_appid",
      severity: "error",
      manifestAppId,
      sessionAppId,
    });
  }

  if (registryRepo && sessionRepo && registryRepo !== sessionRepo) {
    status = "error";
    headline = "PC の保存先とサーバー登録が一致しません";
    detail = `サーバー登録: ${registryRepo}\nPC 記録: ${sessionRepo}`;
    issues.push({
      code: "session_repo_registry",
      severity: "error",
      registryRepo,
      sessionRepo,
    });
  }

  if (registryByRepo?.found && manifestAppId && registryByRepo.appId !== manifestAppId) {
    status = "error";
    headline = "このリポジトリは別のアプリ ID に紐づいています";
    detail = `リポジトリ登録: ${registryByRepo.appId}\nmanifest: ${manifestAppId}`;
    issues.push({
      code: "repo_manifest_appid",
      severity: "error",
      registryAppId: registryByRepo.appId,
      manifestAppId,
    });
  }

  if (!sessionRepo && registryByApp?.found) {
    if (status === "ok") status = "warn";
    headline = "サーバーには登録済みですが、PC に保存先がありません";
    detail = `登録先: ${registryRepo}`;
    issues.push({ code: "unbound_session", severity: "warn", registryRepo });
  }

  if (!registryByApp?.found && sessionRepo && manifestAppId) {
    if (status === "ok") status = "warn";
    headline = "保存先は PC に記録されています（サーバー未登録の可能性）";
    detail = "初回保存が完了するとサーバーにも登録されます。";
    issues.push({ code: "repo_not_in_registry", severity: "info" });
  }

  const actions = {
    syncSessionAppId: !!(manifestAppId && sessionAppId && manifestAppId !== sessionAppId),
    switchToRegistryRepo: !!(
      registryByApp?.found &&
      registryRepo &&
      sessionRepo !== registryRepo
    ),
    createNewRepo: true,
  };

  if (importMode && status === "ok") {
    headline = "Gitea への保存の準備ができています";
    detail = sessionRepo
      ? "「保存」でコードを送れます。"
      : "「はじめて保存」でリポジトリ名を決めて送れます。";
  }

  return {
    ok: status === "ok",
    status,
    headline,
    detail,
    importMode,
    manifestAppId,
    sessionAppId,
    sessionRepo,
    registryRepo,
    registryByApp,
    registryByRepo,
    issues,
    actions,
  };
}

function syncSessionAppIdFromManifest(workspaceRoot) {
  const manifest = readNoraManifest(workspaceRoot);
  if (!manifest?.appId) return { ok: false, reason: "no_manifest_appid" };
  const session = readWorkspaceSession(workspaceRoot);
  if (session?.appId === manifest.appId) return { ok: true, skipped: true, appId: manifest.appId };
  writeWorkspaceSession(workspaceRoot, { appId: manifest.appId });
  recordAppAccess(workspaceRoot, { appId: manifest.appId });
  return { ok: true, appId: manifest.appId, previous: session?.appId || null };
}

function switchSessionToRegistryRepo(workspaceRoot, registry) {
  if (!registry?.found) return { ok: false, reason: "registry_not_found" };
  bindNoraOpsRepo(workspaceRoot, {
    owner: registry.owner,
    name: registry.name,
    fullName: registry.fullName || `${registry.owner}/${registry.name}`,
    appId: registry.appId,
    giteaRepoId: registry.giteaRepoId,
  });
  recordAppAccess(workspaceRoot, {
    appId: registry.appId,
    giteaFullName: registry.fullName || `${registry.owner}/${registry.name}`,
    giteaOwner: registry.owner,
    giteaName: registry.name,
  });
  return {
    ok: true,
    fullName: registry.fullName || `${registry.owner}/${registry.name}`,
    appId: registry.appId,
  };
}

function clearLocalRepoBinding(workspaceRoot) {
  writeWorkspaceSession(workspaceRoot, {
    giteaFullName: null,
    giteaOwner: null,
    giteaName: null,
    cloneUrl: null,
    giteaRepoId: null,
  });
  return { ok: true };
}

function assignNewAppIdForNewRepo(workspaceRoot, displayName) {
  const appId = newAppId();
  const manifest = readNoraManifest(workspaceRoot);
  const label = displayName || manifest?.displayName || "アプリ";
  ensurePublishScaffold(workspaceRoot, {
    appId,
    displayName: label,
  });
  clearLocalRepoBinding(workspaceRoot);
  writeWorkspaceSession(workspaceRoot, { appId });
  recordAppAccess(workspaceRoot, { appId, displayName: label });
  return { ok: true, appId, displayName: label };
}

module.exports = {
  fetchRegistryByAppId,
  fetchRegistryByRepo,
  analyzeAppBinding,
  syncSessionAppIdFromManifest,
  switchSessionToRegistryRepo,
  clearLocalRepoBinding,
  assignNewAppIdForNewRepo,
};
