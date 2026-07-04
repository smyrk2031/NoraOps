/** @type {import('vscode').ExtensionContext | null} */
let ctx = null;

function setExtensionContext(context) {
  ctx = context;
}

function getExtensionContext() {
  return ctx;
}

function extensionRoot() {
  const fromEnv = process.env.NORAOPS_EXTENSION_ROOT;
  if (fromEnv && String(fromEnv).trim()) return String(fromEnv).trim();
  return ctx?.extensionPath || null;
}

module.exports = {
  setExtensionContext,
  getExtensionContext,
  extensionRoot,
};
