const fs = require("fs");
const path = require("path");
const vscode = require("vscode");
const { getNoraOpsConfig } = require("./config");
const { hasNoraOpsRepoBinding, ensureGiteaRemote } = require("./repoSetup");
const { saveViaServer } = require("./serverSave");
const { publishRepo } = require("./noraopsApi");
const { getNoraOpsRepoMeta, detectForeignGitOrigin, bindNoraOpsRepo } = require("./repoMeta");
const { bumpProjectPatchVersion, writeProjectVersion } = require("./versionUtil");

async function pickSaveAction(workspaceRoot) {
  const options = await getSaveOptions(workspaceRoot);
  const pick = await vscode.window.showQuickPick(
    options.map((o) => ({
      label: o.label,
      description: o.description,
      id: o.id,
    })),
    { title: "NoraOps 保存", placeHolder: "保存のしかたを選んでください" }
  );
  return pick?.id || "cancel";
}

async function getSaveOptions(workspaceRoot) {
  const bound = hasNoraOpsRepoBinding(workspaceRoot);
  const foreign = await detectForeignGitOrigin(workspaceRoot);
  if (!bound) {
    const opts = [
      {
        id: "new-repo",
        label: "新しいアプリとして保存",
        description: "名前を決めてクラウドに登録します（初回）",
        recommended: true,
        primary: true,
      },
    ];
    if (foreign.foreign) {
      opts.unshift({
        id: "warn-foreign-git",
        label: `⚠ 別プロジェクトの Git が検出: ${foreign.git.fullName}`,
        description: "このままでは誤ったリポに送られます。新規作成を選んでください",
        recommended: false,
      });
    }
    return opts;
  }
  const meta = getNoraOpsRepoMeta(workspaceRoot);
  return [
    {
      id: "push",
      label: "保存",
      description: `${meta?.fullName || ""} に送る`,
      recommended: true,
      primary: true,
    },
    {
      id: "release",
      label: "公開リリース",
      description: "版番号を上げ、厳格チェック後に Runner 公開（topic 付与）",
      recommended: false,
      release: true,
    },
    {
      id: "new-repo",
      label: "別名で新規リポジトリを作成",
      description: "別の Gitea リポジトリ名で新規作成して保存",
      recommended: false,
    },
    {
      id: "version",
      label: "バージョンのみ上げて保存",
      description: "版番号を上げて zip で保存（公開チェックなし）",
      recommended: false,
    },
  ];
}

async function getSaveContext(workspaceRoot) {
  const { ensureDefaultLaunchEntry } = require("./entryPicker");
  const { buildReleaseInfo } = require("./releaseInfo");
  ensureDefaultLaunchEntry(workspaceRoot);
  const cfg = getNoraOpsConfig();
  const { isLastOnline } = require("./savePipeline");
  const { refreshRuntimeConfig } = require("./runtimeConfig");
  const runtime = await refreshRuntimeConfig(cfg.serverBaseUrl).catch(() => null);
  const serverOnline = runtime?.online === true || isLastOnline();
  const session = require("./pathsMeta").readWorkspaceSession(workspaceRoot);
  const { readNoraManifest } = require("./appEntry");
  const man = readNoraManifest(workspaceRoot);
  let launchEntry = null;
  if (man?.entryKind === "module" && man.entryModule) {
    launchEntry = `python -m ${man.entryModule}`;
  } else if (man?.entry) {
    launchEntry = man.entry;
  }
  const { thumbnailAbsPath } = require("./thumbnailAsset");
  const thumbPath = thumbnailAbsPath(workspaceRoot);
  const meta = getNoraOpsRepoMeta(workspaceRoot);
  let publishState = null;
  if (meta && cfg.serverBaseUrl) {
    try {
      const { fetchPublishState } = require("./noraopsApi");
      const { readVersion } = require("./versionUtil");
      publishState = await fetchPublishState(
        cfg.serverBaseUrl,
        meta.owner,
        meta.name,
        readVersion(workspaceRoot)
      );
    } catch {
      publishState = null;
    }
  }
  const { listSaveSnapshots } = require("./saveHistory");
  return {
    ready: true,
    hasRemote: hasNoraOpsRepoBinding(workspaceRoot),
    foreignGit: await detectForeignGitOrigin(workspaceRoot),
    serverConfigured: !!cfg.serverBaseUrl,
    giteaConfigured: !!(cfg.giteaBaseUrl && cfg.serverBaseUrl),
    serverBaseUrl: cfg.serverBaseUrl || null,
    giteaBaseUrl: cfg.giteaBaseUrl || null,
    serverOnline,
    giteaFullName: session?.giteaFullName || null,
    launchEntry,
    thumbnailUrl: fs.existsSync(thumbPath) ? thumbPath : null,
    options: await getSaveOptions(workspaceRoot),
    releaseInfo: buildReleaseInfo(workspaceRoot),
    publishState,
    saveSnapshots: listSaveSnapshots(workspaceRoot),
  };
}

function describePushFailureDetail(push) {
  if (!push || push.ok || push.skipped || push.localOnly || push.offline) return null;
  const reason = push.reason || "";
  const msg = push.message || reason;
  const httpStatus = push.httpStatus;

  const base = { kind: "warn", steps: [], offerSetup: false };

  if (reason === "cancelled" || reason === "binding_conflict") {
    const isBinding = reason === "binding_conflict";
    return {
      ...base,
      title: isBinding ? "保存を中止しました（紐づけ確認）" : "保存をキャンセルしました",
      body: isBinding
        ? msg ||
          "保存先の appId や Gitea 登録に食い違いがあるため、安全のため送信を止めました。\n「クラウド」タブの紐づけ状態を確認するか、「PC 記録を manifest に合わせる」を試してください。"
        : "操作は中断されました。",
      steps: isBinding
        ? [
            "「クラウド」タブを開き、紐づけ状態を確認する",
            "manifest の appId と PC 記録がずれていれば「PC 記録を manifest に合わせる」",
            "接続 OK なのに「サーバー未登録」と出る場合も、保存完了でサーバー登録されます",
          ]
        : [],
    };
  }

  if (reason === "no_remote" || reason === "no_binding") {
    return {
      ...base,
      title: "クラウド未登録",
      body: "このフォルダはまだクラウド（Gitea）に登録されていません。",
      steps: [
        "「クラウド」を開き「はじめて保存する」を押す",
        "表示される名前で新しいリポジトリを作成する",
      ],
    };
  }

  if (reason === "name_conflict") {
    return {
      ...base,
      title: "同じ名前のアプリがあります",
      body: "クラウド上に同じ名前のリポジトリがすでに存在します。",
      steps: [
        "別の表示名で新しいアプリを作る",
        "または、既存アプリのフォルダを開いて続きから編集する",
      ],
    };
  }

  const isAppConflict =
    reason === "app_id_conflict" ||
    httpStatus === 409 ||
    /Wrong app|already bound|belongs to|does not match manifest|Request app_id|appId|Repository .* requires nora\/manifest/i.test(
      msg
    );

  if (isAppConflict) {
    let body =
      "保存しようとしたリポジトリは、別のアプリに紐づいています。このフォルダの appId と一致しないため、上書きを止めました。";
    const manifestMismatch = msg.match(/Request app_id (.+?) does not match manifest (.+?)\.?$/i);
    if (manifestMismatch) {
      body =
        `送信しようとした appId「${manifestMismatch[1].trim()}」と manifest「${manifestMismatch[2].trim()}」が一致しません。\n\n「クラウド」を開くと紐づけ状態が表示されます。`;
    } else {
      const expectedGot = msg.match(/Expected ([^,]+), got ([^.]+)/i);
      if (expectedGot) {
        body = `保存先は appId「${expectedGot[1].trim()}」用ですが、このフォルダは「${expectedGot[2].trim()}」です。`;
      } else if (/already bound to a different app/i.test(msg)) {
        body = "このリポジトリはすでに別のアプリ ID に登録されています。";
      } else if (/belongs to ([^,]+), not/i.test(msg)) {
        const m = msg.match(/belongs to ([^,]+), not ([^.]+)/i);
        if (m) body = `この appId は「${m[1].trim()}」用です。今の保存先「${m[2].trim()}」には保存できません。`;
      } else if (msg) {
        body = msg;
      }
    }
    return {
      ...base,
      title: "保存先とアプリが一致しません",
      body,
      steps: [
        "「クラウド」を開き、上部の「紐づけ状態」を確認する",
        "ずれている場合は「PC 記録を manifest に合わせる」または「正しい保存先に切り替える」を押す",
        "別のリポジトリに保存したい場合は「新しいリポジトリを作成」を使う",
        "解決しない場合は、manifest の appId と保存先名を管理者に伝える",
      ],
    };
  }

  if (reason === "zip_too_large" || httpStatus === 413) {
    return {
      ...base,
      title: "ファイルが大きすぎます",
      body: msg || "送る zip がサーバーの上限を超えています。",
      steps: [
        "不要な大きなファイル（データ・画像・venv など）をフォルダから除く",
        ".venv は含めない（この PC 内だけで使う）",
        "除いたあと、もう一度「保存する」を押す",
      ],
    };
  }

  if (
    reason === "no_gitea_config" ||
    reason === "no_server" ||
    reason === "server_unavailable" ||
    /503|502|504|timeout|ECONNREFUSED|fetch failed/i.test(msg)
  ) {
    const cfg = getNoraOpsConfig();
    return {
      ...base,
      title: "サーバーに接続できません",
      body:
        "ネットワークまたはサーバー設定の問題で、クラウドへ送れませんでした。\n" +
        `接続先: ${cfg.serverBaseUrl || "未設定"}` +
        (msg ? `\n詳細: ${msg}` : ""),
      steps: [
        "NoraOps の「設定（サーバー接続）」を開く",
        "ポータル URL を確認し「接続テスト」を実行する",
        "テストが成功したら、もう一度「保存する」を押す",
      ],
      offerSetup: true,
    };
  }

  if (reason === "auth_denied" || /authentication|403|401|denied|permission|access_token/i.test(msg)) {
    return {
      ...base,
      title: "アクセスが拒否されました",
      body: "サーバーは応答しましたが、保存権限がありません。",
      steps: [
        "NoraOps の「設定（サーバー接続）」→ アカウントを開く",
        "メール登録と NoraAccessToken の設定が完了しているか確認する",
        "トークンを紛失した場合は「トークン再発行」からメールで再取得する",
      ],
      offerSetup: true,
    };
  }

  if (reason === "provision_failed") {
    return {
      ...base,
      title: "アプリの登録に失敗しました",
      body: msg || "新規リポジトリの作成に失敗しました。",
      steps: [
        "別の表示名で「はじめて保存する」を試す",
        "数分待ってから再度実行する",
        "続く場合は管理者に連絡する",
      ],
    };
  }

  if (
    reason === "server_save_failed" ||
    reason === "server_push_failed" ||
    reason === "bundle_failed" ||
    reason === "zip_failed"
  ) {
    return {
      ...base,
      title: "クラウドへの送信に失敗しました",
      body: msg ? `サーバーからの応答: ${msg}` : "原因不明のエラーです。",
      steps: [
        "「クラウド」で接続テスト（✓ サーバー接続 OK）になるか確認する",
        "上記のエラー内容を控え、管理者に連絡する",
        "この PC への保存は完了しているので、修正後にもう一度「保存する」を押す",
      ],
      offerSetup: !msg,
    };
  }

  return {
    ...base,
    title: "クラウドへの送信は未完了です",
    body: msg || "この PC には保存済みですが、クラウドへは送れませんでした。",
    steps: ["「クラウド」で接続状態を確認し、もう一度「保存する」を押してください"],
    offerSetup: true,
  };
}

function describePushFailure(push) {
  const d = describePushFailureDetail(push);
  if (!d) return null;
  let text = d.body;
  if (d.steps?.length) {
    text += "\n\n【対処手順】\n" + d.steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
  }
  return text;
}

async function tryPublishForRunner(workspaceRoot, summary = null) {
  const cfg = getNoraOpsConfig();
  if (cfg.publishOnSave === false) return { ok: false, skipped: true };
  const meta = getNoraOpsRepoMeta(workspaceRoot);
  if (!meta) return { ok: false, reason: "no_binding" };

  if (!summary) {
    const { refreshRules, getActiveRulesBundle } = require("./savePipeline");
    const { runChecks } = require("./checkRunner");
    await refreshRules();
    summary = runChecks(workspaceRoot, getActiveRulesBundle(), true);
  }
  const { blockPublishIfNeeded } = require("./securityWarnGate");
  const gate = await blockPublishIfNeeded(workspaceRoot, summary);
  if (!gate.ok) {
    return { ok: false, reason: gate.reason || "security_warn_unreviewed", message: gate.message };
  }

  try {
    await publishRepo(cfg.serverBaseUrl, meta.owner, meta.name);
    return { ok: true, fullName: meta.fullName };
  } catch (e) {
    vscode.window.showWarningMessage(
      `Runner への公開（topic）に失敗: ${e.message}\nトークンに write:repository があるか確認してください。`
    );
    return { ok: false, reason: e.message };
  }
}

async function executeSaveAction(workspaceRoot, action, options = {}) {
  if (action === "cancel" || action === "warn-foreign-git") {
    return { push: { ok: false, cancelled: true } };
  }
  if (action === "local-only") return { push: { ok: false, skipped: true, localOnly: true } };

  const foreign = await detectForeignGitOrigin(workspaceRoot);
  if (foreign.foreign && (action === "push" || action === "version")) {
    const cont = await vscode.window.showErrorMessage(
      foreign.message + "\n\n安全のため保存を止めました。",
      { modal: true },
      "新規アプリとして作る",
      "キャンセル"
    );
    if (cont !== "新規アプリとして作る") return { push: { ok: false, cancelled: true } };
    action = "new-repo";
  }

  if (action !== "new-repo") {
    const { validateBindingBeforeSave, confirmBindingConflictOrProceed } = require("./giteaBinding");
    const bindingCheck = await validateBindingBeforeSave(workspaceRoot);
    if (!(await confirmBindingConflictOrProceed(bindingCheck))) {
      return { push: { ok: false, cancelled: true, reason: "binding_conflict" } };
    }
  }

  if (action === "new-repo") {
    const remote = await ensureGiteaRemote(workspaceRoot, {
      forceNew: options.forceNewRepo === true,
      newAppIdentity: options.newAppIdentity === true,
    });
    if (!remote.ok) {
      return {
        push: {
          ok: false,
          reason: remote.reason || "provision_failed",
          message: remote.message || remote.reason,
        },
      };
    }
    try {
      const { refreshHomePanel } = require("./homePanel");
      await refreshHomePanel();
    } catch {
      /* UI refresh is best-effort */
    }
    const push = await saveViaServer(workspaceRoot, {
      owner: remote.owner,
      name: remote.name,
    });
    if (push.ok && remote.fullName) {
      const { bindNoraOpsRepo } = require("./repoMeta");
      bindNoraOpsRepo(workspaceRoot, {
        owner: remote.owner,
        name: remote.name,
        fullName: remote.fullName,
        giteaRepoId: push.giteaRepoId,
      });
    }
    const pub = push.ok ? await tryPublishForRunner(workspaceRoot, options.checkSummary) : { ok: false };
    return { push, publish: pub, provisioned: remote.provisioned };
  }

  async function runSave(saveOpts, meta) {
    const wantsPublish = saveOpts.publish === true;
    if (wantsPublish) {
      const { blockPublishIfNeeded } = require("./securityWarnGate");
      const gate = await blockPublishIfNeeded(workspaceRoot, options.checkSummary);
      if (!gate.ok) {
        return {
          push: { ok: false, reason: gate.reason || "security_warn_unreviewed", message: gate.message },
          publish: { ok: false, reason: gate.reason, message: gate.message },
        };
      }
    }
    const push = await saveViaServer(workspaceRoot, saveOpts);
    if (push.ok && meta) {
      bindNoraOpsRepo(workspaceRoot, {
        ...meta,
        giteaRepoId: push.giteaRepoId || meta.giteaRepoId,
      });
    }
    let publish = { ok: false, skipped: !wantsPublish };
    let versionInfo = null;
    if (push.published && push.publish) {
      publish = { ok: true, fullName: push.fullName, ...push.publish };
      versionInfo = { version: push.version, tag: push.tag, released: wantsPublish };
    } else if (wantsPublish && push.ok && push.publish && push.publish.ok === false) {
      publish = { ok: false, error: push.publish.error, message: push.publish.error };
    } else if (push.ok && !wantsPublish && options.legacyAutoPublish !== false) {
      const cfg = getNoraOpsConfig();
      if (cfg.publishOnSave !== false) {
        publish = await tryPublishForRunner(workspaceRoot, options.checkSummary);
      }
    }
    return { push, publish, versionInfo };
  }

  if (action === "push") {
    const meta = getNoraOpsRepoMeta(workspaceRoot);
    const saveOpts = {};
    if (options.publishRunner) {
      const ver = String(options.publishVersion || "").trim();
      if (!ver) {
        return {
          push: { ok: false, reason: "version_required", message: "Runner 公開には版番号が必要です。" },
          publish: { ok: false, skipped: true },
        };
      }
      writeProjectVersion(workspaceRoot, ver);
      saveOpts.publish = true;
      saveOpts.version = ver.replace(/^v/i, "");
      saveOpts.message = `Release v${saveOpts.version}`;
    }
    return runSave(saveOpts, meta);
  }

  if (action === "version") {
    const { version, tag } = bumpProjectPatchVersion(workspaceRoot);
    const meta = getNoraOpsRepoMeta(workspaceRoot);
    const result = await runSave({ message: `NoraOps ${tag}` }, meta);
    return { ...result, version, tag };
  }

  if (action === "release") {
    const ver = String(options.publishVersion || "").trim();
    const bumped = ver ? writeProjectVersion(workspaceRoot, ver) : bumpProjectPatchVersion(workspaceRoot);
    const { version, tag } = bumped;
    const meta = getNoraOpsRepoMeta(workspaceRoot);
    const result = await runSave(
      { message: `Release ${tag}`, publish: true, version },
      meta
    );
    return { ...result, version, tag, released: true };
  }

  return { push: { ok: false, reason: "unknown_action" } };
}

module.exports = {
  pickSaveAction,
  getSaveOptions,
  getSaveContext,
  describePushFailure,
  describePushFailureDetail,
  describePublishFailureDetail: require("./publishFailureDetail").describePublishFailureDetail,
  executeSaveAction,
  tryPublishForRunner,
};
