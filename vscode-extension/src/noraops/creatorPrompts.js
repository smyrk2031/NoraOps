/**
 * プロンプト帳（基本 + マイプロンプト）
 */

const crypto = require("crypto");
const { readWorkspaceRecord, writeWorkspaceRecord } = require("./workspaceStore");
const { isCatalogVersionNewer } = require("./catalogVersion");
const { getBuiltinDefs, getBuiltinDef, getCatalogVersion } = require("./builtinPromptCatalog");
const { resolvePromptBody } = require("./promptResolve");

const PROMPTS_SCHEMA = "nora.creator-prompts/1";
const MEMO_SCHEMA = "nora.creator-memos/1";

function newCustomId() {
  return crypto.randomBytes(8).toString("hex");
}

function defaultMeta() {
  return {
    catalogVersion: getCatalogVersion(),
    remoteCatalogVersion: null,
    builtinStates: {},
  };
}

function readMeta(workspaceRoot) {
  const record = readWorkspaceRecord(workspaceRoot);
  const raw = record?.creatorPromptsMeta;
  if (!raw || typeof raw !== "object") return defaultMeta();
  return {
    ...defaultMeta(),
    ...raw,
    builtinStates: { ...(raw.builtinStates || {}) },
  };
}

function saveMeta(workspaceRoot, meta) {
  writeWorkspaceRecord(workspaceRoot, {
    creatorPromptsMeta: meta,
    creatorPromptsSchema: PROMPTS_SCHEMA,
  });
}

function normalizeCustom(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p) => p && typeof p === "object" && String(p.title || "").trim())
    .map((p, i) => ({
      id: String(p.id || newCustomId()),
      kind: "custom",
      title: String(p.title || "").trim().slice(0, 200),
      body: String(p.body || ""),
      enabled: p.enabled !== false,
      showInXllm: p.showInXllm !== false,
      order: Number.isFinite(p.order) ? p.order : i + 1000,
      createdAt: p.createdAt || new Date().toISOString(),
      updatedAt: p.updatedAt || p.createdAt || new Date().toISOString(),
    }))
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
}

function listCustom(workspaceRoot) {
  migrateFromMemos(workspaceRoot);
  const record = readWorkspaceRecord(workspaceRoot);
  return normalizeCustom(record?.creatorPromptsCustom);
}

function saveCustom(workspaceRoot, custom) {
  const normalized = normalizeCustom(custom);
  writeWorkspaceRecord(workspaceRoot, {
    creatorPromptsCustom: normalized,
    creatorPromptsSchema: PROMPTS_SCHEMA,
  });
  return normalized;
}

/** 旧 Memo → マイプロンプトへ一度だけ移行 */
function migrateFromMemos(workspaceRoot) {
  const record = readWorkspaceRecord(workspaceRoot);
  if (!record?.creatorMemos?.length) return;
  if (record.creatorPromptsSchema === PROMPTS_SCHEMA) return;
  const existing = normalizeCustom(record.creatorPromptsCustom);
  const migrated = record.creatorMemos.map((m, i) => ({
    id: m.id || newCustomId(),
    kind: "custom",
    title: String(m.title || "無題").slice(0, 200),
    body: String(m.body || ""),
    enabled: true,
    showInXllm: false,
    order: 2000 + i,
    createdAt: m.createdAt || new Date().toISOString(),
    updatedAt: m.updatedAt || m.createdAt || new Date().toISOString(),
  }));
  writeWorkspaceRecord(workspaceRoot, {
    creatorPromptsCustom: [...existing, ...migrated],
    creatorPromptsSchema: PROMPTS_SCHEMA,
    creatorPromptsMeta: readMeta(workspaceRoot),
    creatorMemos: [],
    creatorMemosSchema: MEMO_SCHEMA,
  });
}

function isBuiltinEnabled(meta, key, def) {
  const st = meta.builtinStates[key];
  if (st && typeof st.enabled === "boolean") return st.enabled;
  return def.defaultEnabled !== false;
}

/**
 * @param {string} workspaceRoot
 * @param {{ includeBody?: boolean, displayName?: string }} [opts]
 */
function listBuiltinPrompts(workspaceRoot, opts = {}) {
  migrateFromMemos(workspaceRoot);
  const meta = readMeta(workspaceRoot);
  return getBuiltinDefs().map((def) => {
    const st = meta.builtinStates[def.key] || {};
    const enabled = isBuiltinEnabled(meta, def.key, def);
    const row = {
      kind: "builtin",
      key: def.key,
      title: def.title,
      category: def.category,
      showInXllm: def.showInXllm,
      dynamic: !!def.dynamic,
      description: def.description || null,
      enabled,
      order: def.order,
      legacyMode: def.legacyMode || null,
      catalogVersion: getCatalogVersion(),
      bodyOverride: st.bodyOverride || null,
    };
    if (opts.includeBody) {
      row.body = resolvePromptBody(def.key, workspaceRoot, {
        bodyOverride: st.bodyOverride,
        displayName: opts.displayName,
        preview: true,
      });
    }
    return row;
  });
}

function listAllPrompts(workspaceRoot, opts = {}) {
  const builtins = listBuiltinPrompts(workspaceRoot, opts);
  const custom = listCustom(workspaceRoot).map((c) => ({
    ...c,
    key: `custom.${c.id}`,
    category: "custom",
  }));
  return [...builtins, ...custom].sort((a, b) => (a.order || 0) - (b.order || 0));
}

/**
 * xLLM ① で表示する有効プロンプト
 * @param {string} workspaceRoot
 */
function listXllmChoices(workspaceRoot) {
  return listAllPrompts(workspaceRoot)
    .filter((p) => p.enabled && p.showInXllm)
    .map((p) => ({
      key: p.kind === "builtin" ? p.key : `custom.${p.id}`,
      title: p.title,
      legacyMode: p.legacyMode || null,
      kind: p.kind,
    }));
}

function setBuiltinEnabled(workspaceRoot, key, enabled) {
  const def = getBuiltinDef(key);
  if (!def) return null;
  const meta = readMeta(workspaceRoot);
  meta.builtinStates[key] = { ...(meta.builtinStates[key] || {}), enabled: !!enabled };
  saveMeta(workspaceRoot, meta);
  return listBuiltinPrompts(workspaceRoot);
}

function addCustom(workspaceRoot, { title, body, enabled }) {
  const custom = listCustom(workspaceRoot);
  const now = new Date().toISOString();
  const maxOrder = custom.reduce((m, x) => Math.max(m, x.order), 999);
  const on = enabled !== false;
  const row = {
    id: newCustomId(),
    kind: "custom",
    title: String(title || "新しいプロンプト").trim().slice(0, 200) || "新しいプロンプト",
    body: String(body || ""),
    enabled: on,
    showInXllm: on,
    order: maxOrder + 1,
    createdAt: now,
    updatedAt: now,
  };
  custom.push(row);
  return { custom: saveCustom(workspaceRoot, custom), prompt: row };
}

function updateCustom(workspaceRoot, id, patch) {
  const custom = listCustom(workspaceRoot);
  const idx = custom.findIndex((p) => p.id === id);
  if (idx < 0) return null;
  const now = new Date().toISOString();
  let enabled = patch.enabled != null ? !!patch.enabled : custom[idx].enabled;
  if (patch.showInXllm != null && patch.enabled == null) {
    enabled = !!patch.showInXllm;
  }
  custom[idx] = {
    ...custom[idx],
    ...patch,
    id: custom[idx].id,
    title: String(patch.title != null ? patch.title : custom[idx].title).trim().slice(0, 200),
    body: patch.body != null ? String(patch.body) : custom[idx].body,
    enabled,
    showInXllm: enabled,
    updatedAt: now,
  };
  return { custom: saveCustom(workspaceRoot, custom), prompt: custom[idx] };
}

function deleteCustom(workspaceRoot, id) {
  return saveCustom(
    workspaceRoot,
    listCustom(workspaceRoot).filter((p) => p.id !== id)
  );
}

function reorderCustom(workspaceRoot, id, direction) {
  const custom = listCustom(workspaceRoot);
  const idx = custom.findIndex((p) => p.id === id);
  if (idx < 0) return custom;
  const swap = direction === "up" ? idx - 1 : idx + 1;
  if (swap < 0 || swap >= custom.length) return custom;
  const oa = custom[idx].order;
  custom[idx].order = custom[swap].order;
  custom[swap].order = oa;
  [custom[idx], custom[swap]] = [custom[swap], custom[idx]];
  return saveCustom(workspaceRoot, custom);
}

/**
 * @param {string} workspaceRoot
 * @param {string} promptKey builtin key or custom.{id}
 */
function resolvePromptForExport(workspaceRoot, promptKey, opts = {}) {
  if (String(promptKey || "").startsWith("custom.")) {
    const id = promptKey.slice("custom.".length);
    const row = listCustom(workspaceRoot).find((p) => p.id === id);
    if (!row || !row.enabled) return { ok: false, reason: "not_found" };
    return {
      ok: true,
      key: promptKey,
      title: row.title,
      body: row.body,
      legacyMode: null,
      isError: false,
      isDocsStyle: false,
    };
  }
  const def = getBuiltinDef(promptKey);
  if (!def) return { ok: false, reason: "not_found" };
  const meta = readMeta(workspaceRoot);
  const st = meta.builtinStates[promptKey] || {};
  if (!isBuiltinEnabled(meta, promptKey, def)) return { ok: false, reason: "disabled" };
  const { isErrorPromptKey, isDocsStylePromptKey } = require("./promptResolve");
  return {
    ok: true,
    key: promptKey,
    title: def.title,
    body: resolvePromptBody(promptKey, workspaceRoot, {
      bodyOverride: st.bodyOverride,
      displayName: opts.displayName,
    }),
    legacyMode: def.legacyMode || null,
    isError: isErrorPromptKey(promptKey),
    isDocsStyle: isDocsStylePromptKey(promptKey),
  };
}

/**
 * サーバーから受け取ったカタログをマージ
 * @param {string} workspaceRoot
 * @param {{ version: string, prompts: object[] }} remote
 */
function mergeRemoteCatalog(workspaceRoot, remote) {
  if (!remote?.prompts?.length) return { updated: 0, meta: readMeta(workspaceRoot) };
  const meta = readMeta(workspaceRoot);
  let updated = 0;
  for (const rp of remote.prompts) {
    if (!rp?.key) continue;
    const def = getBuiltinDef(rp.key);
    if (!def) {
      // 新規キーは builtinStates に追加（拡張未同梱の将来用）
      if (!meta.builtinStates[rp.key]) {
        meta.builtinStates[rp.key] = {
          enabled: rp.defaultEnabled !== false,
          bodyOverride: rp.body || null,
          remoteTitle: rp.title || null,
        };
        updated++;
      }
      continue;
    }
    const prev = meta.builtinStates[rp.key] || {};
    const next = { ...prev };
    if (rp.body && !def.dynamic) {
      if (prev.bodyOverride !== rp.body) {
        next.bodyOverride = rp.body;
        updated++;
      }
    }
    if (rp.title) next.remoteTitle = rp.title;
    meta.builtinStates[rp.key] = next;
  }
  meta.remoteCatalogVersion = remote.version || meta.remoteCatalogVersion;
  if (remote.version && remote.version !== meta.catalogVersion) {
    meta.catalogVersion = remote.version;
  }
  saveMeta(workspaceRoot, meta);
  return { updated, meta };
}

function getSyncStatus(workspaceRoot) {
  const meta = readMeta(workspaceRoot);
  const localVer = getCatalogVersion();
  const remoteVer = meta.remoteCatalogVersion;
  return {
    localVersion: localVer,
    remoteVersion: remoteVer,
    hasUpdate: isCatalogVersionNewer(remoteVer, localVer),
    pendingRemote: isCatalogVersionNewer(remoteVer, meta.catalogVersion),
  };
}

module.exports = {
  PROMPTS_SCHEMA,
  listBuiltinPrompts,
  listCustom,
  listAllPrompts,
  listXllmChoices,
  setBuiltinEnabled,
  addCustom,
  updateCustom,
  deleteCustom,
  reorderCustom,
  resolvePromptForExport,
  mergeRemoteCatalog,
  getSyncStatus,
  readMeta,
  migrateFromMemos,
};
