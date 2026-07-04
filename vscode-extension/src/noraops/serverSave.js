const fs = require("fs");
const http = require("http");
const https = require("https");
const { getNoraOpsConfig } = require("./config");
const { createWorkspaceZip, removeWorkspaceZip } = require("./workspaceZip");
const { getNoraOpsRepoMeta } = require("./repoMeta");
const { readWorkspaceSession } = require("./pathsMeta");
const { readNoraManifest } = require("./appEntry");

function postMultipart(url, fields, fileField, filePath, headers = {}) {
  const boundary = `----noraops${Date.now()}`;
  const fileName = "workspace.zip";
  const fileData = fs.readFileSync(filePath);
  const parts = [];

  for (const [k, v] of Object.entries(fields)) {
    parts.push(
      `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`
    );
  }
  parts.push(
    `--${boundary}\r\nContent-Disposition: form-data; name="${fileField.name}"; filename="${fileName}"\r\nContent-Type: application/zip\r\n\r\n`
  );
  const tail = `\r\n--${boundary}--\r\n`;
  const head = Buffer.from(parts.join(""), "utf8");
  const body = Buffer.concat([head, fileData, Buffer.from(tail, "utf8")]);

  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === "https:" ? https : http;
    const opts = {
      hostname: u.hostname,
      port: u.port || (u.protocol === "https:" ? 443 : 80),
      path: u.pathname + u.search,
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": body.length,
      },
      timeout: 300000,
    };
    const req = lib.request(opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        let json = null;
        try {
          json = data ? JSON.parse(data) : null;
        } catch {
          /* ignore */
        }
        resolve({ status: res.statusCode || 0, json, raw: data });
      });
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    req.write(body);
    req.end();
  });
}

async function createWriteSession(serverBaseUrl, deviceLabel) {
  const { createPushSession } = require("./noraopsApi");
  return createPushSession(serverBaseUrl, deviceLabel, "write");
}

async function uploadWorkspaceZip(serverBaseUrl, pushToken, owner, name, zipPath, opts = {}) {
  const base = serverBaseUrl.replace(/\/$/, "");
  const fields = {
    owner,
    name,
    message: opts.message || "NoraOps save",
  };
  if (opts.appId) fields.app_id = opts.appId;
  if (opts.publish) {
    fields.publish = "true";
    if (opts.version) fields.version = String(opts.version);
  }
  const { status, json, raw } = await postMultipart(
    `${base}/api/v1/repos/save`,
    fields,
    { name: "workspace" },
    zipPath,
    {
      Authorization: `Bearer ${pushToken}`,
      "X-NoraOps-Push-Token": pushToken,
    }
  );
  if (status >= 400) {
    const d = json?.detail;
    const msg = typeof d === "string" ? d : raw || `save HTTP ${status}`;
    const err = new Error(msg);
    err.status = status;
    throw err;
  }
  return json;
}

/**
 * Save workspace to Gitea via zip upload (no local git).
 */
async function saveViaServer(workspaceRoot, opts = {}) {
  const cfg = getNoraOpsConfig();
  if (!cfg.serverBaseUrl) {
    return { ok: false, reason: "no_server", message: "noraops.server.baseUrl が未設定です。" };
  }

  const meta =
    opts.owner && opts.name
      ? { owner: opts.owner, name: opts.name, fullName: `${opts.owner}/${opts.name}` }
      : getNoraOpsRepoMeta(workspaceRoot);

  if (!meta) {
    const { detectForeignGitOrigin } = require("./repoMeta");
    const foreign = await detectForeignGitOrigin(workspaceRoot);
    const hint = foreign.foreign
      ? `\n${foreign.message}\n「新規 Gitea リポジトリを作成して保存」を選んでください。`
      : "";
    return {
      ok: false,
      reason: "no_binding",
      message: `NoraOps の保存先リポが未登録です。${hint}`,
    };
  }

  const session = readWorkspaceSession(workspaceRoot);
  const manifest = readNoraManifest(workspaceRoot);
  const appId = manifest?.appId || session?.appId || null;
  if (manifest?.appId && session?.appId && manifest.appId !== session.appId) {
    const { syncSessionAppIdFromManifest } = require("./appBinding");
    syncSessionAppIdFromManifest(workspaceRoot);
  }

  const zip = await createWorkspaceZip(workspaceRoot);
  if (!zip.ok) {
    return { ok: false, reason: zip.reason, message: zip.message };
  }

  try {
    const session = await createWriteSession(cfg.serverBaseUrl, cfg.deviceLabel);
    const pushToken = session.pushToken;
    if (!pushToken) throw new Error("session token missing");
    const saveJson = await uploadWorkspaceZip(cfg.serverBaseUrl, pushToken, meta.owner, meta.name, zip.zipPath, {
      message: opts.message || `NoraOps save ${new Date().toISOString()}`,
      appId: appId || undefined,
      publish: opts.publish === true,
      version: opts.version || undefined,
    });
    const { giteaRepoIdFromProvision } = require("./giteaRepoId");
    const { bindNoraOpsRepo } = require("./repoMeta");
    const gid = giteaRepoIdFromProvision(saveJson);
    if (gid) {
      bindNoraOpsRepo(workspaceRoot, {
        owner: meta.owner,
        name: meta.name,
        fullName: meta.fullName,
        giteaRepoId: gid,
        appId: appId || undefined,
      });
    }
    const pub = saveJson?.publish;
    const published = Boolean(pub && pub.ok !== false && (pub.version || pub.tag));
    return {
      ok: true,
      fullName: meta.fullName,
      via: "zip",
      giteaRepoId: gid || undefined,
      publish: pub,
      published,
      version: pub?.version,
      tag: pub?.tag,
    };
  } catch (e) {
    const status = e.status || 0;
    let reason = "server_save_failed";
    if (status === 409) reason = "app_id_conflict";
    else if (status === 413) reason = "zip_too_large";
    else if (status === 503) reason = "server_unavailable";
    else if (status === 401 || status === 403) reason = "auth_denied";
    return {
      ok: false,
      reason,
      message: e.message || String(e),
      httpStatus: status || undefined,
    };
  } finally {
    removeWorkspaceZip(zip);
  }
}

module.exports = { saveViaServer, createWriteSession, uploadWorkspaceZip };
