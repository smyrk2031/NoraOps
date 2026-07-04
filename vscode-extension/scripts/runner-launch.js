#!/usr/bin/env node
"use strict";
/**
 * デスクトップショートカット用 — VS Code 外から Runner アプリを起動。
 * launcher-manifest.json の extensionRoot 経由で拡張本体を読み込む。
 */
const fs = require("fs");
const path = require("path");
const Module = require("module");

function loadManifest() {
  const manifestPath = path.join(__dirname, "launcher-manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      "launcher-manifest.json がありません。NoraOps の Runner タブでショートカットを作り直してください。"
    );
  }
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    throw new Error("launcher-manifest.json が壊れています。ショートカットを作り直してください。");
  }
  const extRoot = raw && raw.extensionRoot ? path.resolve(String(raw.extensionRoot)) : "";
  if (!extRoot || !fs.existsSync(extRoot)) {
    throw new Error(
      "NoraOps 拡張フォルダが見つかりません。拡張を再インストールし、Runner でショートカットを作り直してください。"
    );
  }
  return { extensionRoot: extRoot };
}

function installVscodeShim() {
  const shimPath = path.join(__dirname, "vscode-shim.js");
  if (!fs.existsSync(shimPath)) {
    throw new Error("vscode-shim.js がありません。ショートカットを作り直してください。");
  }
  const shim = require(shimPath);
  const origRequire = Module.prototype.require;
  Module.prototype.require = function patchedRequire(id) {
    if (id === "vscode") return shim;
    return origRequire.apply(this, arguments);
  };
}

function bootstrap() {
  const { extensionRoot } = loadManifest();
  process.env.NORAOPS_EXTENSION_ROOT = extensionRoot;
  installVscodeShim();

  const extCtx = path.join(extensionRoot, "src", "noraops", "extensionContext.js");
  if (fs.existsSync(extCtx)) {
    const { setExtensionContext } = require(extCtx);
    if (typeof setExtensionContext === "function") {
      setExtensionContext({ extensionPath: extensionRoot });
    }
  }

  return path.join(extensionRoot, "src", "noraops", "runner", "runnerLaunchCli.js");
}

const cliPath = bootstrap();
const { runFromCli } = require(cliPath);

runFromCli()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
