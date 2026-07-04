const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const https = require("https");
const { appCacheDir } = require("./runnerPaths");
const { LOCAL_OWNER } = require("../localRunnerRegistry");

function thumbsRoot() {
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  return path.join(base, "NoraOps", "runner-thumbs");
}

function thumbCachePath(owner, name) {
  return path.join(thumbsRoot(), `${owner}__${name}.png`);
}

/** ローカルキャッシュまたは runner-apps 内のサムネイル実ファイル */
function resolveThumbnailFilePath(owner, name) {
  if (!owner || !name) return null;
  const rels = [
    "nora/assets/thumbnail.png",
    "assets/thumbnail.png",
    "nora/assets/thumbnail.jpg",
    "nora/assets/thumbnail.jpeg",
  ];
  const root = appCacheDir(owner, name);
  for (const rel of rels) {
    const p = path.join(root, rel);
    if (fs.existsSync(p)) return p;
  }
  const cached = thumbCachePath(owner, name);
  if (fs.existsSync(cached)) return cached;
  return null;
}

function fileToDataUrl(filePath) {
  const buf = fs.readFileSync(filePath);
  return `data:image/png;base64,${buf.toString("base64")}`;
}

function fetchBinary(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    lib
      .get(url, (res) => {
        if (res.statusCode === 404) {
          res.resume();
          resolve(null);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
      })
      .on("error", reject);
  });
}

async function getThumbnailDataUrl(serverBaseUrl, owner, name, opts = {}) {
  if (owner === LOCAL_OWNER) {
    const candidates = [
      "nora/assets/thumbnail.png",
      "assets/thumbnail.png",
      "nora/assets/thumbnail.jpg",
    ];
    const root = appCacheDir(owner, name);
    for (const rel of candidates) {
      const p = path.join(root, rel);
      if (fs.existsSync(p)) {
        try {
          const buf = fs.readFileSync(p);
          const ext = path.extname(p).toLowerCase();
          const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";
          return `data:${mime};base64,${buf.toString("base64")}`;
        } catch {
          /* try next */
        }
      }
    }
    return null;
  }
  if (!opts.hasThumbnail && !opts.thumbnailUrl) return null;
  const cache = thumbCachePath(owner, name);
  if (fs.existsSync(cache)) {
    try {
      return fileToDataUrl(cache);
    } catch {
      /* refetch */
    }
  }
  const base = (serverBaseUrl || "").replace(/\/$/, "");
  const url =
    opts.thumbnailUrl && opts.thumbnailUrl.startsWith("http")
      ? opts.thumbnailUrl
      : `${base}/api/v1/portal/apps/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/thumbnail`;
  try {
    const buf = await fetchBinary(url);
    if (!buf || !buf.length) return null;
    fs.mkdirSync(thumbsRoot(), { recursive: true });
    fs.writeFileSync(cache, buf);
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

async function enrichItemsWithThumbnails(serverBaseUrl, items) {
  const out = [];
  for (const it of items || []) {
    const owner =
      typeof it.owner === "string" ? it.owner : it.owner?.login || it.owner || "";
    const name = it.name || "";
    const copy = { ...it };
    if (owner && name) {
      copy.thumbnailDataUrl = await getThumbnailDataUrl(serverBaseUrl, owner, name, {
        hasThumbnail: it.hasThumbnail,
        thumbnailUrl: it.thumbnailUrl,
      });
    }
    out.push(copy);
  }
  return out;
}

function invalidateThumbCache(owner, name) {
  const p = thumbCachePath(owner, name);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

module.exports = {
  getThumbnailDataUrl,
  enrichItemsWithThumbnails,
  invalidateThumbCache,
  thumbCachePath,
  resolveThumbnailFilePath,
};
