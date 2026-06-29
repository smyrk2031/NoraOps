const fs = require("fs");
const path = require("path");
const vscode = require("vscode");
const {
  listStorageEntries,
  setFavorite,
  deleteEntries,
} = require("./localStorageScan");

let storagePanel;

async function postState(extra = {}) {
  if (!storagePanel) return;
  const data = listStorageEntries();
  storagePanel.webview.postMessage({
    type: "state",
    root: data.root,
    totalMb: data.totalMb,
    entries: data.entries.map((e) => ({
      ...e,
      lastUsedLabel: formatDate(e.lastUsedMs),
      kindLabel: kindLabel(e.kind),
    })),
    recommended: data.recommended.map((e) => e.id),
    ...extra,
  });
}

function kindLabel(kind) {
  if (kind === "venv") return "Python venv";
  if (kind === "runner") return "Runner キャッシュ";
  if (kind === "dev") return "開発コピー";
  return kind;
}

function formatDate(ms) {
  if (!ms) return "—";
  return new Date(ms).toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function createStoragePanel(context) {
  if (storagePanel) {
    storagePanel.reveal(vscode.ViewColumn.One);
    postState();
    return storagePanel;
  }

  storagePanel = vscode.window.createWebviewPanel(
    "noraopsStorage",
    "NoraOps — ストレージ",
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  const htmlPath = path.join(context.extensionPath, "media", "noraops-storage.html");
  storagePanel.webview.html = fs.readFileSync(htmlPath, "utf8");

  storagePanel.webview.onDidReceiveMessage(async (msg) => {
    if (msg.type === "refresh") await postState();
    if (msg.type === "toggleFavorite" && msg.id) {
      setFavorite(msg.id, !!msg.value);
      await postState();
    }
    if (msg.type === "deleteIds" && msg.ids?.length) {
      const names = msg.ids.join(", ");
      const ok = await vscode.window.showWarningMessage(
        `次を削除します（元に戻せません）:\n${names}`,
        { modal: true },
        "削除する"
      );
      if (ok !== "削除する") return;
      try {
        deleteEntries(msg.ids);
        vscode.window.showInformationMessage(`${msg.ids.length} 件を削除しました。`);
        await postState();
      } catch (e) {
        vscode.window.showErrorMessage(`削除に失敗: ${e.message}`);
      }
    }
    if (msg.type === "openRunner") {
      await vscode.commands.executeCommand("noraops.openRunner");
    }
    if (msg.type === "openHome") {
      await vscode.commands.executeCommand("noraops.openHome");
    }
  });

  storagePanel.onDidDispose(() => {
    storagePanel = undefined;
  });

  postState();
  return storagePanel;
}

module.exports = { createStoragePanel, postStorageState: postState };
