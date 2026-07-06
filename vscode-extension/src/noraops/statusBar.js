const vscode = require("vscode");
const { runNoraOpsSave, countSecErrors, isLastOnline } = require("./savePipeline");
const { describePushFailure } = require("./saveFlow");

let brandItem;
let stateItem;
let saveItem;

function formatState(result) {
  if (!result) return "NoraOps";
  const sec = countSecErrors(result.summary);
  const pol = result.summary?.polErrors?.length || 0;
  if (!result.online) {
    return sec > 0 ? `保存済み（このPCのみ・要修正 ${sec}）` : "保存済み（このPCのみ）";
  }
  if (!result.push?.ok && !result.push?.skipped && result.push?.reason !== "no_remote") {
    return sec > 0 ? `クラウド未送信（要修正 ${sec}）` : "クラウド未送信";
  }
  if (result.push?.reason === "no_remote") {
    return sec > 0 ? `保存済み（要修正 ${sec}）` : "保存済み";
  }
  if (sec > 0) return `保存済み・クラウド済（要修正 ${sec}）`;
  if (pol > 0) return `保存済み・クラウド済（整理推奨 ${pol}）`;
  return "保存済み・クラウド済";
}

function createStatusBar(context) {
  brandItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  brandItem.text = "NoraOps";
  brandItem.tooltip = "NoraOps パネルを開く（Setting / Creator / Runner）";
  brandItem.command = "noraops.openHome";
  brandItem.show();

  stateItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
  stateItem.text = "$(circle-outline) 未保存の変更";
  stateItem.tooltip =
    "エディタの編集状態と NoraOps 保存結果の表示です。ファイルを編集すると「未保存の変更」、NoraOps 保存後はクラウド送信状況に更新されます。";
  stateItem.show();

  saveItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
  saveItem.text = "$(save) 保存";
  saveItem.tooltip = "NoraOps でクラウドに保存";
  saveItem.command = "noraops.save";
  saveItem.show();

  const { registerToolsMenuCommand } = require("./toolsStatusBar");
  registerToolsMenuCommand(context);

  context.subscriptions.push(brandItem, stateItem, saveItem);

  vscode.workspace.onDidChangeTextDocument(() => {
    stateItem.text = "$(circle-filled) 未保存の変更";
    stateItem.tooltip = "エディタに未保存の変更があります。NoraOps 保存は「保存」ボタンから実行してください。";
  });

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(() => {
      if (vscode.workspace.isTrusted) {
        stateItem.text = "$(check) ファイル保存済";
        stateItem.tooltip = "開いているファイルはディスクに保存済みです。NoraOps へのクラウド保存は「保存」ボタンから実行してください。";
      }
    })
  );
}

async function afterSaveUpdate(result) {
  stateItem.text = `$(check) ${formatState(result)}`;
  stateItem.tooltip = `NoraOps 保存結果: ${formatState(result)}`;
}

function registerSaveCommand(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand("noraops.openSaveInHome", async () => {
      const { createHomePanel, focusSavePicker } = require("./homePanel");
      createHomePanel(context);
      focusSavePicker();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("noraops.save", async () => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) {
        vscode.window.showWarningMessage("フォルダを開いてから保存してください。");
        return;
      }
      const { hasNoraOpsRepoBinding } = require("./repoSetup");
      const bound = await hasNoraOpsRepoBinding(folder.uri.fsPath);
      const action = bound ? "push" : "new-repo";
      await vscode.commands.executeCommand("noraops.saveExecute", action);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("noraops.saveExecute", async (arg) => {
      const action = typeof arg === "string" ? arg : arg?.action;
      if (!action || action === "cancel") return;
      const forceNewRepo = typeof arg === "object" && arg?.forceNewRepo === true;
      const newAppIdentity = typeof arg === "object" && arg?.newAppIdentity === true;
      const publishRunner = typeof arg === "object" && arg?.publishRunner === true;
      const publishVersion = typeof arg === "object" ? arg?.publishVersion || "" : "";
      saveItem.text = "$(sync~spin) 保存中…";
      try {
        const { postSaveResult } = require("./homePanel");
        postSaveResult({ busy: true });
        const result = await runNoraOpsSave({
          action,
          forceNewRepo,
          newAppIdentity,
          publishRunner,
          publishVersion,
        });
        if (!result) return;
        await afterSaveUpdate(result);
        const sec = countSecErrors(result.summary);
        if (sec > 0 && isLastOnline()) {
          vscode.window.showWarningMessage(
            `保存しました。直した方が安全な所が ${sec} か所あります。`
          );
        } else if (result.push?.offline) {
          vscode.window.showInformationMessage("保存しました（オフラインのためこの PC のみ）。");
        } else if (result.push?.localOnly || result.push?.skipped) {
          vscode.window.showInformationMessage("保存しました（この PC のみ）。");
        } else if (!result.push?.ok) {
          /* 失敗は homePanel postSaveResult のモーダルで表示 */
        } else if (result.publish?.ok) {
          /* publish success message shown from savePipeline */
        } else if (result.publish && result.publish.ok === false && !result.publish.skipped) {
          /* 保存 OK / 公開 NG は savePipeline と postSaveResult のモーダルで表示 */
        } else {
          vscode.window.showInformationMessage("クラウドに保存しました。");
        }
        const { refreshHomePanel, postSaveResult: postSaveDone } = require("./homePanel");
        await refreshHomePanel();
        postSaveDone(result);
      } finally {
        saveItem.text = "$(save) 保存";
      }
    })
  );
}

module.exports = { createStatusBar, registerSaveCommand, afterSaveUpdate };
