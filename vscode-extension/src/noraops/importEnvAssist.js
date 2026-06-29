const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { resolveScaffoldRoot } = require("./scaffold");

const SKIP_DIRS = new Set([
  ".venv",
  "venv",
  "node_modules",
  ".git",
  "__pycache__",
  "site-packages",
  "dist",
  "build",
  ".nora",
  "runner-envs",
]);

/** ワークスペース内の requirements.txt（.venv 等は除外） */
function discoverRequirementsFiles(workspaceRoot) {
  const root = resolveScaffoldRoot(workspaceRoot);
  const found = [];

  function walk(dir, prefix) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (ent.name.startsWith(".") && ent.name !== ".") continue;
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name)) continue;
        walk(path.join(dir, ent.name), prefix ? `${prefix}/${ent.name}` : ent.name);
        continue;
      }
      if (ent.isFile() && /^requirements.*\.txt$/i.test(ent.name)) {
        const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
        found.push(rel.replace(/\\/g, "/"));
      }
    }
  }

  walk(root, "");
  return [...new Set(found)].sort((a, b) => {
    if (a === "requirements.txt") return -1;
    if (b === "requirements.txt") return 1;
    return a.localeCompare(b);
  });
}

/** 自動で選べる requirements.txt（ルート1件、または全体で1件のみ） */
function suggestRequirementsPath(workspaceRoot, discovered) {
  const list = discovered || discoverRequirementsFiles(workspaceRoot);
  if (list.includes("requirements.txt")) return "requirements.txt";
  if (list.length === 1) return list[0];
  return null;
}

function pipFreeze(pythonExe) {
  return new Promise((resolve, reject) => {
    execFile(
      pythonExe,
      ["-m", "pip", "freeze"],
      { timeout: 120000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const detail = String(stderr || err.message || "").trim();
          reject(
            new Error(
              detail ||
                "pip freeze に失敗しました。選択した python.exe が pip 付きか確認してください。"
            )
          );
          return;
        }
        resolve(String(stdout || "").trim());
      }
    );
  });
}

async function pickPythonExecutable() {
  const vscode = require("vscode");
  const uris = await vscode.window.showOpenDialog({
    canSelectMany: false,
    canSelectFiles: true,
    canSelectFolders: false,
    filters: process.platform === "win32" ? { Python: ["exe"] } : undefined,
    title: "いまアプリを動かしている python.exe を選択",
    openLabel: "選択",
  });
  return uris?.[0]?.fsPath || null;
}

/**
 * python.exe から pip freeze → ワークスペースの requirements.txt
 * @returns {{ relPath: string, lineCount: number }}
 */
async function captureRequirementsFromPython(workspaceRoot, pythonExe, options = {}) {
  if (!pythonExe || !fs.existsSync(pythonExe)) {
    throw new Error("python.exe が見つかりません。");
  }
  const root = resolveScaffoldRoot(workspaceRoot);
  const relPath = String(options.relPath || "requirements.txt").replace(/\\/g, "/");
  const absPath = path.join(root, relPath);
  const relCheck = path.relative(root, absPath);
  if (relCheck.startsWith("..") || path.isAbsolute(relCheck)) {
    throw new Error("requirements.txt はワークスペース内に保存してください。");
  }

  const raw = await pipFreeze(pythonExe);
  if (!raw) {
    throw new Error("pip freeze の結果が空です。別の Python を選ぶか、手動で requirements.txt を用意してください。");
  }

  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));

  const header =
    "# NoraOps: 指定した python.exe から pip freeze で取得\n" +
    `# ${pythonExe.replace(/\\/g, "/")}\n`;
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, header + lines.join("\n") + "\n", "utf8");

  return { relPath, lineCount: lines.length };
}

module.exports = {
  discoverRequirementsFiles,
  suggestRequirementsPath,
  pickPythonExecutable,
  pipFreeze,
  captureRequirementsFromPython,
};
