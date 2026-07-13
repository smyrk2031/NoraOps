/**
 * 拡張同梱の基本プロンプトカタログ（オフライン優先）
 */

const path = require("path");
const fs = require("fs");

const EXTENSION_ROOT = path.join(__dirname, "..", "..");
const PROMPTS_DIR = path.join(EXTENSION_ROOT, "resources", "prompts");

/** @type {string} */
const CATALOG_VERSION = "0.28.1";

/**
 * @typedef {object} BuiltinPromptDef
 * @property {string} key
 * @property {string} title
 * @property {string} category creator|xllm
 * @property {boolean} showInXllm
 * @property {number} order
 * @property {boolean} [dynamic]
 * @property {string} [resolver] mock|dev|env|xllm.*
 * @property {string} [legacyMode] general|error|docs
 * @property {string} [description]
 * @property {boolean} [defaultEnabled]
 */

/** @type {BuiltinPromptDef[]} */
const BUILTIN_DEFS = [
  {
    key: "creator.mock",
    title: "モック生成",
    category: "creator",
    showInXllm: false,
    order: 10,
    dynamic: true,
    resolver: "mock",
    description: "Creator「モック」用。ワークスペースの spec.json・フォルダ名からアプリ名を自動反映。",
    defaultEnabled: true,
  },
  {
    key: "creator.dev",
    title: "0→1 実装",
    category: "creator",
    showInXllm: false,
    order: 20,
    dynamic: true,
    resolver: "dev",
    description: "Creator「作る」で使う Python 実装プロンプト。モック HTML と spec を参照して動的に組み立てます。",
    defaultEnabled: true,
  },
  {
    key: "creator.env",
    title: "環境セットアップ",
    category: "creator",
    showInXllm: false,
    order: 30,
    dynamic: true,
    resolver: "env",
    description: "Creator「環境」で使う pyproject / uv セットアップ用プロンプト。",
    defaultEnabled: true,
  },
  {
    key: "xllm.general",
    title: "通常（改修・追加）",
    category: "xllm",
    showInXllm: true,
    order: 100,
    resolver: "xllm.general",
    legacyMode: "general",
    defaultEnabled: true,
  },
  {
    key: "xllm.error",
    title: "エラー調査",
    category: "xllm",
    showInXllm: true,
    order: 110,
    resolver: "xllm.error",
    legacyMode: "error",
    defaultEnabled: true,
  },
  {
    key: "xllm.docs.readme",
    title: "README",
    category: "xllm",
    showInXllm: true,
    order: 200,
    resolver: "xllm.docs.readme",
    defaultEnabled: true,
  },
  {
    key: "xllm.docs.spec",
    title: "仕様書（MD）",
    category: "xllm",
    showInXllm: true,
    order: 210,
    resolver: "xllm.docs.spec",
    defaultEnabled: true,
  },
  {
    key: "xllm.docs.spec-html",
    title: "仕様書（HTML）",
    category: "xllm",
    showInXllm: true,
    order: 211,
    resolver: "xllm.docs.spec-html",
    description: "実画面 UI を HTML で復元し、Mermaid フローを併記する仕様書。",
    defaultEnabled: true,
  },
  {
    key: "xllm.docs.manual",
    title: "手順書（MD）",
    category: "xllm",
    showInXllm: true,
    order: 220,
    resolver: "xllm.docs.manual",
    defaultEnabled: true,
  },
  {
    key: "xllm.docs.manual-html",
    title: "手順書（HTML）",
    category: "xllm",
    showInXllm: true,
    order: 221,
    resolver: "xllm.docs.manual-html",
    description: "各手順に画面ミニ復元を付けた HTML 手順書。",
    defaultEnabled: true,
  },
  {
    key: "xllm.docs.license",
    title: "ライセンス",
    category: "xllm",
    showInXllm: true,
    order: 230,
    resolver: "xllm.docs.license",
    defaultEnabled: true,
  },
  {
    key: "xllm.docs.flowchart",
    title: "フローチャート",
    category: "xllm",
    showInXllm: true,
    order: 240,
    resolver: "xllm.docs.flowchart",
    defaultEnabled: true,
  },
  {
    key: "xllm.docs.teardown",
    title: "解体新書",
    category: "xllm",
    showInXllm: true,
    order: 250,
    resolver: "xllm.docs.teardown",
    description:
      "LLM 向けの全体構造・設計思想をまとめた docs/解体新書.md。xLLM 開発の精度向上に有効です。",
    defaultEnabled: true,
  },
  {
    key: "xllm.docs.portal",
    title: "ドキュメント統括",
    category: "xllm",
    showInXllm: true,
    order: 260,
    resolver: "xllm.docs.portal",
    description:
      "docs/ 内の md・html をすべて 1 つの HTML にまとめ、タブ切替で閲覧できるポータル（docs/ドキュメント統括.html）。",
    defaultEnabled: true,
  },
  {
    key: "xllm.docs.bundle",
    title: "ドキュメント一式（従来）",
    category: "xllm",
    showInXllm: false,
    order: 290,
    resolver: "xllm.docs.bundle",
    legacyMode: "docs",
    description: "5 ファイルを一括生成する従来モード。個別プロンプトを推奨。",
    defaultEnabled: false,
  },
];

function readBodyFile(name) {
  const p = path.join(PROMPTS_DIR, name);
  if (!fs.existsSync(p)) return null;
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

function getBuiltinDefs() {
  return BUILTIN_DEFS.slice().sort((a, b) => a.order - b.order);
}

function getBuiltinDef(key) {
  return BUILTIN_DEFS.find((d) => d.key === key) || null;
}

function getCatalogVersion() {
  return CATALOG_VERSION;
}

/**
 * サーバー配布用のシリアライズ（静的本文は resolver 経由で解決）
 * @param {string} [workspaceRoot]
 */
function exportCatalogForServer(workspaceRoot) {
  const { resolvePromptBody } = require("./promptResolve");
  const ws = workspaceRoot || path.join(EXTENSION_ROOT, "resources", "templates");
  return {
    version: CATALOG_VERSION,
    prompts: BUILTIN_DEFS.map((d) => ({
      key: d.key,
      title: d.title,
      category: d.category,
      showInXllm: d.showInXllm,
      order: d.order,
      dynamic: !!d.dynamic,
      legacyMode: d.legacyMode || null,
      description: d.description || null,
      defaultEnabled: d.defaultEnabled !== false,
      body: d.dynamic ? null : resolvePromptBody(d.key, ws, { preview: true }),
    })),
  };
}

module.exports = {
  CATALOG_VERSION,
  PROMPTS_DIR,
  getBuiltinDefs,
  getBuiltinDef,
  getCatalogVersion,
  readBodyFile,
  exportCatalogForServer,
};
