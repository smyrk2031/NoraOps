/**
 * プロンプト本文の解決（基本 / 動的 / カスタム）
 */

const path = require("path");
const { getBuiltinDef } = require("./builtinPromptCatalog");
const {
  readWorkspaceVersionContext,
  buildGeneralInstructions,
  buildDocsBundleInstructions,
  buildSingleDocInstructions,
  buildDocPortalInstructions,
} = require("./xllmPromptModes");

function resolveMockPrompt(workspaceRoot) {
  const { readMockSpec, buildMockPrompt } = require("./mockPrompts");
  const { readWorkspaceVersionContext } = require("./xllmPromptModes");
  const spec = readMockSpec(workspaceRoot) || {};
  const ctx = readWorkspaceVersionContext(workspaceRoot);
  return buildMockPrompt({
    appTitle: spec.appTitle || ctx.appName,
    operationSteps: spec.operationSteps || "（spec.json に操作手順を記入してください）",
    targetPlatform: spec.targetPlatform,
  });
}

function resolveDevPrompt(workspaceRoot) {
  const { buildDevImplementPrompt } = require("./devPrompts");
  return buildDevImplementPrompt(workspaceRoot);
}

function resolveEnvPrompt(workspaceRoot, displayName) {
  const { buildEnvDepsPrompt } = require("./devPrompts");
  let name = displayName;
  if (!name && workspaceRoot) {
    try {
      const p = path.join(workspaceRoot, "nora", "manifest.json");
      if (require("fs").existsSync(p)) {
        const man = JSON.parse(require("fs").readFileSync(p, "utf8"));
        if (man?.displayName) name = String(man.displayName).trim();
      }
    } catch {
      /* ignore */
    }
  }
  return buildEnvDepsPrompt(workspaceRoot, name || path.basename(workspaceRoot));
}

/**
 * @param {string} key
 * @param {string} workspaceRoot
 * @param {{ preview?: boolean, displayName?: string, bodyOverride?: string }} [opts]
 */
function resolvePromptBody(key, workspaceRoot, opts = {}) {
  if (opts.bodyOverride != null && String(opts.bodyOverride).trim()) {
    return String(opts.bodyOverride);
  }

  const def = getBuiltinDef(key);
  if (!def) return "";

  const resolver = def.resolver || key;
  const ctx = workspaceRoot ? readWorkspaceVersionContext(workspaceRoot) : {};

  switch (resolver) {
    case "mock":
      return workspaceRoot ? resolveMockPrompt(workspaceRoot) : def.description || "";
    case "dev":
      return workspaceRoot ? resolveDevPrompt(workspaceRoot) : def.description || "";
    case "env":
      return workspaceRoot
        ? resolveEnvPrompt(workspaceRoot, opts.displayName)
        : def.description || "";
    case "xllm.general":
      return buildGeneralInstructions(ctx);
    case "xllm.error":
      return require("./xllmErrorCapture").buildErrorDiagnosisInstructions();
    case "xllm.docs.bundle":
      return buildDocsBundleInstructions(ctx);
    case "xllm.docs.readme":
      return buildSingleDocInstructions("readme", ctx);
    case "xllm.docs.spec":
      return buildSingleDocInstructions("spec", ctx);
    case "xllm.docs.spec-html":
      return buildSingleDocInstructions("specHtml", ctx);
    case "xllm.docs.manual":
      return buildSingleDocInstructions("manual", ctx);
    case "xllm.docs.manual-html":
      return buildSingleDocInstructions("manualHtml", ctx);
    case "xllm.docs.license":
      return buildSingleDocInstructions("license", ctx);
    case "xllm.docs.flowchart":
      return buildSingleDocInstructions("flowchart", ctx);
    case "xllm.docs.teardown":
      return buildSingleDocInstructions("teardown", ctx);
    case "xllm.docs.portal":
      return buildDocPortalInstructions(ctx);
    default:
      return def.description || "";
  }
}

/**
 * レガシー exportMode → promptKey
 * @param {string} mode
 */
function legacyModeToPromptKey(mode) {
  const m = String(mode || "general");
  if (m === "error") return "xllm.error";
  if (m === "docs") return "xllm.docs.bundle";
  return "xllm.general";
}

/**
 * @param {string} promptKey
 */
function promptKeyToLegacyMode(promptKey) {
  const def = getBuiltinDef(promptKey);
  return def?.legacyMode || null;
}

/**
 * プロンプトの UI 種別
 * @param {string} key
 */
function isErrorPromptKey(key) {
  return key === "xllm.error";
}

function isDocsStylePromptKey(key) {
  return (
    key === "xllm.docs.bundle" ||
    (String(key || "").startsWith("xllm.docs.") && key !== "xllm.docs.bundle")
  );
}

module.exports = {
  resolvePromptBody,
  legacyModeToPromptKey,
  promptKeyToLegacyMode,
  isErrorPromptKey,
  isDocsStylePromptKey,
};
