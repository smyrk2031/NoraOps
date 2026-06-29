/**
 * AppData workspaces/{key}.json — ワークスペースローカル状態（.nora 後継）
 * @see NoraOps/workspaces-schema.md
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const os = require("os");

const WORKSPACE_SCHEMA = "nora.workspace/1";
const SECURITY_STATE_SCHEMA = "nora.security-warn-state/1";

/** session.json 相当のトップレベルキー */
const SESSION_KEYS = new Set([
  "appId",
  "displayName",
  "workspacePath",
  "creatorProfile",
  "creatorWorkflow",
  "giteaRepoId",
  "giteaFullName",
  "giteaOwner",
  "giteaName",
  "cloneUrl",
  "lastSave",
  "lastPushOk",
  "online",
  "secIssues",
  "polIssues",
  "lastPublished",
  "lastPublishedVersion",
  "lastPublishedTag",
  "lastPublishedAt",
  "importRequirementsPath",
  "pythonEnvReady",
  "pythonExe",
]);

function noraOpsRoot() {
  const override = process.env.NORAOPS_LOCAL_ROOT;
  if (override && String(override).trim()) {
    return path.resolve(String(override).trim());
  }
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  return path.join(base, "NoraOps");
}

function normalizeWorkspacePath(workspaceRoot) {
  if (!workspaceRoot) return "";
  return path.resolve(workspaceRoot).replace(/\\/g, "/").toLowerCase();
}

function workspaceKey(workspaceRoot) {
  const norm = normalizeWorkspacePath(workspaceRoot);
  if (!norm) return "";
  return crypto.createHash("sha256").update(norm, "utf8").digest("hex").slice(0, 32);
}

function workspacesDir() {
  return path.join(noraOpsRoot(), "workspaces");
}

function workspaceRecordPath(workspaceRoot) {
  const key = workspaceKey(workspaceRoot);
  if (!key) return null;
  return path.join(workspacesDir(), `${key}.json`);
}

function legacyNoraDir(workspaceRoot) {
  return path.join(workspaceRoot, ".nora");
}

function readJsonFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    }
  } catch {
    /* ignore */
  }
  return null;
}

function readLegacySession(workspaceRoot) {
  return readJsonFile(path.join(legacyNoraDir(workspaceRoot), "session.json"));
}

function readLegacyPythonEnv(workspaceRoot) {
  return readJsonFile(path.join(legacyNoraDir(workspaceRoot), "python-env.json"));
}

function readLegacySecurityWarn(workspaceRoot) {
  return readJsonFile(path.join(legacyNoraDir(workspaceRoot), "security-warn-state.json"));
}

function emptySecurityWarnState() {
  return { schema: SECURITY_STATE_SCHEMA, suppressed: [], reviewed: [] };
}

function pickSessionFields(record) {
  if (!record || typeof record !== "object") return {};
  const out = {};
  for (const k of SESSION_KEYS) {
    if (record[k] != null && record[k] !== "") out[k] = record[k];
  }
  if (record.updatedAt) out.updatedAt = record.updatedAt;
  return out;
}

function mergeLegacyIntoRecord(record, workspaceRoot) {
  let merged = { ...(record || {}) };
  let changed = false;

  const legacySession = readLegacySession(workspaceRoot);
  if (legacySession && typeof legacySession === "object") {
    for (const [k, v] of Object.entries(legacySession)) {
      if (v == null || v === "") continue;
      if (merged[k] == null || merged[k] === "") {
        merged[k] = v;
        changed = true;
      }
    }
  }

  const legacyPython = readLegacyPythonEnv(workspaceRoot);
  if (legacyPython && typeof legacyPython === "object" && !merged.pythonEnv) {
    merged.pythonEnv = legacyPython;
    changed = true;
  }

  const legacySec = readLegacySecurityWarn(workspaceRoot);
  if (legacySec && typeof legacySec === "object" && !merged.securityWarnState) {
    merged.securityWarnState = {
      schema: SECURITY_STATE_SCHEMA,
      suppressed: Array.isArray(legacySec.suppressed) ? legacySec.suppressed : [],
      reviewed: Array.isArray(legacySec.reviewed) ? legacySec.reviewed : [],
    };
    changed = true;
  }

  return { merged, changed };
}

function ensureRecordMeta(record, workspaceRoot) {
  const key = workspaceKey(workspaceRoot);
  return {
    ...record,
    schema: WORKSPACE_SCHEMA,
    workspaceKey: key,
    workspacePath: path.resolve(workspaceRoot),
    updatedAt: new Date().toISOString(),
  };
}

function writeRecordFile(workspaceRoot, record) {
  const filePath = workspaceRecordPath(workspaceRoot);
  if (!filePath) return null;
  fs.mkdirSync(workspacesDir(), { recursive: true });
  const next = ensureRecordMeta(record, workspaceRoot);
  fs.writeFileSync(filePath, JSON.stringify(next, null, 2), "utf8");
  return next;
}

/**
 * @returns {object | null} フル workspace レコード
 */
function readWorkspaceRecord(workspaceRoot) {
  if (!workspaceRoot) return null;

  const filePath = workspaceRecordPath(workspaceRoot);
  let record = filePath ? readJsonFile(filePath) : null;

  const { merged, changed } = mergeLegacyIntoRecord(record, workspaceRoot);
  record = Object.keys(merged).length ? merged : null;

  if (record && (changed || !filePath || !fs.existsSync(filePath))) {
    record = writeRecordFile(workspaceRoot, record);
  }

  return record;
}

/**
 * @param {object} patch セッションキー + pythonEnv / securityWarnState ネスト可
 */
function writeWorkspaceRecord(workspaceRoot, patch) {
  if (!workspaceRoot) return null;
  const prev = readWorkspaceRecord(workspaceRoot) || {};
  const next = { ...prev, ...patch, workspacePath: path.resolve(workspaceRoot) };

  if (patch.pythonEnv === null) {
    delete next.pythonEnv;
  } else if (patch.pythonEnv && typeof patch.pythonEnv === "object") {
    next.pythonEnv = { ...(prev.pythonEnv || {}), ...patch.pythonEnv };
  }
  if (patch.securityWarnState && typeof patch.securityWarnState === "object") {
    next.securityWarnState = { ...(prev.securityWarnState || {}), ...patch.securityWarnState };
  }

  return writeRecordFile(workspaceRoot, next);
}

/** pathsMeta 互換: フラット session オブジェクト */
function readWorkspaceSession(workspaceRoot) {
  const record = readWorkspaceRecord(workspaceRoot);
  if (!record) return null;
  const session = pickSessionFields(record);
  return Object.keys(session).length ? session : null;
}

function writeWorkspaceSession(workspaceRoot, patch) {
  if (!patch || typeof patch !== "object") return readWorkspaceSession(workspaceRoot);
  const sessionPatch = {};
  for (const [k, v] of Object.entries(patch)) {
    if (SESSION_KEYS.has(k) || k === "updatedAt") sessionPatch[k] = v;
  }
  sessionPatch.workspacePath = path.resolve(workspaceRoot);
  const record = writeWorkspaceRecord(workspaceRoot, sessionPatch);
  return pickSessionFields(record);
}

function readPythonEnvMeta(workspaceRoot) {
  const record = readWorkspaceRecord(workspaceRoot);
  return record?.pythonEnv || readLegacyPythonEnv(workspaceRoot);
}

function writePythonEnvMeta(workspaceRoot, meta) {
  const payload = { ...meta, updatedAt: new Date().toISOString() };
  writeWorkspaceRecord(workspaceRoot, { pythonEnv: payload });
  return payload;
}

function readSecurityWarnStateRecord(workspaceRoot) {
  const record = readWorkspaceRecord(workspaceRoot);
  if (record?.securityWarnState) {
    return {
      schema: SECURITY_STATE_SCHEMA,
      suppressed: Array.isArray(record.securityWarnState.suppressed)
        ? record.securityWarnState.suppressed
        : [],
      reviewed: Array.isArray(record.securityWarnState.reviewed)
        ? record.securityWarnState.reviewed
        : [],
    };
  }
  const legacy = readLegacySecurityWarn(workspaceRoot);
  if (legacy) {
    return {
      schema: SECURITY_STATE_SCHEMA,
      suppressed: Array.isArray(legacy.suppressed) ? legacy.suppressed : [],
      reviewed: Array.isArray(legacy.reviewed) ? legacy.reviewed : [],
    };
  }
  return emptySecurityWarnState();
}

function writeSecurityWarnStateRecord(workspaceRoot, state) {
  const payload = {
    schema: SECURITY_STATE_SCHEMA,
    updatedAt: new Date().toISOString(),
    suppressed: state.suppressed || [],
    reviewed: state.reviewed || [],
  };
  writeWorkspaceRecord(workspaceRoot, { securityWarnState: payload });
}

/** @deprecated 互換: 旧 session.json パス（読取フォールバック用） */
function workspaceSessionPath(workspaceRoot) {
  return path.join(legacyNoraDir(workspaceRoot), "session.json");
}

/** テスト用: AppData レコード削除 */
function deleteWorkspaceRecord(workspaceRoot) {
  const filePath = workspaceRecordPath(workspaceRoot);
  if (filePath && fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

module.exports = {
  WORKSPACE_SCHEMA,
  noraOpsRoot,
  workspaceKey,
  workspacesDir,
  workspaceRecordPath,
  readWorkspaceRecord,
  writeWorkspaceRecord,
  readWorkspaceSession,
  writeWorkspaceSession,
  readPythonEnvMeta,
  writePythonEnvMeta,
  readSecurityWarnStateRecord,
  writeSecurityWarnStateRecord,
  workspaceSessionPath,
  deleteWorkspaceRecord,
  normalizeWorkspacePath,
};
