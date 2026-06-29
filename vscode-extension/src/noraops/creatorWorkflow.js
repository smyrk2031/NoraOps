/** Creator ワークフロー / プロファイル */

const { readWorkspaceSession, writeWorkspaceSession } = require("./pathsMeta");

const MODES = {
  GREENFIELD: "greenfield",
  IMPORT: "import",
  VENV_ONLY: "venv-only",
};

const PROFILES = { ...MODES, FORK: "fork" };

const MODE_META = {
  [MODES.GREENFIELD]: {
    id: MODES.GREENFIELD,
    label: "新規開発（0→1）",
    shortLabel: "新規開発",
    description: "モック → 実装 → 環境 → 保存",
  },
  [MODES.IMPORT]: {
    id: MODES.IMPORT,
    label: "既存アプリを公開",
    shortLabel: "既存公開",
    description: "フォルダを整えて Gitea / Runner へ（モック・作るは省略）",
  },
  [MODES.VENV_ONLY]: {
    id: MODES.VENV_ONLY,
    label: "環境・チェックのみ",
    shortLabel: "環境のみ",
    description: "uv とポリシーチェック。雛形は作らない（Gitea 保存なし想定）",
  },
};

function normalizeProfile(raw) {
  const v = String(raw || "").trim().toLowerCase();
  if (v === MODES.VENV_ONLY || v === "venv" || v === "env-only") return MODES.VENV_ONLY;
  if (v === MODES.IMPORT || v === "existing" || v === "publish" || v === PROFILES.FORK) {
    return MODES.IMPORT;
  }
  return MODES.GREENFIELD;
}

/** @deprecated alias */
function normalizeMode(raw) {
  return normalizeProfile(raw);
}

function readCreatorProfile(workspaceRoot) {
  if (!workspaceRoot) return MODES.GREENFIELD;
  const session = readWorkspaceSession(workspaceRoot);
  if (session?.creatorProfile) return normalizeProfile(session.creatorProfile);
  return normalizeProfile(session?.creatorWorkflow);
}

function readCreatorWorkflow(workspaceRoot) {
  return readCreatorProfile(workspaceRoot);
}

function writeCreatorProfile(workspaceRoot, profile) {
  const next = normalizeProfile(profile);
  writeWorkspaceSession(workspaceRoot, { creatorProfile: next, creatorWorkflow: next });
  return next;
}

function writeCreatorWorkflow(workspaceRoot, mode) {
  return writeCreatorProfile(workspaceRoot, mode);
}

/** @returns {Record<string, boolean>} view id → enabled */
function railAvailability(mode) {
  const m = normalizeProfile(mode);
  const xllm = { xllm: true, more: true };
  if (m === MODES.VENV_ONLY) {
    return { mock: false, dev: false, env: true, cloud: false, ...xllm };
  }
  if (m === MODES.IMPORT) {
    return { mock: false, dev: false, env: true, cloud: true, ...xllm };
  }
  return { mock: true, dev: true, env: true, cloud: true, ...xllm };
}

function defaultViewForMode(mode) {
  const m = normalizeProfile(mode);
  if (m === MODES.GREENFIELD) return "mock";
  return "env";
}

function buildWorkflowState(workspaceRoot) {
  const mode = readCreatorProfile(workspaceRoot);
  return {
    mode,
    modes: Object.values(MODE_META),
    meta: MODE_META[mode] || MODE_META[MODES.GREENFIELD],
    rails: railAvailability(mode),
    defaultView: defaultViewForMode(mode),
  };
}

function shouldAutoScaffold(profile) {
  return normalizeProfile(profile) !== MODES.VENV_ONLY;
}

module.exports = {
  MODES,
  PROFILES,
  MODE_META,
  normalizeMode,
  normalizeProfile,
  readCreatorProfile,
  readCreatorWorkflow,
  writeCreatorProfile,
  writeCreatorWorkflow,
  railAvailability,
  defaultViewForMode,
  buildWorkflowState,
  shouldAutoScaffold,
};
