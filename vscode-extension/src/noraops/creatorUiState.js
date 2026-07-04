/**
 * Creator Webview UI 状態の永続化（シェルタブ切替でも保持）
 */

const { readWorkspaceRecord, writeWorkspaceRecord } = require("./workspaceStore");

const UI_SCHEMA = "nora.creator-ui/1";

function readCreatorUi(workspaceRoot) {
  const record = readWorkspaceRecord(workspaceRoot);
  const ui = record?.creatorUi;
  if (!ui || typeof ui !== "object") return null;
  return ui;
}

function writeCreatorUi(workspaceRoot, patch) {
  if (!workspaceRoot || !patch || typeof patch !== "object") return null;
  const prev = readCreatorUi(workspaceRoot) || {};
  const next = {
    schema: UI_SCHEMA,
    updatedAt: new Date().toISOString(),
    ...prev,
    ...patch,
  };
  writeWorkspaceRecord(workspaceRoot, { creatorUi: next });
  return next;
}

module.exports = { UI_SCHEMA, readCreatorUi, writeCreatorUi };
