/**
 * ローカル git（表示用 origin のメタデータ・履歴パネルのみ）。
 * クラウド保存は zip → FastAPI。Runner は artifact。ここで commit/push しない。
 */
const { spawn } = require("child_process");
const { resolveGitExe } = require("./toolInstaller");

function isDubiousOwnershipError(msg) {
  return /dubious ownership|safe\.directory/i.test(String(msg || ""));
}

function runGit(cwd, args) {
  const git = resolveGitExe() || "git";
  return new Promise((resolve, reject) => {
    const child = spawn(git, args, {
      cwd,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    let out = "";
    let err = "";
    child.stdout?.on("data", (c) => (out += c));
    child.stderr?.on("data", (c) => (err += c));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve((out || err).trim());
      else reject(new Error(err.trim() || out.trim() || `git exit ${code}`));
    });
  });
}

async function ensureRepo(cwd) {
  try {
    await runGit(cwd, ["rev-parse", "--git-dir"]);
    return { ok: true, existed: true };
  } catch {
    await runGit(cwd, ["init", "-b", "main"]);
    return { ok: true, existed: false };
  }
}

module.exports = { runGit, ensureRepo, isDubiousOwnershipError };
