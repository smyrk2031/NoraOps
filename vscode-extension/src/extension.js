const { activateNoraOps } = require("./noraops/activate");

function activate(context) {
  activateNoraOps(context);
}

function deactivate() {
  const { resetOutputChannels } = require("./noraops/outputChannels");
  resetOutputChannels();
}

module.exports = { activate, deactivate };
