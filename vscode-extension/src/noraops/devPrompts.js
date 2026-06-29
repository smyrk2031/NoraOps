const fs = require("fs");
const path = require("path");
const { readMockSpec, normalizeTargetPlatform } = require("./mockPrompts");

const DEV_MAIN_REL = "main.py";
const DEV_LOG_REL = "logs/log.txt";
const LEGACY_DEV_MAIN_REL = "nora/dev/main.py";
const MAX_EMBED_HTML_CHARS = 100000;

const MOCK_EDIT_TIPS = [
  {
    id: "redo",
    icon: "🔄",
    title: "イメージと大きく違う",
    text: "全体のイメージが合いません。モック作成の手順①から要件を見直して作り直すことをおすすめします。",
  },
  {
    id: "small",
    icon: "✏️",
    title: "少し直したい",
    text: "上記 HTML をベースに、次の点だけ修正してください（箇条書きで具体的に）:\n- （例: ②の登録ボタンを青に / 一覧の列を3つに）",
  },
  {
    id: "onefile",
    icon: "📄",
    title: "1ファイルで返す",
    text: "html1ファイルで完結するようにコピーできる形で提供しなさい。",
  },
  {
    id: "scope",
    icon: "🎯",
    title: "機能を絞る",
    text: "無ければ成立しない機能に絞って作ってください。なくてもよい機能は省いてください（生成コストと品質のため）。",
  },
  {
    id: "layout",
    icon: "📐",
    title: "レイアウト調整",
    text: "レイアウトだけ調整してください。色・余白・フォントサイズ・ボタン配置を次のように変更:\n- ",
  },
  {
    id: "copy",
    icon: "📋",
    title: "文言・ラベル変更",
    text: "表示テキストとラベルのみ変更してください。操作の流れは維持:\n- ",
  },
];

function pyprojectRelForPrompt(workspaceRoot) {
  const { pyprojectPath, hasPyproject, workspaceAppRoot } = require("./projectPaths");
  const root = workspaceAppRoot(workspaceRoot);
  if (hasPyproject(workspaceRoot)) {
    return path.relative(root, pyprojectPath(workspaceRoot)).replace(/\\/g, "/");
  }
  return "pyproject.toml";
}

/** @deprecated use pyprojectRelForPrompt */
const PYPROJECT_REL = "pyproject.toml";

function stepsMentionCapture(operationSteps) {
  const s = String(operationSteps || "");
  return /キャプチャ|スクリーンショット|screenshot|capture|画像取り込み|画面取り込み/i.test(s);
}

function estimateComplexity(operationSteps) {
  const s = String(operationSteps || "");
  const stepMarkers = (s.match(/[①②③④⑤⑥⑦⑧⑨⑩]/g) || []).length;
  return s.length + stepMarkers * 180;
}

/**
 * @param {{ targetPlatform?: string, operationSteps?: string }} spec
 */
function resolveImplementationStack(spec) {
  const platform = normalizeTargetPlatform(spec?.targetPlatform);
  const steps = String(spec?.operationSteps || "");

  if (platform === "browser") {
    return {
      platform,
      stack: "flask",
      label: "Python Flask（軽量 Web サーバ）",
      uiNote: "モックの画面構成を Flask + Jinja2 テンプレートで再現。凝ったデザインより動作優先。",
    };
  }

  if (stepsMentionCapture(steps)) {
    return {
      platform,
      stack: "pyside6",
      label: "PySide6",
      uiNote: "キャプチャ・画像取り込みがあるため PySide6 を使用。",
    };
  }

  const complexity = estimateComplexity(steps);
  if (complexity < 450) {
    return {
      platform,
      stack: "tkinter",
      label: "tkinter（シンプルな Windows アプリ風）",
      uiNote: "操作が少なめのため tkinter。実用寄りの素朴な UI でよい。",
    };
  }
  return {
    platform,
    stack: "pyside6",
    label: "PySide6（中規模の Windows アプリ風）",
    uiNote: "操作手順が多いため PySide6。レイアウトはモックに沿いつつシンプルに。",
  };
}

function readFileSnippet(workspaceRoot, rel, maxChars) {
  const p = path.join(workspaceRoot, rel);
  if (!fs.existsSync(p)) return { text: "", truncated: false, missing: true };
  try {
    const raw = fs.readFileSync(p, "utf8");
    if (raw.length <= maxChars) return { text: raw, truncated: false, missing: false };
    return {
      text: raw.slice(0, maxChars) + "\n\n<!-- …以下省略（先頭のみ添付）… -->",
      truncated: true,
      missing: false,
    };
  } catch {
    return { text: "", truncated: false, missing: true };
  }
}

function buildDevImplementPrompt(workspaceRoot) {
  const spec = readMockSpec(workspaceRoot) || {};
  const appTitle = String(spec.appTitle || path.basename(workspaceRoot)).trim();
  const operationSteps = String(spec.operationSteps || "").trim();
  const stack = resolveImplementationStack(spec);
  const mockHtml = readFileSnippet(workspaceRoot, "nora/mock/index.html", MAX_EMBED_HTML_CHARS);
  const specJson = readFileSnippet(workspaceRoot, "nora/mock/spec.json", 8000);

  const stackRules =
    stack.stack === "flask"
      ? `- Web: **Flask**（軽量）。テンプレートは \`static/\`、起動はルート \`main.py\` から`
      : stack.stack === "pyside6"
        ? `- デスクトップ: **PySide6**。Windows アプリ風の実用 UI`
        : `- デスクトップ: **tkinter**。Windows 標準ウィジェット中心の実用 UI`;

  return `# Python アプリ実装依頼（NoraOps Creator）

## アプリ
${appTitle}

## 操作手順（要件）
${operationSteps || "（spec.json を参照）"}

## 実装スタック
- ${stack.label}
- ${stack.uiNote}
${stackRules}

## 配置ルール（必須）
- 実装は **ワークスペースルート**に置く。エントリは **\`main.py\` の1ファイル完結**
- **ユーザーがアップロードした画像・ファイル**は \`media/uploads/\` または \`static/uploads/\` に保存（Gitea には送らない）
- **アプリのソース**（.js / .css / テンプレート等）は \`static/\` 直下に置く
- 設定ファイル: \`static/\`（無ければ起動時に自動生成）
- データ: 簡素なら **txt / csv / json**（可読性重視）。複雑・性能が必要なら **sqlite3**
- 設定が無い初回起動時は、ユーザーが意識せず使えるよう **デフォルト設定を自動生成**

## ログ（必須）
- **標準出力**に主要処理を出す
- **\`logs/log.txt\`** にも追記（起動・主要操作・例外）。**最大3000行**で古い行から削除（リングバッファ）

## UI・品質
- モックの操作フローを満たすこと。UI は凝らず **トークン効率のよい素朴なデザイン**
- **無くても成立する機能は作らない**（コスト削減）
- 秘密情報・個人データの直書き禁止

## 出力形式（必須）
- **\`main.py\` 1ファイルだけ**を、コピー＆貼り付けできる完全な Python コードとして返す
- 説明文は最小。コードブロック1つで完結させる

---
## 参照: nora/mock/spec.json
\`\`\`json
${specJson.text || "{}"}
\`\`\`

---
## 参照: nora/mock/index.html（モック UI）
${mockHtml.missing ? "（まだモックがありません。spec と操作手順を優先してください）" : mockHtml.truncated ? "（HTML は長いため先頭のみ。全体はユーザーの貼付を参照）" : ""}
\`\`\`html
${mockHtml.text || "<!-- empty -->"}
\`\`\``;
}

const EXTENSION_ROOT = path.join(__dirname, "..", "..");

function readManifestDisplayName(workspaceRoot) {
  try {
    const p = path.join(workspaceRoot, "nora", "manifest.json");
    if (fs.existsSync(p)) {
      const man = JSON.parse(fs.readFileSync(p, "utf8"));
      if (man?.displayName) return String(man.displayName).trim();
    }
  } catch {
    /* ignore */
  }
  return "";
}

/** NoraOps 雛形どおりの pyproject.toml ベース（ルート優先、既存ファイルがあればそれを使用） */
function buildPyprojectBaseForPrompt(workspaceRoot, displayName) {
  const { pyprojectPath, hasPyproject, workspaceAppRoot } = require("./projectPaths");
  if (hasPyproject(workspaceRoot)) {
    try {
      return fs.readFileSync(pyprojectPath(workspaceRoot), "utf8").trim();
    } catch {
      /* fall through to template */
    }
  }
  const folderName = path.basename(workspaceAppRoot(workspaceRoot));
  const dn = String(displayName || readManifestDisplayName(workspaceRoot) || folderName).trim();
  const { packageNameSlug } = require("./pathsMeta");
  const appSlug = packageNameSlug(dn);
  const { getCachedRuntimeConfig } = require("./runtimeConfig");
  const runtime = getCachedRuntimeConfig() || {};
  const pypiUrl = (runtime.pypiIndexUrl || "").trim();
  const pypiIndexBlock = pypiUrl
    ? `[[tool.uv.index]]\nurl = "${pypiUrl}"\ndefault = true\n\n[[tool.uv.index]]\nname = "pypi"\nurl = "https://pypi.org/simple"\n`
    : "# [[tool.uv.index]]\n# url = \"https://intranet/NoraOps/pypi/simple/\"\n# default = true\n";
  const tplPath = path.join(EXTENSION_ROOT, "resources", "templates", "pyproject.toml");
  let text = fs.readFileSync(tplPath, "utf8");
  const vars = { appSlug, displayName: dn, pypiIndexBlock };
  for (const [k, v] of Object.entries(vars)) {
    text = text.split(`{{${k}}}`).join(String(v));
  }
  return text.trim();
}

function buildEnvDepsPrompt(workspaceRoot, displayName) {
  const { resolveScaffoldRoot } = require("./scaffold");
  const root = resolveScaffoldRoot(workspaceRoot);
  const name = String(displayName || readManifestDisplayName(workspaceRoot) || path.basename(root)).trim();
  const pyRel = pyprojectRelForPrompt(workspaceRoot);
  const basePyproject = buildPyprojectBaseForPrompt(workspaceRoot, name);
  let mainSnippet = "";
  const mainPath = devMainPath(workspaceRoot);
  if (fs.existsSync(mainPath)) {
    try {
      const t = fs.readFileSync(mainPath, "utf8");
      mainSnippet = t.length > 12000 ? t.slice(0, 12000) + "\n# …省略…" : t;
    } catch {
      /* ignore */
    }
  }

  return `# Python 環境（uv / pyproject.toml）作成依頼

## 目的
アプリ「${name}」を **Python 3.11.\*** で動かすため、\`${pyRel}\` を更新する。

## ベース（この構成を維持すること）
NoraOps の雛形を土台に、**主に \`dependencies\` だけ**を \`main.py\` に合わせて書き換えてください。
\`[tool.uv]\` や index のコメント行は残してください。

\`\`\`toml
${basePyproject}
\`\`\`

## 制約
- パッケージ管理は **uv** 前提（\`[project]\` + \`dependencies\`）
- \`requires-python = ">=3.11"\` を維持
- \`[tool.uv] package = false\` を維持
- \`readme = "README.md"\` を維持（ルート README）
- 依存は **main.py が import するものだけ**（余計なライブラリを増やさない）
- 出力は **pyproject.toml の全文**のみ（コピーして \`${pyRel}\` にそのまま保存できる形）

## エントリ（参照）
\`main.py\` が起動ファイルです。内容に合わせて dependencies を決めてください。

\`\`\`python
${mainSnippet || "# （まだ main.py がありません。Flask または tkinter/PySide6 の想定スタックに合わせて最小依存を提案）"}
\`\`\`

## 補足
- 仮想環境は NoraOps の「用意する」で **ルート \`.venv\`** に作成されます
- 保存後、NoraOps 環境タブで「用意する」または「パッケージ同期」を実行してください`;
}

/**
 * ユーザー指定の requirements.txt から pyproject.toml 変換用プロンプト（自動スキャンなし）
 */
function buildRequirementsToPyprojectPrompt(workspaceRoot, requirementsRelPath, displayName) {
  const { resolveScaffoldRoot } = require("./scaffold");
  const root = resolveScaffoldRoot(workspaceRoot);
  const pyRel = pyprojectRelForPrompt(workspaceRoot);
  const rel = String(requirementsRelPath || "").replace(/\\/g, "/").trim();
  if (!rel) throw new Error("requirements.txt のパスが未指定です。");

  const absPath = path.join(root, rel);
  const relCheck = path.relative(root, absPath);
  if (relCheck.startsWith("..") || path.isAbsolute(relCheck)) {
    throw new Error("ワークスペース外のファイルは指定できません。");
  }
  if (!fs.existsSync(absPath)) {
    throw new Error(`ファイルが見つかりません: ${rel}`);
  }

  let reqContent = "";
  try {
    reqContent = fs.readFileSync(absPath, "utf8").trim();
  } catch (e) {
    throw new Error(`requirements.txt を読めません: ${e.message}`);
  }
  if (!reqContent) {
    throw new Error("requirements.txt が空です。依存パッケージを書いてから再度お試しください。");
  }
  if (reqContent.length > 32000) {
    reqContent = `${reqContent.slice(0, 32000)}\n# …省略（先頭 32KB のみ）…`;
  }

  const name = String(displayName || readManifestDisplayName(workspaceRoot) || path.basename(root)).trim();
  const basePyproject = buildPyprojectBaseForPrompt(workspaceRoot, name);

  return `# pyproject.toml 作成（requirements.txt から変換）

## 目的
既存アプリ「${name}」を **NoraOps（uv）** で動かすため、ユーザーが指定した \`requirements.txt\` をもとに \`${pyRel}\` を作成してください。

## 重要（必ず守ること）
- **下記「変換元」の内容だけ**を正としてください（他ファイル・main.py から推測しない）
- \`==\` などピン留めがある行は \`dependencies\` にそのまま反映
- バージョンが書かれていない行は、**無理にバージョンを推測しない**（パッケージ名のみ、または一般的な最小指定にとどめる）
- コメント行（\`#\`）は無視
- 出力は **pyproject.toml の全文のみ**（説明文は不要）

## ベース構成（この骨格を維持）
\`dependencies\` 以外はできるだけ維持し、依存リストだけ requirements に合わせて書き換えてください。

\`\`\`toml
${basePyproject}
\`\`\`

## 変換元: \`${rel}\`
\`\`\`
${reqContent}
\`\`\`

## 出力
\`${pyRel}\` にそのまま保存できる **TOML 全文**を出力してください。
\`requires-python = ">=3.11"\`、\`[tool.uv] package = false\`、\`readme = "README.md"\` は維持してください。`;
}

function devMainPath(workspaceRoot) {
  const { resolveScaffoldRoot, noraJoin } = require("./scaffold");
  const root = resolveScaffoldRoot(workspaceRoot);
  const rootMain = path.join(root, "main.py");
  if (fs.existsSync(rootMain)) return rootMain;
  return noraJoin(workspaceRoot, "dev", "main.py");
}

module.exports = {
  MOCK_EDIT_TIPS,
  DEV_MAIN_REL,
  DEV_LOG_REL,
  LEGACY_DEV_MAIN_REL,
  PYPROJECT_REL,
  pyprojectRelForPrompt,
  resolveImplementationStack,
  buildDevImplementPrompt,
  buildEnvDepsPrompt,
  buildRequirementsToPyprojectPrompt,
  buildPyprojectBaseForPrompt,
  devMainPath,
};
