const fs = require("fs");
const path = require("path");
const vscode = require("vscode");
const { readNoraManifest, resolveAppEntry } = require("./appEntry");
const { noraJoin, resolveScaffoldRoot } = require("./scaffold");

const DEFAULT_ENTRY_REL = "main.py";

/** 自動起動候補にしない（コピー・テスト・バックアップ等） */
const EXCLUDE_NAME = /(?:^test_|_test\.py$|_コピー|_copy|_old|_backup|\.bak$|^__)/i;

const { packagesDir } = require("./projectPaths");

function projectDirFor(workspaceRoot) {
  return packagesDir(workspaceRoot);
}

function listScriptCandidates(workspaceRoot) {
  const { resolveScaffoldRoot, noraJoin } = require("./scaffold");
  const root = resolveScaffoldRoot(workspaceRoot);
  const found = new Map();

  const add = (rel, hint) => {
    const norm = rel.replace(/\\/g, "/");
    if (EXCLUDE_NAME.test(path.basename(norm))) return;
    const abs = path.join(root, norm);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return;
    if (!found.has(norm)) found.set(norm, hint);
  };

  for (const rel of ["main.py", "nora/dev/main.py", "app.py", "run.py", "src/main.py"]) {
    add(rel, rel === "main.py" ? "Creator アプリ本体" : rel.startsWith("nora/dev") ? "旧 Creator 配置" : "よく使う名前");
  }

  try {
    for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
      if (!ent.isFile() || !ent.name.endsWith(".py")) continue;
      add(ent.name, "ルートの .py");
    }
  } catch {
    /* ignore */
  }

  const devDir = noraJoin(workspaceRoot, "dev");
  if (fs.existsSync(devDir)) {
    try {
      for (const ent of fs.readdirSync(devDir, { withFileTypes: true })) {
        if (!ent.isFile() || !ent.name.endsWith(".py")) continue;
        add(`nora/dev/${ent.name}`, "nora/dev");
      }
    } catch {
      /* ignore */
    }
  }

  const pkg = noraJoin(workspaceRoot, "packages");
  if (fs.existsSync(pkg)) {
    try {
      for (const ent of fs.readdirSync(pkg, { withFileTypes: true })) {
        if (!ent.isFile() || !ent.name.endsWith(".py")) continue;
        add(`nora/packages/${ent.name}`, "nora/packages");
      }
    } catch {
      /* ignore */
    }
  }

  return [...found.entries()].map(([rel, hint]) => ({ rel, hint, kind: "script" }));
}

function listModuleCandidates(workspaceRoot) {
  const root = path.resolve(resolveScaffoldRoot(workspaceRoot));
  const mods = [];

  function scanDir(dir, prefix) {
    const init = path.join(dir, "__init__.py");
    if (!fs.existsSync(init)) return;
    const rel = prefix.replace(/\\/g, "/");
    if (rel && !EXCLUDE_NAME.test(path.basename(rel))) {
      mods.push({ rel, module: rel.replace(/\//g, "."), hint: "パッケージ (python -m)", kind: "module" });
    }
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (!ent.isDirectory() || ent.name.startsWith(".") || ent.name === "__pycache__") continue;
      scanDir(path.join(dir, ent.name), prefix ? `${prefix}/${ent.name}` : ent.name);
    }
  }

  scanDir(root, "");
  const pkg = noraJoin(workspaceRoot, "packages");
  if (fs.existsSync(pkg)) scanDir(pkg, "nora/packages");
  return mods;
}

function writeManifestEntry(workspaceRoot, choice) {
  const manPath = noraJoin(workspaceRoot, "manifest.json");
  let man = readNoraManifest(workspaceRoot) || {
    schema: "nora.manifest/1",
    language: "python",
    entry: DEFAULT_ENTRY_REL,
    version: "0.1.0",
  };
  if (choice.kind === "module") {
    man.entryKind = "module";
    man.entryModule = choice.module;
    man.entry = man.entry || "__main__.py";
  } else {
    man.entryKind = "script";
    delete man.entryModule;
    man.entry = choice.rel;
  }
  fs.mkdirSync(path.dirname(manPath), { recursive: true });
  fs.writeFileSync(manPath, JSON.stringify(man, null, 2) + "\n", "utf8");
  return man;
}

/** 旧 manifest（nora/dev/main.py 等）を main.py に寄せる */
function migrateManifestEntry(workspaceRoot) {
  const man = readNoraManifest(workspaceRoot);
  if (!man || man.entryKind === "module" || !man.entry) return false;
  const entry = man.entry.replace(/\\/g, "/");
  if (entry === DEFAULT_ENTRY_REL) return false;
  const root = resolveScaffoldRoot(workspaceRoot);
  const rootMain = path.join(root, "main.py");
  const legacyEntries = new Set(["nora/dev/main.py", "nora/packages/main.py"]);
  if (!legacyEntries.has(entry) && entry !== "main.py") return false;
  if (!fs.existsSync(rootMain)) return false;
  writeManifestEntry(workspaceRoot, { kind: "script", rel: DEFAULT_ENTRY_REL });
  return true;
}

/** manifest 未設定時に main.py をデフォルト登録 */
function ensureDefaultLaunchEntry(workspaceRoot) {
  migrateManifestEntry(workspaceRoot);
  const man = readNoraManifest(workspaceRoot);
  if (man?.entryKind === "module" && man.entryModule) return man;
  if (man?.entry) return man;
  const root = resolveScaffoldRoot(workspaceRoot);
  const rootMain = path.join(root, "main.py");
  const legacyMain = noraJoin(workspaceRoot, "dev", "main.py");
  if (fs.existsSync(rootMain)) {
    return writeManifestEntry(workspaceRoot, { kind: "script", rel: DEFAULT_ENTRY_REL });
  }
  if (fs.existsSync(legacyMain)) {
    return writeManifestEntry(workspaceRoot, { kind: "script", rel: "nora/dev/main.py" });
  }
  return man;
}

/**
 * 保存前: 起動ファイル／パッケージを manifest に固定。曖昧ならユーザーに選ばせる。
 * @returns {{ ok: boolean, cancelled?: boolean, entry?: string }}
 */
async function ensureEntryOnSave(workspaceRoot) {
  ensureDefaultLaunchEntry(workspaceRoot);
  const proj = projectDirFor(workspaceRoot);
  const current = resolveAppEntry(workspaceRoot, proj);
  const manifest = readNoraManifest(workspaceRoot);

  if (manifest?.entryKind === "module" && manifest.entryModule) {
    return { ok: true, entry: `python -m ${manifest.entryModule}` };
  }
  if (manifest?.entry && current?.scriptPath) {
    const rel = path.relative(workspaceRoot, current.scriptPath).replace(/\\/g, "/");
    if (rel === manifest.entry.replace(/\\/g, "/")) {
      return { ok: true, entry: rel };
    }
  }

  const scripts = listScriptCandidates(workspaceRoot);
  const modules = listModuleCandidates(workspaceRoot);
  const items = [];

  for (const s of scripts) {
    items.push({
      label: s.rel,
      description: s.hint,
      detail: "スクリプトとして起動 (uv run python …)",
      pick: { kind: "script", rel: s.rel },
    });
  }
  for (const m of modules.slice(0, 8)) {
    items.push({
      label: `python -m ${m.module}`,
      description: m.hint,
      detail: m.rel,
      pick: { kind: "module", module: m.module, rel: m.rel },
    });
  }

  if (!items.length) {
    vscode.window.showErrorMessage(
      "起動用の .py またはパッケージ (__init__.py) が見つかりません。main.py を置くか nora/manifest.json を編集してください。"
    );
    return { ok: false };
  }

  if (items.length === 1) {
    writeManifestEntry(workspaceRoot, items[0].pick);
    return {
      ok: true,
      entry: items[0].pick.kind === "module" ? `python -m ${items[0].pick.module}` : items[0].pick.rel,
    };
  }

  const chosen = await vscode.window.showQuickPick(items, {
    title: "NoraOps: 起動のトップファイルを指定",
    placeHolder:
      "Runner が起動するファイル／パッケージを選んでください（main_コピー.py などは一覧に出ますが、選ばなければ起動しません）",
    ignoreFocusOut: true,
  });
  if (!chosen) return { ok: false, cancelled: true };

  writeManifestEntry(workspaceRoot, chosen.pick);
  const label =
    chosen.pick.kind === "module" ? `python -m ${chosen.pick.module}` : chosen.pick.rel;
  vscode.window.showInformationMessage(`起動ファイルを登録しました: ${label}（nora/manifest.json）`);
  return { ok: true, entry: label };
}

function getCurrentLaunchChoice(workspaceRoot) {
  const man = readNoraManifest(workspaceRoot);
  if (!man) return null;
  if (man.entryKind === "module" && man.entryModule) {
    return {
      kind: "module",
      module: man.entryModule,
      rel: man.entryModule.replace(/\./g, "/"),
      label: `python -m ${man.entryModule}`,
    };
  }
  if (man.entry) {
    return { kind: "script", rel: man.entry.replace(/\\/g, "/"), label: man.entry };
  }
  return null;
}

function buildFileTreeFromItems(items) {
  const root = { name: "", path: "", children: {}, files: [] };
  for (const item of items) {
    const parts = item.rel.split("/");
    let node = root;
    let acc = "";
    for (let i = 0; i < parts.length - 1; i++) {
      acc = acc ? `${acc}/${parts[i]}` : parts[i];
      if (!node.children[parts[i]]) {
        node.children[parts[i]] = { name: parts[i], path: acc, children: {}, files: [] };
      }
      node = node.children[parts[i]];
    }
    node.files.push(item);
  }
  return root;
}

function treeToJson(node) {
  return {
    name: node.name,
    path: node.path,
    files: node.files,
    folders: Object.values(node.children)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(treeToJson),
  };
}

function buildLaunchEntryCatalog(workspaceRoot) {
  ensureDefaultLaunchEntry(workspaceRoot);
  const current = getCurrentLaunchChoice(workspaceRoot);
  const scripts = listScriptCandidates(workspaceRoot);
  const modules = listModuleCandidates(workspaceRoot);
  const scriptTree = treeToJson(buildFileTreeFromItems(scripts.map((s) => ({ ...s, kind: "script" }))));
  return {
    current,
    scriptTree,
    modules: modules.map((m) => ({
      kind: "module",
      module: m.module,
      rel: m.rel,
      label: `python -m ${m.module}`,
      hint: m.hint,
      selected: current?.kind === "module" && current.module === m.module,
    })),
  };
}

/** @deprecated QuickPick — Creator モーダルから buildLaunchEntryCatalog を使う */
async function pickLaunchEntry(workspaceRoot) {
  const scripts = listScriptCandidates(workspaceRoot);
  const modules = listModuleCandidates(workspaceRoot);
  const items = [];
  for (const s of scripts) {
    items.push({
      label: s.rel,
      description: s.hint,
      pick: { kind: "script", rel: s.rel },
    });
  }
  for (const m of modules.slice(0, 12)) {
    items.push({
      label: `python -m ${m.module}`,
      description: m.hint,
      pick: { kind: "module", module: m.module, rel: m.rel },
    });
  }
  if (!items.length) {
    vscode.window.showErrorMessage("起動候補の .py が見つかりません。先に雛形を入れるか main.py を置いてください。");
    return { ok: false };
  }
  const chosen = await vscode.window.showQuickPick(items, {
    title: "起動ファイルを指定（Runner が使う入口）",
    placeHolder: "例: main.py ではなく myapp.py を選ぶ場合はここで指定",
    ignoreFocusOut: true,
  });
  if (!chosen) return { ok: false, cancelled: true };
  writeManifestEntry(workspaceRoot, chosen.pick);
  const label =
    chosen.pick.kind === "module" ? `python -m ${chosen.pick.module}` : chosen.pick.rel;
  return { ok: true, entry: label };
}

module.exports = {
  ensureEntryOnSave,
  pickLaunchEntry,
  listScriptCandidates,
  listModuleCandidates,
  writeManifestEntry,
  getCurrentLaunchChoice,
  buildLaunchEntryCatalog,
  ensureDefaultLaunchEntry,
  migrateManifestEntry,
  DEFAULT_ENTRY_REL,
  EXCLUDE_NAME,
};
