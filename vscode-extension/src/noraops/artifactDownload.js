const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const https = require("https");
const { spawn } = require("child_process");

function devAppsRoot() {
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  return path.join(base, "NoraOps", "dev-apps");
}

function cacheKey(owner, name) {
  return `${owner}__${name}`.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function downloadBinary(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === "https:" ? https : http;
    const opts = {
      hostname: u.hostname,
      port: u.port || (u.protocol === "https:" ? 443 : 80),
      path: u.pathname + u.search,
      method: "GET",
      headers: { ...headers, Accept: "application/zip" },
      timeout: 300000,
    };
    const req = lib.request(opts, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => reject(new Error(body || `HTTP ${res.statusCode}`)));
        return;
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    req.end();
  });
}

function expandZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(destDir)) {
      fs.rmSync(destDir, { recursive: true, force: true });
    }
    fs.mkdirSync(destDir, { recursive: true });
    const zipEsc = zipPath.replace(/'/g, "''");
    const destEsc = destDir.replace(/'/g, "''");
    const script = `Expand-Archive -Path '${zipEsc}' -DestinationPath '${destEsc}' -Force`;
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true }
    );
    let err = "";
    child.stderr.on("data", (c) => (err += c));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(err.trim() || `Expand-Archive exit ${code}`));
    });
  });
}

/**
 * Download published artifact and extract to targetDir.
 */
async function downloadAndExtractArtifact(serverBaseUrl, owner, name, targetDir, readToken, opts = {}) {
  const base = serverBaseUrl.replace(/\/$/, "");
  const q = new URLSearchParams();
  const tag = (opts.tag || opts.publishedTag || "").trim();
  const version = (opts.version || "").trim();
  if (tag) q.set("tag", tag);
  else if (version) q.set("version", version.replace(/^v/i, ""));
  const suffix = q.toString() ? `?${q}` : "";
  const url = `${base}/api/v1/portal/apps/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/artifact${suffix}`;
  const data = await downloadBinary(url, {
    Authorization: `Bearer ${readToken}`,
    "X-NoraOps-Push-Token": readToken,
  });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "noraops-art-"));
  const zipPath = path.join(tmpDir, "artifact.zip");
  fs.writeFileSync(zipPath, data);
  await expandZip(zipPath, targetDir);
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  return targetDir;
}

module.exports = {
  downloadBinary,
  downloadAndExtractArtifact,
  devAppsRoot,
  cacheKey,
  expandZip,
};
