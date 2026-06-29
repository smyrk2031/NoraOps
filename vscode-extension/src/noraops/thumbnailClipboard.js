const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

/**
 * Windows: クリップボードの画像を PNG 一時ファイルへ（VS Code Webview の paste は画像を取れないことが多い）
 */
function readClipboardImageToTempFile() {
  if (process.platform !== "win32") {
    return Promise.resolve(null);
  }
  const tmp = path.join(os.tmpdir(), `noraops-clip-${Date.now()}.png`);
  const escaped = tmp.replace(/'/g, "''");
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "Add-Type -AssemblyName System.Drawing",
    "if (-not [Windows.Forms.Clipboard]::ContainsImage()) { exit 2 }",
    "$img = [Windows.Forms.Clipboard]::GetImage()",
    `$img.Save('${escaped}', [System.Drawing.Imaging.ImageFormat]::Png)`,
    "exit 0",
  ].join("; ");

  return new Promise((resolve) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true }
    );
    let err = "";
    child.stderr.on("data", (c) => (err += c));
    child.on("close", (code) => {
      if (code === 0 && fs.existsSync(tmp) && fs.statSync(tmp).size > 0) {
        resolve(tmp);
        return;
      }
      try {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
      } catch {
        /* ignore */
      }
      resolve(null);
    });
    child.on("error", () => resolve(null));
  });
}

module.exports = { readClipboardImageToTempFile };
