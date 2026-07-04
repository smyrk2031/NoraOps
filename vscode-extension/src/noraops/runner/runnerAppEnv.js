/**
 * Runner 起動時の .env 同期。
 * ZIP / 公開アーティファクトには .env を含めないため、ローカルに別途保持する。
 */
const fs = require("fs");
const path = require("path");
const { noraOpsLocalRoot, cacheKey } = require("./runnerPaths");

function runnerDotenvStorePath(owner, name) {
  return path.join(noraOpsLocalRoot(), "runner-dotenv", cacheKey(owner, name), ".env");
}

function workspaceDotenvPath(workspaceRoot) {
  return path.join(workspaceRoot, ".env");
}

/**
 * 起動前に .env をワークスペースへ反映する。
 * - ワークスペースに .env があればそれを正とし、ストアへバックアップ
 * - 無ければストアからコピー
 */
function syncRunnerAppEnv(workspaceRoot, owner, name) {
  if (!workspaceRoot || !owner || !name) return { applied: false, source: null };
  const wsEnv = workspaceDotenvPath(workspaceRoot);
  const storeEnv = runnerDotenvStorePath(owner, name);

  if (fs.existsSync(wsEnv)) {
    try {
      fs.mkdirSync(path.dirname(storeEnv), { recursive: true });
      fs.copyFileSync(wsEnv, storeEnv);
      return { applied: true, source: "workspace" };
    } catch {
      return { applied: true, source: "workspace" };
    }
  }

  if (fs.existsSync(storeEnv)) {
    try {
      fs.copyFileSync(storeEnv, wsEnv);
      return { applied: true, source: "store" };
    } catch {
      return { applied: false, source: null };
    }
  }

  const fromDev = findDevWorkspaceDotenv(owner, name);
  if (fromDev) {
    try {
      fs.mkdirSync(path.dirname(storeEnv), { recursive: true });
      fs.copyFileSync(fromDev, storeEnv);
      fs.copyFileSync(fromDev, wsEnv);
      return { applied: true, source: "dev-workspace" };
    } catch {
      return { applied: false, source: null };
    }
  }

  return { applied: false, source: null };
}

/** Creator 開発フォルダにだけ .env がある場合の救済 */
function findDevWorkspaceDotenv(owner, name) {
  const workspacesDir = path.join(noraOpsLocalRoot(), "workspaces");
  if (!fs.existsSync(workspacesDir)) return null;
  const targetFull = `${owner}/${name}`.toLowerCase();
  let entries;
  try {
    entries = fs.readdirSync(workspacesDir);
  } catch {
    return null;
  }
  for (const file of entries) {
    if (!file.endsWith(".json")) continue;
    let rec;
    try {
      rec = JSON.parse(fs.readFileSync(path.join(workspacesDir, file), "utf8"));
    } catch {
      continue;
    }
    const ws = rec.workspacePath;
    if (!ws || !fs.existsSync(ws)) continue;
    const full = String(rec.giteaFullName || "").toLowerCase();
    const gName = String(rec.giteaName || "").toLowerCase();
    const matches =
      full === targetFull ||
      (gName && gName === String(name).toLowerCase()) ||
      (owner === "local" && String(rec.displayName || "").toLowerCase() === String(name).toLowerCase());
    if (!matches) continue;
    const envPath = path.join(ws, ".env");
    if (fs.existsSync(envPath)) return envPath;
  }
  return null;
}

module.exports = {
  runnerDotenvStorePath,
  syncRunnerAppEnv,
};
