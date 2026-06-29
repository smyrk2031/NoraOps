const vscode = require("vscode");

let pythonChannel;
let securityChannel;

/** activate 時に1回だけ呼ぶ（Reload 後の再 activate でも毎回作り直す） */
function registerOutputChannels(context) {
  pythonChannel = vscode.window.createOutputChannel("NoraOps Python", { log: true });
  securityChannel = vscode.window.createOutputChannel("NoraOps Security");
  context.subscriptions.push(pythonChannel, securityChannel);
}

function resetOutputChannels() {
  pythonChannel = undefined;
  securityChannel = undefined;
}

function getPythonOutputChannel() {
  return pythonChannel;
}

function getSecurityOutputChannel() {
  return securityChannel;
}

module.exports = {
  registerOutputChannels,
  resetOutputChannels,
  getPythonOutputChannel,
  getSecurityOutputChannel,
};
