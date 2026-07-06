const vscode = require("vscode");
const { getNoraOpsConfig } = require("./config");
const { loadRulesBundle, readBundledRules } = require("./rulesClient");
const { refreshRuntimeConfig } = require("./runtimeConfig");
const { runChecks } = require("./checkRunner");

let cachedRules = readBundledRules();
let cachedEtag = null;
let lastOnline = false;
let lastSummary = null;

async function refreshRules() {
  const { rulesUrl, serverBaseUrl } = getNoraOpsConfig();
  const [result] = await Promise.all([
    loadRulesBundle(rulesUrl, cachedEtag),
    refreshRuntimeConfig(serverBaseUrl),
  ]);
  lastOnline = result.online;
  if (result.bundle) {
    cachedRules = result.bundle;
    cachedEtag = result.etag || result.bundle.etag || null;
  } else if (result.useCache && cachedRules) {
    /* 304 — keep cachedRules */
  } else if (!result.online) {
    cachedRules = readBundledRules();
    cachedEtag = null;
  }
  return lastOnline;
}

function getActiveRulesBundle() {
  return cachedRules;
}

async function saveWorkspaceDocuments() {
  const unsaved = vscode.workspace.textDocuments.filter((d) => d.isDirty && !d.isUntitled);
  for (const doc of unsaved) {
    await doc.save();
  }
}

async function runNoraOpsSave(options = {}) {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    vscode.window.showWarningMessage("フォルダを開いてから保存してください。");
    return null;
  }

  const ws = folder.uri.fsPath;
  const { ensurePublishScaffold } = require("./scaffold");
  const scaffolded = ensurePublishScaffold(ws);
  if (scaffolded.created?.length) {
    vscode.window.showInformationMessage(
      `NoraOps の雛形を追加しました: ${scaffolded.created.join(", ")}`
    );
  }

  const { pickSaveAction, executeSaveAction } = require("./saveFlow");
  const { hasNoraOpsRepoBinding } = require("./repoSetup");
  let action = options.action;
  if (!action) {
    action = hasNoraOpsRepoBinding(ws) ? "push" : "new-repo";
  } else if (action === "new-repo" && !options.forceNewRepo && hasNoraOpsRepoBinding(ws)) {
    action = "push";
  }
  if (action === "cancel") return null;

  await saveWorkspaceDocuments();

  const { ensureEntryOnSave } = require("./entryPicker");
  const entryResult = await ensureEntryOnSave(ws);
  if (entryResult.cancelled) return null;
  if (!entryResult.ok) return null;

  const online = await refreshRules();
  const summary = runChecks(ws, cachedRules, online);
  lastSummary = summary;

  const wantsPublish = action === "release" || options.publishRunner === true;
  if (wantsPublish) {
    const { validateReleaseReadiness } = require("./releaseValidation");
    const v = validateReleaseReadiness(ws, summary);
    const publishLabel = action === "release" ? "公開リリース" : "Runner 公開";
    if (!v.ok) {
      vscode.window.showErrorMessage(
        `${publishLabel}を中止しました:\n` + v.errors.join("\n"),
        { modal: true }
      );
      return null;
    }
    if (v.warnings.length) {
      const cont = await vscode.window.showWarningMessage(
        `${publishLabel}の警告:\n` + v.warnings.join("\n"),
        { modal: true },
        "続行",
        "キャンセル"
      );
      if (cont !== "続行") return null;
    }
  }

  try {
    const { ensureLaunchConfig, isLikelyNoraOpsWorkspace } = require("./launchConfig");
    if (isLikelyNoraOpsWorkspace(ws)) ensureLaunchConfig(ws);
  } catch {
    /* ignore */
  }
  const { publishSecurityDiagnostics } = require("./securityDiagnostics");
  publishSecurityDiagnostics(ws, summary);

  const ts = new Date();
  const stamp = ts.toLocaleString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  let push = { ok: false, skipped: true };
  let publish = { ok: false, skipped: true };
  let versionInfo = null;
  let saveSnapshot = null;
  const cfg = getNoraOpsConfig();

  if (action === "local-only") {
    push = { ok: false, skipped: true, localOnly: true };
  } else if (online && cfg.pushOnSave !== false) {
    const result = await executeSaveAction(ws, action, {
      forceNewRepo: options.forceNewRepo === true,
      newAppIdentity: options.newAppIdentity === true,
      checkSummary: summary,
      publishRunner: options.publishRunner === true,
      publishVersion: options.publishVersion || "",
      legacyAutoPublish: false,
    });
    push = result.push || push;
    publish = result.publish || publish;
    if (result.version) {
      versionInfo = { version: result.version, tag: result.tag, released: result.released };
    } else if (result.versionInfo) {
      versionInfo = result.versionInfo;
    }
  } else if (!online) {
    push = { ok: false, offline: true };
  }

  const { recordAppAccess } = require("./pathsMeta");
  const { bindNoraOpsRepo } = require("./repoMeta");
  if (push.ok && push.fullName) {
    const [o, n] = push.fullName.includes("/") ? push.fullName.split("/", 2) : [];
    if (o && n) bindNoraOpsRepo(ws, { owner: o, name: n, fullName: push.fullName });
  }
  const didPublish =
    publish.ok === true ||
    action === "release" ||
    options.publishRunner === true ||
    push.published === true;
  if (push.ok && !didPublish) {
    try {
      const { createSaveSnapshot } = require("./saveHistory");
      saveSnapshot = createSaveSnapshot(ws, {
        label: `クラウド保存 ${stamp}`,
        fullName: push.fullName || undefined,
        branch: push.branch || undefined,
      });
    } catch (e) {
      console.warn("NoraOps: save history snapshot skipped:", e.message);
    }
  }

  recordAppAccess(ws, {
    lastSave: stamp,
    lastPushOk: push.ok === true,
    online,
    secIssues: summary.secErrors?.length || 0,
    polIssues: summary.polErrors?.length || 0,
    lastPublished: publish.ok ? publish.fullName : undefined,
    lastPublishedVersion:
      publish.ok && versionInfo?.version ? versionInfo.version : undefined,
    lastPublishedTag: publish.ok && versionInfo?.tag ? versionInfo.tag : undefined,
    lastPublishedAt: publish.ok ? new Date().toISOString() : undefined,
    giteaFullName: push.ok ? push.fullName : undefined,
  });

  const { refreshHomePanel } = require("./homePanel");
  await refreshHomePanel();

  if (push.ok && publish.ok) {
    const open = await vscode.window.showInformationMessage(
      versionInfo?.released
        ? `公開リリース完了（${versionInfo.tag}）— Runner に掲載しました（${publish.fullName}）。`
        : `Gitea に保存し、Runner 用に公開しました（${publish.fullName}）。`,
      "アプリを使う",
      "閉じる"
    );
    if (open === "アプリを使う") {
      await vscode.commands.executeCommand("noraops.openRunner");
    }
  } else if (push.ok && publish && publish.ok === false && !publish.skipped) {
    const { describePublishFailureDetail } = require("./publishFailureDetail");
    const detail = describePublishFailureDetail(publish, push);
    if (detail) {
      const stepText = detail.steps?.length
        ? "\n\n【対処手順】\n" + detail.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")
        : "";
      await vscode.window.showWarningMessage(detail.title, {
        modal: true,
        detail: detail.body + stepText,
      });
    }
  } else if (push.ok && versionInfo) {
    const label = versionInfo.released ? "公開リリース" : "保存";
    vscode.window.showInformationMessage(
      `${label}: バージョン ${versionInfo.version}（${versionInfo.tag}）`
    );
  } else if (push.ok) {
    const fullName = push.fullName || require("./repoMeta").getNoraOpsRepoMeta(ws)?.fullName;
    let msg = fullName
      ? `Gitea（${fullName}）にコードを保存しました。\n保存時刻: ${stamp}`
      : `Gitea にコードを保存しました。\n保存時刻: ${stamp}`;
    if (push.branch) {
      msg += `\n保存ブランチ: ${push.branch}`;
      if (push.saveMode === "draft") {
        msg +=
          "\n下書き用のコピーとしてクラウドに送りました。この PC にも直近2件までバックアップを残しています。";
      }
    }
    if (saveSnapshot) {
      msg += `\nこの PC のバックアップ: ${saveSnapshot.label}（保存タブから元に戻せます）`;
    }
    if (publish?.reason === "security_warn_unreviewed") {
      msg += "\nRunner 公開はセキュリティ警告の確認が必要なためスキップしました。";
    }
    vscode.window.showInformationMessage(msg);
  }

  return { summary, online, push, publish, stamp, action, versionInfo, saveSnapshot };
}

function getLastCheckSummary() {
  return lastSummary;
}

async function runWorkspaceChecks(workspaceRoot) {
  const summary = runChecks(workspaceRoot, cachedRules, lastOnline);
  lastSummary = summary;
  return summary;
}

function countSecErrors(summary) {
  if (!summary) return 0;
  return summary.secErrors?.length || 0;
}

module.exports = {
  runNoraOpsSave,
  getLastCheckSummary,
  runWorkspaceChecks,
  countSecErrors,
  refreshRules,
  getActiveRulesBundle,
  isLastOnline: () => lastOnline,
};
