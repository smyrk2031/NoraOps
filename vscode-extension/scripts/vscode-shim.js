"use strict";
const fs = require("fs");
const path = require("path");

const DEFAULT_SERVER = "http://127.0.0.1:8000";

function loadUserSettings() {
  const roots = [
    process.env.APPDATA,
    process.env.VSCODE_PORTABLE,
  ].filter(Boolean);
  const files = [];
  for (const root of roots) {
    files.push(
      path.join(root, "Code", "User", "settings.json"),
      path.join(root, "Code - Insiders", "User", "settings.json"),
      path.join(root, "Cursor", "User", "settings.json")
    );
  }
  for (const p of files) {
    if (!p || !fs.existsSync(p)) continue;
    try {
      return JSON.parse(fs.readFileSync(p, "utf8"));
    } catch {
      /* try next */
    }
  }
  return {};
}

function readSetting(key, defaultValue) {
  const settings = loadUserSettings();
  const full = `noraops.${key}`;
  if (Object.prototype.hasOwnProperty.call(settings, full)) return settings[full];
  return defaultValue;
}

function noop() {}
async function noopAsync() {}

const ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 };

function getConfiguration(_section) {
  return {
    get: (key, defaultValue) => readSetting(key, defaultValue),
    update: noopAsync,
  };
}

function showMessage(_msg, ...items) {
  return Promise.resolve(items[0]);
}

module.exports = {
  workspace: {
    getConfiguration,
    workspaceFolders: undefined,
    get workspaceFolders() {
      return undefined;
    },
    openTextDocument: noopAsync,
  },
  window: {
    showInformationMessage: showMessage,
    showWarningMessage: showMessage,
    showErrorMessage: showMessage,
    showQuickPick: async () => null,
    showTextDocument: noopAsync,
    withProgress: async (_opts, task) => task({ report: noop }),
  },
  commands: {
    executeCommand: noopAsync,
  },
  env: {
    clipboard: { writeText: noopAsync, readText: async () => "" },
    openExternal: noopAsync,
  },
  Uri: {
    file: (f) => ({ fsPath: f }),
  },
  ProgressLocation: { Notification: 15 },
  ViewColumn: { Beside: 2 },
  ConfigurationTarget,
};
