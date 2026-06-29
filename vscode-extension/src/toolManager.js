const crypto = require("crypto");
const fs = require("fs/promises");
const fsSync = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const os = require("os");
const { execFile } = require("child_process");

function compareSemver(a, b) {
  const pa = String(a || "0.0.0").split(".").map((v) => Number(v));
  const pb = String(b || "0.0.0").split(".").map((v) => Number(v));
  for (let i = 0; i < 3; i += 1) {
    const na = Number.isFinite(pa[i]) ? pa[i] : 0;
    const nb = Number.isFinite(pb[i]) ? pb[i] : 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fsSync.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

function httpGetJson(urlString, token) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(urlString);
    const protocol = urlObj.protocol === "https:" ? https : http;
    const headers = { Accept: "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const req = protocol.get(urlString, { headers }, (res) => {
      if (res.statusCode !== 200) {
        reject(
          new Error(
            `Manifest request failed: HTTP ${res.statusCode}. ` +
              `Check noraops.tools.manifestUrl and network. If 401, set noraops.tools.authToken.`
          )
        );
        return;
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try {
          const json = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
          resolve(json);
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on("error", reject);
  });
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

function downloadFile(urlString, destination, token, onProgress) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(urlString);
    const protocol = urlObj.protocol === "https:" ? https : http;
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const req = protocol.get(urlString, { headers }, (res) => {
      if (res.statusCode !== 200) {
        const reason = res.statusCode === 404 ? "not found" : "http error";
        reject(
          new Error(
            `Download failed (${reason}): HTTP ${res.statusCode}\nURL: ${urlString}\n` +
              `If 404: place file under nora-backend data/tools per 配布物管理.md`
          )
        );
        return;
      }
      const total = Number(res.headers["content-length"] || 0);
      let downloaded = 0;
      fsSync.mkdirSync(path.dirname(destination), { recursive: true });
      const file = fsSync.createWriteStream(destination);
      res.on("data", (chunk) => {
        downloaded += chunk.length;
        if (onProgress) onProgress(downloaded, total);
      });
      res.pipe(file);
      file.on("finish", () => file.close(() => resolve(destination)));
      file.on("error", reject);
    });
    req.on("error", reject);
  });
}

function runPowerShellExpandArchive(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    const ps = "powershell.exe";
    const script = `Expand-Archive -Path "${zipPath.replace(/"/g, '""')}" -DestinationPath "${destDir.replace(/"/g, '""')}" -Force`;
    execFile(ps, ["-NoProfile", "-Command", script], (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`Expand-Archive failed: ${stderr || stdout || error.message}`));
        return;
      }
      resolve();
    });
  });
}

function run7ZipSelfExtract(installerPath, destDir) {
  return new Promise((resolve, reject) => {
    // Git for Windows portable executable is a 7z self-extractor.
    execFile(installerPath, [`-o${destDir}`, "-y"], (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`PortableGit self-extract failed: ${stderr || stdout || error.message}`));
        return;
      }
      resolve();
    });
  });
}

function formatMb(bytes) {
  return (Number(bytes || 0) / 1048576).toFixed(1);
}

function formatToolProgress(p) {
  if (!p) return "";
  const toolLabel = p.tool === "portable-git" ? "git" : p.tool === "uv" ? "uv" : p.tool || "";
  if (p.stage === "download-progress" && p.total > 0) {
    const pct = Math.min(100, Math.round((p.downloaded / p.total) * 100));
    return `${toolLabel} ダウンロード ${pct}%（${formatMb(p.downloaded)} / ${formatMb(p.total)} MB）`;
  }
  if (p.stage === "download") return `${toolLabel} をダウンロード中…`;
  if (p.stage === "verify") return `${toolLabel} を検証中（SHA256）…`;
  if (p.stage === "install") return `${toolLabel} を展開・配置中…`;
  if (p.stage === "ready") return p.message || "完了";
  return p.message || p.stage || "";
}

function resolvePackageKind(toolId, url) {
  const lower = String(url || "").toLowerCase();
  if (toolId === "uv") return "single-exe";
  if (lower.endsWith(".7z.exe")) return "self-extract-7z-exe";
  if (lower.endsWith(".zip")) return "zip";
  return "zip";
}

function rewriteToolUrlsForManifestOrigin(manifest, manifestUrl) {
  if (!manifest || !manifestUrl) return manifest;
  let base;
  try {
    const m = new URL(manifestUrl);
    const marker = "/api/tools/";
    const idx = m.pathname.indexOf(marker);
    const prefix = idx >= 0 ? m.pathname.slice(0, idx) : "";
    base = `${m.origin}${prefix}`;
  } catch {
    return manifest;
  }
  const out = { ...manifest };
  for (const key of ["uv", "portableGit"]) {
    const block = manifest[key];
    if (!block?.url) continue;
    try {
      const current = new URL(block.url);
      out[key] = { ...block, url: `${base}${current.pathname}${current.search || ""}` };
    } catch {
      // ignore invalid URL in manifest and keep original value
    }
  }
  return out;
}

class ToolManager {
  constructor(options) {
    this.config = options.config;
    this.paths = options.paths;
    this.log = options.log || (() => {});
  }

  async ensureInstalled(progressCb) {
    await ensureDir(this.paths.toolsRoot);
    await ensureDir(this.paths.cacheRoot);
    await ensureDir(this.paths.logsRoot);

    progressCb?.({ stage: "manifest", message: "manifest を取得中…" });
    const manifest = await this.fetchManifest();
    const state = await this.readState();
    const pending = this.getPendingTools(manifest, state);

    if (pending.length === 0) {
      progressCb?.({ stage: "ready", message: "uv は最新です" });
      return this.getToolchain();
    }

    for (const tool of pending) {
      progressCb?.({ stage: "start-tool", tool: tool.id, message: `${tool.id === "portable-git" ? "git" : tool.id} のセットアップを開始` });
      await this.installOne(tool, progressCb);
    }

    const statePayload = {
      channel: this.config.channel,
      installedAt: new Date().toISOString(),
      manifestVersion: manifest.manifestVersion || "1",
      uv: manifest.uv.version,
    };
    if (manifest.portableGit?.version && fsSync.existsSync(this.paths.gitExe)) {
      statePayload.git = manifest.portableGit.version;
    }
    await this.writeState(statePayload);

    progressCb?.({ stage: "ready", message: "tool installation complete" });
    return this.getToolchain();
  }

  async fetchManifest() {
    this.log("fetch manifest");
    const raw = await httpGetJson(this.config.manifestUrl, this.config.authToken);
    const manifest = rewriteToolUrlsForManifestOrigin(raw, this.config.manifestUrl);
    if (!manifest || !manifest.uv) {
      throw new Error("Invalid manifest: uv is required.");
    }
    return manifest;
  }

  getPendingTools(manifest, state) {
    const pending = [];
    const uvNeedsInstall = !fsSync.existsSync(this.paths.uvExe) || state?.uv !== manifest.uv.version;

    if (uvNeedsInstall) {
      pending.push({
        id: "uv",
        version: manifest.uv.version,
        url: manifest.uv.url,
        sha256: manifest.uv.sha256,
        type: "exe",
        installDir: path.join(this.paths.toolsRoot, "uv"),
        targetFile: "uv.exe"
      });
    }
    return pending;
  }

  async installOne(tool, progressCb) {
    const stagingRoot = path.join(this.paths.toolsRoot, ".staging");
    await ensureDir(stagingRoot);
    const extensionMap = {
      "single-exe": "exe",
      "zip": "zip",
      "self-extract-7z-exe": "7z.exe"
    };
    const suffix = extensionMap[tool.packageKind || "single-exe"] || "bin";
    const downloadPath = path.join(this.paths.cacheRoot, `${tool.id}-${tool.version}.${suffix}`);
    const tmpDir = path.join(stagingRoot, `${tool.id}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const finalDir = tool.installDir;

    await ensureDir(tmpDir);
    progressCb?.({ stage: "download", tool: tool.id, message: formatToolProgress({ stage: "download", tool: tool.id }) });
    await downloadFile(tool.url, downloadPath, this.config.authToken, (downloaded, total) => {
      progressCb?.({ stage: "download-progress", tool: tool.id, downloaded, total });
    });

    progressCb?.({ stage: "verify", tool: tool.id, message: formatToolProgress({ stage: "verify", tool: tool.id }) });
    if (!fsSync.existsSync(downloadPath)) {
      throw new Error(
        `${tool.id} のダウンロードファイルがありません: ${downloadPath}\n` +
          `URL: ${tool.url}\n` +
          `サーバが起動しているか、data/tools に実体があるか確認してください。`
      );
    }
    const actual = await sha256File(downloadPath);
    if (actual.toLowerCase() !== String(tool.sha256 || "").toLowerCase()) {
      throw new Error(
        `${tool.id} checksum mismatch.\nExpected: ${tool.sha256}\nActual: ${actual}\n` +
          `Recompute sha256 in PowerShell per nora-backend/docs/配布物管理.md section 9.`
      );
    }

    progressCb?.({ stage: "install", tool: tool.id, message: formatToolProgress({ stage: "install", tool: tool.id }) });
    if (tool.id === "uv") {
      await ensureDir(tmpDir);
      await fs.copyFile(downloadPath, path.join(tmpDir, "uv.exe"));
    } else if (tool.packageKind === "self-extract-7z-exe") {
      await run7ZipSelfExtract(downloadPath, tmpDir);
    } else {
      await runPowerShellExpandArchive(downloadPath, tmpDir);
    }

    const targetBackup = `${finalDir}.bak`;
    try {
      if (fsSync.existsSync(targetBackup)) await fs.rm(targetBackup, { recursive: true, force: true });
      if (fsSync.existsSync(finalDir)) await fs.rename(finalDir, targetBackup);
      await fs.rename(tmpDir, finalDir);
      if (fsSync.existsSync(targetBackup)) await fs.rm(targetBackup, { recursive: true, force: true });
    } catch (error) {
      if (fsSync.existsSync(targetBackup) && !fsSync.existsSync(finalDir)) {
        await fs.rename(targetBackup, finalDir);
      }
      throw error;
    }

    if (tool.targetFile && !fsSync.existsSync(path.join(finalDir, tool.targetFile))) {
      throw new Error(`${tool.id} install failed: missing ${tool.targetFile}`);
    }
  }

  async readState() {
    try {
      const raw = await fs.readFile(this.paths.stateFile, "utf8");
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async writeState(data) {
    await ensureDir(path.dirname(this.paths.stateFile));
    await fs.writeFile(this.paths.stateFile, JSON.stringify(data, null, 2), "utf8");
  }

  getToolchain() {
    return {
      uvExe: this.paths.uvExe,
      gitExe: this.paths.gitExe,
      root: this.paths.root
    };
  }

  async shouldForceUpdate(manifest) {
    const state = await this.readState();
    if (!state) return true;
    if ((manifest.policy?.forceMinimumUvVersion || "").trim()) {
      if (compareSemver(state.uv, manifest.policy.forceMinimumUvVersion) < 0) return true;
    }
    return false;
  }
}

module.exports = {
  ToolManager,
  compareSemver,
  sha256File,
  formatToolProgress,
  rewriteToolUrlsForManifestOrigin,
};
