const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { noraOpsLocalRoot } = require("./runnerPaths");
const { extensionRoot } = require("../extensionContext");
const { hasLocalCache } = require("./runnerArtifactCache");
const { isLocalRunnerItem } = require("../localRunnerRegistry");
const { cacheKey } = require("./runnerPaths");
const { resolveThumbnailFilePath, getThumbnailDataUrl } = require("./runnerThumbnails");

function sanitizeFileName(name) {
  return String(name || "NoraOps App")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .trim()
    .slice(0, 80) || "NoraOps App";
}

function launchersDir() {
  return path.join(noraOpsLocalRoot(), "launchers");
}

function writeLauncherManifest(extRoot) {
  const dir = launchersDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "launcher-manifest.json"),
    JSON.stringify({ extensionRoot: extRoot, updatedAt: new Date().toISOString() }, null, 2),
    "utf8"
  );
  const cliSrc = path.join(extRoot, "scripts", "runner-launch.js");
  const cliDest = path.join(dir, "runner-launch.js");
  if (fs.existsSync(cliSrc)) {
    fs.copyFileSync(cliSrc, cliDest);
  }
  const shimSrc = path.join(extRoot, "scripts", "vscode-shim.js");
  const shimDest = path.join(dir, "vscode-shim.js");
  if (fs.existsSync(shimSrc)) {
    fs.copyFileSync(shimSrc, shimDest);
  }
}

function createCmdLauncher(key, owner, name, label) {
  const dir = launchersDir();
  fs.mkdirSync(dir, { recursive: true });
  const extRoot = extensionRoot();
  if (extRoot) writeLauncherManifest(extRoot);

  const safeKey = key.replace(/[^a-zA-Z0-9._-]/g, "_");
  const cmdPath = path.join(dir, `run-${safeKey}.cmd`);
  const nodeCmd = "node";
  const script = path.join(dir, "runner-launch.js");
  const content =
    "@echo off\r\n" +
    "setlocal\r\n" +
    `cd /d "${dir.replace(/"/g, '""')}"\r\n` +
    `title NoraOps Runner - ${label.replace(/%/g, "%%")}\r\n` +
    `where node >nul 2>&1\r\n` +
    "if errorlevel 1 (\r\n" +
    '  echo Node.js が PATH にありません。VS Code / NoraOps 拡張の環境でお試しください。\r\n' +
    "  pause\r\n" +
    "  exit /b 1\r\n" +
    ")\r\n" +
    `"${nodeCmd}" "${script.replace(/"/g, '""')}" --owner ${owner} --name ${name}\r\n` +
    "if errorlevel 1 pause\r\n";
  fs.writeFileSync(cmdPath, content, "utf8");
  return cmdPath;
}

function toPsB64(value) {
  return Buffer.from(String(value ?? ""), "utf8").toString("base64");
}

function fromPsB64(value) {
  return Buffer.from(String(value || "").trim(), "base64").toString("utf8");
}

/**
 * Unicode パス対応: -EncodedCommand (UTF-16LE) で PowerShell を実行。
 * コマンドライン引数の CP932 化けを避ける。
 */
function runPowerShellEncoded(script) {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
      { windowsHide: true }
    );
    let out = "";
    let err = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(out.trim());
      else reject(new Error(err.trim() || `powershell exit ${code}`));
    });
  });
}

/**
 * デスクトップ解決・ショートカット作成を PowerShell 内で完結させる。
 * パスは UTF-8 Base64 で渡し、日本語 OneDrive デスクトップでも文字化けしない。
 */
async function createWindowsShortcut(lnkFileName, targetPath, workingDir, description, iconPath) {
  const parts = [
    "$ErrorActionPreference = 'Stop'",
    "function U([string]$b) { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b)) }",
    `function D([string]$b) { U $b }`,
    `$desktop = [Environment]::GetFolderPath('Desktop')`,
    `if (-not (Test-Path -LiteralPath $desktop)) { New-Item -ItemType Directory -LiteralPath $desktop -Force | Out-Null }`,
    `$lnkPath = Join-Path $desktop (D '${toPsB64(lnkFileName)}')`,
    `$target = D '${toPsB64(targetPath)}'`,
    `$work = D '${toPsB64(workingDir)}'`,
    `$desc = D '${toPsB64(description || "")}'`,
    `$ws = New-Object -ComObject WScript.Shell`,
    `$sc = $ws.CreateShortcut($lnkPath)`,
    `$sc.TargetPath = $target`,
    `$sc.WorkingDirectory = $work`,
    `$sc.Description = $desc`,
  ];
  if (iconPath && fs.existsSync(iconPath)) {
    parts.push(`$sc.IconLocation = D '${toPsB64(`${iconPath},0`)}'`);
  }
  parts.push(`$sc.Save()`);
  parts.push(`[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($lnkPath))`);
  const out = await runPowerShellEncoded(parts.join("; "));
  return fromPsB64(out.split(/\r?\n/)[0]);
}

async function convertImageToIco(imagePath, icoPath) {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName System.Drawing",
    "function U([string]$b) { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b)) }",
    `function D([string]$b) { U $b }`,
    `$src = D '${toPsB64(imagePath)}'`,
    `$dest = D '${toPsB64(icoPath)}'`,
    `if (-not (Test-Path -LiteralPath $src)) { throw 'thumbnail missing' }`,
    `$dir = Split-Path -Parent $dest`,
    `if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -LiteralPath $dir -Force | Out-Null }`,
    `$bmp = [System.Drawing.Bitmap]::FromFile($src)`,
    `$ptr = $bmp.GetHicon()`,
    `$icon = [System.Drawing.Icon]::FromHandle($ptr)`,
    `$fs = [System.IO.File]::Create($dest)`,
    `$icon.Save($fs)`,
    `$fs.Close()`,
    `$icon.Dispose()`,
    `$bmp.Dispose()`,
    `[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($dest))`,
  ].join("; ");
  const out = await runPowerShellEncoded(script);
  const resolved = fromPsB64(out.split(/\r?\n/)[0]);
  return fs.existsSync(resolved) ? resolved : icoPath;
}

async function prepareShortcutIcon(owner, name, item) {
  const iconsDir = path.join(launchersDir(), "icons");
  fs.mkdirSync(iconsDir, { recursive: true });
  const key = cacheKey(owner, name);
  const icoPath = path.join(iconsDir, `${key}.ico`);

  let imagePath = resolveThumbnailFilePath(owner, name);
  if (!imagePath) {
    try {
      const { getNoraOpsConfig } = require("../config");
      const cfg = getNoraOpsConfig();
      const dataUrl = await getThumbnailDataUrl(cfg.serverBaseUrl, owner, name, {
        hasThumbnail: item.hasThumbnail,
        thumbnailUrl: item.thumbnailUrl,
      });
      if (dataUrl) {
        const m = /^data:image\/\w+;base64,(.+)$/.exec(dataUrl);
        if (m) {
          imagePath = path.join(iconsDir, `${key}.png`);
          fs.writeFileSync(imagePath, Buffer.from(m[1], "base64"));
        }
      }
    } catch {
      /* no icon */
    }
  }

  if (!imagePath || !fs.existsSync(imagePath)) return null;
  try {
    return await convertImageToIco(imagePath, icoPath);
  } catch {
    return null;
  }
}

/** 表示名からリポジトリ ID サフィックス（__app-4949b8a1 等）を除去 */
function cleanAppTitle(text) {
  let s = String(text || "").trim();
  if (!s) return "";
  if (s.includes("/")) s = s.split("/").pop();
  s = s.replace(/__app-[a-f0-9]{6,}$/i, "");
  s = s.replace(/-app-[a-f0-9]{6,}$/i, "");
  return s.trim();
}

function runnerItemLabel(item) {
  for (const cand of [item.displayName, item.description, item.name, item.fullName, item.key]) {
    const cleaned = cleanAppTitle(cand);
    if (cleaned) return cleaned;
  }
  return "NoraOps App";
}

async function createRunnerDesktopShortcut(item) {
  const owner = typeof item.owner === "string" ? item.owner : item.owner?.login || "";
  const name = item.name || "";
  const key = item.key || `${owner}/${name}`;
  if (!owner || !name) throw new Error("アプリ情報が不足しています。");

  if (!isLocalRunnerItem(item) && !hasLocalCache(owner, name)) {
    throw new Error("先に Runner で一度起動してキャッシュを作成してください（ローカル ZIP は取込直後から可）。");
  }

  const extRoot = extensionRoot();
  if (!extRoot) throw new Error("拡張コンテキストがありません。");
  writeLauncherManifest(extRoot);

  const label = runnerItemLabel(item);
  const cmdPath = createCmdLauncher(key, owner, name, label);
  const lnkFileName = `${sanitizeFileName(label)}.lnk`;
  const iconPath = await prepareShortcutIcon(owner, name, item);
  const shortcutPath = await createWindowsShortcut(
    lnkFileName,
    cmdPath,
    launchersDir(),
    `NoraOps Runner: ${label}`,
    iconPath
  );
  return { shortcutPath, launcherPath: cmdPath, iconPath };
}

module.exports = {
  createRunnerDesktopShortcut,
  createCmdLauncher,
  launchersDir,
  runPowerShellEncoded,
  toPsB64,
  fromPsB64,
  cleanAppTitle,
  runnerItemLabel,
};
