const vscode = require("vscode");

function getConfiguredMode() {
  const raw = (vscode.workspace.getConfiguration("noraops").get("mode") || "auto").toLowerCase();
  if (raw === "creator" || raw === "runner") return raw;
  return "auto";
}

function getEffectiveMode() {
  const configured = getConfiguredMode();
  if (configured !== "auto") return configured;
  const hasWs = (vscode.workspace.workspaceFolders?.length || 0) > 0;
  return hasWs ? "creator" : "runner";
}

module.exports = { getConfiguredMode, getEffectiveMode };
