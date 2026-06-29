const vscode = require("vscode");

let toolsItem;

async function refreshToolsStatusBar() {
  if (!toolsItem) return;
  try {
    const { fetchToolsStatus } = require("./toolInstaller");
    const st = await fetchToolsStatus();
    if (!st.online) {
      if (st.uv.installed) {
        toolsItem.text = "$(check) uv";
        toolsItem.tooltip = `${st.uv.version || "導入済み"}\n（manifest 未取得 · ローカル uv は利用可）`;
        return;
      }
      toolsItem.text = "$(warning) ツール (オフライン)";
      toolsItem.tooltip = "FastAPI から manifest を取得できません。クリックでメニュー";
      return;
    }
    if (st.ok) {
      toolsItem.text = st.uv.updateNeeded ? "$(warning) uv 更新あり" : "$(check) uv";
      toolsItem.tooltip = st.uv.updateNeeded
        ? `導入済み · サーバー指定版 ${st.uv.required || "?"}\nクリックで確認・再セットアップ`
        : `uv 導入済み: ${st.uv.version || "?"}\nクリックで確認・再セットアップ`;
    } else {
      toolsItem.text = "$(tools) ツールをセットアップ";
      toolsItem.tooltip = "uv が未導入または実行できません。クリック";
    }
  } catch {
    toolsItem.text = "$(tools) ツール";
    toolsItem.tooltip = "uv のセットアップ";
  }
}

function createToolsStatusBar(context) {
  toolsItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 94);
  toolsItem.command = "noraops.toolsMenu";
  toolsItem.show();
  context.subscriptions.push(toolsItem);
  refreshToolsStatusBar().catch(() => {});
  return toolsItem;
}

function registerToolsMenuCommand(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand("noraops.toolsMenu", async () => {
      const pick = await vscode.window.showQuickPick(
        [
          {
            label: "$(check) ツールの状態を確認",
            description: "uv のバージョンと更新要否",
            id: "check",
          },
          {
            label: "$(cloud-download) ツールをセットアップ（再取得）",
            description: "%LOCALAPPDATA%\\NoraOps\\runtime へ配置",
            id: "setup",
          },
        ],
        { title: "NoraOps ツール（uv）", placeHolder: "操作を選んでください" }
      );
      if (pick?.id === "check") await vscode.commands.executeCommand("noraops.checkTools");
      if (pick?.id === "setup") await vscode.commands.executeCommand("noraops.setupTools");
    })
  );
}

module.exports = { createToolsStatusBar, refreshToolsStatusBar, registerToolsMenuCommand };
