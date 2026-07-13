const fs = require("fs");
const path = require("path");
const vscode = require("vscode");
const { getNoraOpsConfig } = require("../config");
const { searchPublishedApps } = require("./catalogClient");
const { runPublishedApp, upgradePublishedApp } = require("./appRunner");
const {
  getRunnerHomeLists,
  recordRunnerAppRun,
  toggleRunnerPin,
  updatePinnedArtifactMeta,
} = require("../runnerAppPrefs");
const { listStorageEntries, touchRunnerUsage } = require("../localStorageScan");
const { enrichItemsWithThumbnails } = require("./runnerThumbnails");
const { checkRunnerAppUpdates } = require("./runnerUpdateCheck");
const { createStaleCache } = require("../panelStateCache");
const { listLocalApps } = require("../localRunnerRegistry");
const { importRunnerZip } = require("./runnerZipImport");
const { createRunnerDesktopShortcut } = require("./runnerDesktopShortcut");

let runnerPanel;
let runnerRefreshGen = 0;
const runnerStateCache = createStaleCache(20000);

function buildStorageLine() {
  try {
    const data = listStorageEntries();
    const runnerN = data.entries.filter((e) => e.kind === "runner").length;
    return `ローカル ${data.totalMb} MB · Runner 環境 ${runnerN} 件（「整理」で削除）`;
  } catch {
    return "";
  }
}

async function enrichHomeLists(serverBaseUrl, pinned, recent) {
  const pinThumbs = await enrichItemsWithThumbnails(serverBaseUrl, pinned);
  const recThumbs = await enrichItemsWithThumbnails(serverBaseUrl, recent);
  return { pinned: pinThumbs, recent: recThumbs };
}

async function buildState(options = {}) {
  const cfg = getNoraOpsConfig();
  const { pinned, recent } = getRunnerHomeLists();
  const fast = options.fast === true;
  let pinnedT = pinned;
  let recentT = recent;
  if (!fast) {
    ({ pinned: pinnedT, recent: recentT } = await enrichHomeLists(cfg.serverBaseUrl, pinned, recent));
  }
  const checkList = [...pinnedT, ...recentT];
  let updates = [];
  if (!fast) {
    updates = await checkRunnerAppUpdates(cfg.serverBaseUrl, checkList);
  }
  const updateByKey = Object.fromEntries(updates.map((u) => [u.key, u]));
  for (const ent of pinnedT) {
    ent.needsUpdate = !!updateByKey[ent.key];
  }
  for (const ent of recentT) {
    ent.needsUpdate = !!updateByKey[ent.key];
  }
  let localApps = listLocalApps();
  if (!fast) {
    localApps = await enrichItemsWithThumbnails(cfg.serverBaseUrl, localApps);
  }
  const pinnedKeys = new Set(pinnedT.map((e) => e.key));
  for (const la of localApps) {
    la.isPinned = pinnedKeys.has(la.key);
  }
  return {
    pinned: pinnedT,
    recent: recentT,
    localApps,
    updates,
    storageLine: fast ? "" : buildStorageLine(),
    serverBaseUrl: cfg.serverBaseUrl,
  };
}

async function postState(extra = {}, options = {}) {
  if (!runnerPanel) return;
  const force = options.force === true;
  if (!force && !extra.catalog && !extra.catalogLoading) {
    const cached = runnerStateCache.get();
    if (cached) {
      runnerPanel.webview.postMessage({ type: "state", ...cached, ...extra });
      return;
    }
  }
  const gen = ++runnerRefreshGen;
  const fastFirst = options.fastFirst === true;
  if (fastFirst) {
    const quick = await buildState({ fast: true });
    runnerPanel.webview.postMessage({ type: "state", ...quick, ...extra });
  }
  const state = await buildState({ fast: false });
  if (gen !== runnerRefreshGen) return;
  if (!extra.catalog && !extra.catalogLoading) {
    runnerStateCache.set(state);
  }
  runnerPanel.webview.postMessage({ type: "state", ...state, ...extra });
}

function postCatalog(extra) {
  if (runnerPanel) {
    runnerPanel.webview.postMessage({ type: "catalog", ...extra });
  }
}

async function handleRunnerMessage(context, msg, webview) {
    if (msg.type === "refresh") {
      await postState({}, { force: true });
    }
    if (msg.type === "searchCatalog") {
      postCatalog({ catalogLoading: true, catalog: [] });
      try {
        const cfg = getNoraOpsConfig();
        const scope = msg.scope === "all" ? "all" : "mine";
        const data = await searchPublishedApps(msg.query || "", { scope });
        const items = await enrichItemsWithThumbnails(cfg.serverBaseUrl, data.items || []);
        postCatalog({
          catalog: items,
          catalogError: data.hint && !items.length ? data.hint : null,
          catalogLoading: false,
          catalogScope: scope,
        });
      } catch (e) {
        const scope = msg.scope === "all" ? "all" : "mine";
        const hint =
          scope === "mine" && /401|ログイン/.test(String(e.message || ""))
            ? "自分が使えるアプリを表示するには Setting でログインしてください。"
            : e.message;
        postCatalog({ catalog: [], catalogError: hint, catalogLoading: false, catalogScope: scope });
      }
    }
    if (msg.type === "togglePin" && msg.item) {
      const nowPinned = toggleRunnerPin(msg.item);
      if (nowPinned) updatePinnedArtifactMeta(msg.item);
      await postState();
      vscode.window.showInformationMessage(
        nowPinned ? "お気に入りに追加しました" : "お気に入りを外しました"
      );
    }
    if (msg.type === "upgradeApp" && msg.item) {
      try {
        const result = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "NoraOps: 最新版に更新",
            cancellable: false,
          },
          async (progress) => upgradePublishedApp(msg.item, (p) => progress.report(p))
        );
        updatePinnedArtifactMeta({
          ...msg.item,
          artifactSha: result.sha,
          owner: result.owner,
          name: result.name,
        });
        await postState();
        const runNow = await vscode.window.showInformationMessage(
          `最新版に差し替えました: ${result.fullName}`,
          "今すぐ起動",
          "閉じる"
        );
        if (runNow === "今すぐ起動") {
          await vscode.commands.executeCommand("noraops.openRunner");
          const runResult = await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: "NoraOps: 起動",
              cancellable: false,
            },
            async (progress) => runPublishedApp(msg.item, (p) => progress.report(p))
          );
          recordRunnerAppRun(msg.item);
          touchRunnerUsage(runResult.owner, runResult.name);
          await postState();
        }
      } catch (e) {
        vscode.window.showErrorMessage(`更新に失敗: ${e.message}`);
      }
    }
    if (msg.type === "runApp" && msg.item) {
      try {
        const result = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "NoraOps: 起動",
            cancellable: false,
          },
          async (progress) => runPublishedApp(msg.item, (p) => progress.report(p))
        );
        recordRunnerAppRun(msg.item);
        const owner =
          typeof msg.item.owner === "string" ? msg.item.owner : msg.item.owner?.login || "";
        const name = msg.item.name || "";
        if (owner && name) touchRunnerUsage(owner, name);
        await postState({}, { force: true });
        const entryLine = result.entry ? ` · ${result.entry}` : "";
        vscode.window
          .showInformationMessage(`起動しました: ${result.fullName}${entryLine}`, "場所を開く")
          .then((pick) => {
            if (pick === "場所を開く") {
              vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(result.workspaceRoot));
            }
          });
      } catch (e) {
        vscode.window.showErrorMessage(`起動に失敗: ${e.message}`);
      }
    }
    if (msg.type === "importLocalZip") {
      try {
        const picks = await vscode.window.showOpenDialog({
          canSelectMany: false,
          openLabel: "ZIP を取り込む",
          filters: { "ZIP archive": ["zip"] },
        });
        if (!picks?.length) return;
        const zipPath = picks[0].fsPath;
        const defaultName = path.basename(zipPath, ".zip");
        const displayName = await vscode.window.showInputBox({
          prompt: "Runner に表示する名前",
          value: defaultName,
          validateInput: (v) => (String(v || "").trim() ? null : "名前を入力してください"),
        });
        if (!displayName) return;
        const result = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "NoraOps: ZIP 取込",
            cancellable: false,
          },
          async (progress) => {
            progress.report({ message: "検証・展開中…" });
            return importRunnerZip(zipPath, displayName);
          }
        );
        recordRunnerAppRun(result.item);
        await postState({}, { force: true });
        const pin = await vscode.window.showInformationMessage(
          `取り込みました: ${result.item.fullName}`,
          "起動",
          "お気に入りに追加"
        );
        if (pin === "起動") {
          await vscode.commands.executeCommand("noraops.openRunner");
          await handleRunnerMessage(context, { type: "runApp", item: result.item }, webview);
        } else if (pin === "お気に入りに追加") {
          toggleRunnerPin(result.item);
          await postState({}, { force: true });
        }
      } catch (e) {
        vscode.window.showErrorMessage(`ZIP 取込に失敗: ${e.message}`);
      }
    }
    if (msg.type === "createDesktopShortcut" && msg.item) {
      try {
        const { shortcutPath } = await createRunnerDesktopShortcut(msg.item);
        vscode.window.showInformationMessage(`デスクトップにショートカットを作成しました: ${shortcutPath}`);
      } catch (e) {
        vscode.window.showErrorMessage(`ショートカット作成に失敗: ${e.message}`);
      }
    }
    if (msg.type === "openCreator") {
      const { createHomePanel } = require("../homePanel");
      createHomePanel(context);
    }
    if (msg.type === "navigate" && msg.target) {
      return;
    }
    if (msg.type === "runHealthCheck") {
      const { runHealthCheckWithUi } = require("../healthCheckUi");
      await runHealthCheckWithUi(runnerPanel);
    }
    if (msg.type === "openStorage") {
      const { createStoragePanel } = require("../storagePanel");
      createStoragePanel(context);
    }
}

function _setPanelRef(panel) {
  runnerPanel = panel;
}

function _clearPanelRef() {
  runnerPanel = undefined;
  runnerStateCache.clear();
}

async function bootstrapRunnerView(context, webview, options = {}) {
  await postState({}, { force: !options.soft, fastFirst: !options.soft });
}

async function createRunnerPanel(context, options = {}) {
  const { showNoraOpsView } = require("../noraOpsShell");
  return showNoraOpsView(context, "runner", options);
}

function refreshRunnerPanel() {
  runnerStateCache.clear();
  postState({}, { force: true });
}

module.exports = {
  createRunnerPanel,
  refreshRunnerPanel,
  handleRunnerMessage,
  bootstrapRunnerView,
  _setPanelRef,
  _clearPanelRef,
};
