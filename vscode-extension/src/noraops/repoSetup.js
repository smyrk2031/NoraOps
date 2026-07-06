const path = require("path");
const vscode = require("vscode");
const { getNoraOpsConfig } = require("./config");
const { recordAppAccess } = require("./pathsMeta");
const { getNoraOpsRepoMeta, bindNoraOpsRepo } = require("./repoMeta");
const { checkRepoName, provisionRepo } = require("./noraopsApi");
const { ensurePublishScaffold } = require("./scaffold");
const { runGit, ensureRepo } = require("./gitExec");
const { newAppId, normalizeAppId, repoSlugFromLabel } = require("./appIdentity");

function buildRemoteUrl(giteaBase, owner, repoName) {
  const base = giteaBase.replace(/\/$/, "");
  return `${base}/${owner}/${repoName}.git`;
}

function isAutoHashSlug(slug, displayName) {
  return /^app-[a-f0-9]{6,}$/i.test(slug) && slug !== repoSlugFromLabel(displayName);
}

async function hasOrigin(workspaceRoot) {
  try {
    const remotes = await runGit(workspaceRoot, ["remote"]);
    return remotes.split("\n").includes("origin");
  } catch {
    return false;
  }
}

function hasNoraOpsRepoBinding(workspaceRoot) {
  return !!getNoraOpsRepoMeta(workspaceRoot);
}

async function resolveAvailableSlug(cfg, preferredSlug) {
  let slug = preferredSlug;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const check = await checkRepoName(cfg.serverBaseUrl, slug, cfg.giteaDefaultOwner || null);
    slug = check.name;
    if (check.available) return slug;
    slug = `${preferredSlug}-${attempt + 2}`;
  }
  return null;
}

async function promptCustomSlug(initial) {
  let slug = initial;
  for (;;) {
    const value = await vscode.window.showInputBox({
      title: "保存先の名前（英数字）",
      prompt: "半角英数字で付けられます。被っていたら数字を足してください。",
      value: slug,
      validateInput: (v) => {
        if (!v || !v.trim()) return "名前を入力してください";
        const s = repoSlugFromLabel(v.trim());
        if (!s || s.length < 2) return "2文字以上にしてください";
        return null;
      },
    });
    if (!value) return null;
    slug = repoSlugFromLabel(value.trim());
    try {
      const cfg = getNoraOpsConfig();
      const resolved = await resolveAvailableSlug(cfg, slug);
      if (resolved) return resolved;
      vscode.window.showWarningMessage(`「${slug}」はすでに使われています。別の名前にしてください。`);
      slug = `${slug}-2`;
    } catch (e) {
      vscode.window.showWarningMessage(`名前の確認に失敗: ${e.message}`);
      return null;
    }
  }
}

/**
 * 初回のみ：表示名 1 回 + 確認 1 回（再入力なし）。
 */
async function promptAppIdentity(workspaceRoot) {
  const folderName = path.basename(workspaceRoot);
  const displayName = await vscode.window.showInputBox({
    title: "アプリの名前",
    prompt: "みんなに見える名前です（日本語 OK）。例: 請求ツール",
    value: folderName,
    validateInput: (v) => (v && v.trim().length >= 1 ? null : "名前を入力してください"),
  });
  if (!displayName) return null;

  const label = displayName.trim();
  const cfg = getNoraOpsConfig();
  let slug;
  try {
    slug = await resolveAvailableSlug(cfg, repoSlugFromLabel(label));
  } catch (e) {
    vscode.window.showWarningMessage(`名前の確認に失敗: ${e.message}`);
    return null;
  }
  if (!slug) {
    vscode.window.showErrorMessage("使える保存先の名前が見つかりませんでした。別の名前を試してください。");
    return null;
  }

  const hashNote = isAutoHashSlug(slug, label)
    ? `\n\n※ クラウド上の内部名は「${slug}」です。画面に表示されるのは「${label}」のままです。`
    : "";

  const detail =
    `表示名: ${label}\n` +
    `保存先: ${slug}` +
    hashNote +
    `\n\nこのアプリ専用の保存先として登録します。`;

  for (;;) {
    const pick = await vscode.window.showInformationMessage(
      `「${label}」をクラウドに登録します`,
      { modal: true, detail },
      "この名前で登録",
      "別の保存先名にする",
      "やめる"
    );
    if (pick === "やめる" || !pick) return { cancelled: true };
    if (pick === "この名前で登録") {
      const { readNoraManifest } = require("./appEntry");
      const manifest = readNoraManifest(workspaceRoot);
      const appId = manifest?.appId ? normalizeAppId(manifest.appId) : newAppId();
      return { displayName: label, slug, appId };
    }
    const custom = await promptCustomSlug(slug);
    if (!custom) continue;
    slug = custom;
  }
}

async function ensureGiteaRemote(workspaceRoot, options = {}) {
  const forceNew = options.forceNew === true;
  const existing = getNoraOpsRepoMeta(workspaceRoot);
  if (existing && !forceNew) {
    return {
      ok: true,
      skipped: true,
      reason: "has_binding",
      owner: existing.owner,
      name: existing.name,
      fullName: existing.fullName,
    };
  }

  if (forceNew && existing) {
    const { clearLocalRepoBinding, assignNewAppIdForNewRepo } = require("./appBinding");
    if (options.newAppIdentity === true) {
      const manifest = require("./appEntry").readNoraManifest(workspaceRoot);
      assignNewAppIdForNewRepo(workspaceRoot, manifest?.displayName);
    } else {
      clearLocalRepoBinding(workspaceRoot);
    }
  }

  const cfg = getNoraOpsConfig();
  if (!cfg.giteaBaseUrl) {
    return {
      ok: false,
      reason: "no_gitea_config",
      message: "サーバー設定がありません。NoraOps の「設定」タブを確認してください。",
    };
  }
  if (!cfg.serverBaseUrl) {
    return {
      ok: false,
      reason: "no_server",
      message:
        "サーバーに接続できません。「設定」タブを確認してください。" +
        ` 接続先: ${cfg.serverBaseUrl || "未設定"}`,
    };
  }

  const identity = await promptAppIdentity(workspaceRoot);
  if (!identity) return { ok: false, reason: "cancelled" };
  if (identity.cancelled) return { ok: false, reason: "cancelled" };

  const { displayName, slug, appId: identityAppId } = identity;
  const { readNoraManifest, writeNoraManifestPatch } = require("./appEntry");
  const manifest = readNoraManifest(workspaceRoot);
  const appIdForProvision =
    forceNew && options.newAppIdentity
      ? normalizeAppId(identityAppId)
      : normalizeAppId(manifest?.appId || identityAppId);

  let provisioned;
  try {
    provisioned = await provisionRepo(cfg.serverBaseUrl, {
      name: slug,
      owner: cfg.giteaDefaultOwner || null,
      displayName,
      appId: appIdForProvision,
    });
  } catch (e) {
    return { ok: false, reason: "provision_failed", message: e.message };
  }

  if (provisioned.conflict || provisioned.ok === false) {
    const code = provisioned.code || "name_conflict";
    const msg =
      code === "app_id_conflict"
        ? "別のアプリの保存先と混ざってしまいます。管理者に連絡してください。"
        : "同じ名前がすでに使われています。別の名前を選んでください。";
    vscode.window.showErrorMessage(msg);
    return { ok: false, reason: code, message: provisioned.message || msg };
  }

  const boundAppId = normalizeAppId(provisioned.app_id || appIdForProvision);
  writeNoraManifestPatch(workspaceRoot, {
    appId: boundAppId,
    displayName,
    appSlug: slug,
  });
  const { giteaRepoIdFromProvision } = require("./giteaRepoId");
  // クラウド保存はサーバー側 git のみ。ローカル git が失敗しても紐づけは必ず残す。
  bindNoraOpsRepo(workspaceRoot, {
    owner: provisioned.owner,
    name: provisioned.name,
    fullName: provisioned.full_name,
    cloneUrl: provisioned.clone_url,
    appId: boundAppId,
    giteaRepoId: giteaRepoIdFromProvision(provisioned),
  });
  recordAppAccess(workspaceRoot, {
    appId: boundAppId,
    displayName,
    giteaFullName: provisioned.full_name,
    giteaOwner: provisioned.owner,
    giteaName: provisioned.name,
    cloneUrl: provisioned.clone_url,
    giteaRepoId: giteaRepoIdFromProvision(provisioned),
  });

  const { ensurePublishScaffold } = require("./scaffold");
  ensurePublishScaffold(workspaceRoot, {
    appId: boundAppId,
    displayName,
    appSlug: slug,
  });

  const remoteUrl = buildRemoteUrl(cfg.giteaBaseUrl, provisioned.owner, provisioned.name);
  try {
    await ensureRepo(workspaceRoot);
    try {
      await runGit(workspaceRoot, ["remote", "add", "origin", remoteUrl]);
    } catch (e) {
      if (!/already exists/i.test(String(e.message || e))) {
        throw e;
      }
      await runGit(workspaceRoot, ["remote", "set-url", "origin", remoteUrl]);
    }
  } catch (e) {
    console.warn("NoraOps: local git metadata skipped (cloud save unaffected):", e.message);
  }

  return {
    ok: true,
    provisioned,
    owner: provisioned.owner,
    name: provisioned.name,
    fullName: provisioned.full_name,
    appId: boundAppId,
  };
}

module.exports = {
  ensureGiteaRemote,
  hasOrigin,
  hasNoraOpsRepoBinding,
  promptAppIdentity,
  isAutoHashSlug,
};
