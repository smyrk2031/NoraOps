/**
 * ワークスペース設計改定（Phase 1–4）のローカル確認。
 * 設定タブ「接続テスト」・Creator「動作確認」から呼ばれる。
 */
const fs = require("fs");
const path = require("path");
const { readWorkspaceSession } = require("./pathsMeta");
const { readCreatorProfile, MODES } = require("./creatorWorkflow");
const { resolveScaffoldRoot } = require("./scaffold");
const { hasPyproject, pyprojectPath, defaultWorkspaceVenvDir, probeExistingVenvDir } = require("./projectPaths");
const { getNoraOpsRepoMeta } = require("./repoMeta");
const { normalizeGiteaRepoId } = require("./giteaRepoId");
const { fetchRegistryByGiteaId } = require("./giteaBinding");
const { readNoraManifest } = require("./appEntry");

function check(id, name, ok, detail = "", hint = "") {
  return { id, name, ok, detail, hint };
}

function pyprojectRel(workspaceRoot) {
  const root = resolveScaffoldRoot(workspaceRoot);
  if (!hasPyproject(workspaceRoot)) return null;
  return path.relative(root, pyprojectPath(workspaceRoot)).replace(/\\/g, "/");
}

/**
 * @param {string|null} workspaceRoot
 * @returns {Promise<{ ok: boolean, passed: number, total: number, checks: object[], scope: string }>}
 */
async function runWorkspaceDesignChecks(workspaceRoot) {
  const checks = [];

  if (!workspaceRoot) {
    checks.push(
      check(
        "folder",
        "ワークスペースフォルダ",
        false,
        "未オープン",
        "Creator でアプリフォルダを開いてから再実行"
      )
    );
    return { ok: false, passed: 0, total: checks.length, checks, scope: "workspace-design" };
  }

  const root = resolveScaffoldRoot(workspaceRoot);
  const session = readWorkspaceSession(workspaceRoot);
  checks.push(
    check(
      "appdata_session",
      "AppData セッション",
      true,
      session ? "workspaces/*.json 読込 OK" : "初回 — 保存または雛形で作成",
      "%LOCALAPPDATA%\\NoraOps\\workspaces\\"
    )
  );

  const profile = readCreatorProfile(workspaceRoot);
  checks.push(
    check(
      "creator_profile",
      "Creator プロファイル",
      true,
      profile,
      profile === MODES.VENV_ONLY ? "雛形は作らないモード" : ""
    )
  );

  const pyRel = pyprojectRel(workspaceRoot);
  checks.push(
    check(
      "pyproject",
      "pyproject.toml（ルート優先）",
      !!pyRel,
      pyRel || "未作成",
      "環境タブ → プロンプト作成 or「用意する」"
    )
  );

  const manifestPath = path.join(root, "nora", "manifest.json");
  const hasManifest = fs.existsSync(manifestPath);
  const manifestRequired = profile !== MODES.VENV_ONLY;
  checks.push(
    check(
      "manifest",
      "nora/manifest.json",
      !manifestRequired || hasManifest,
      hasManifest ? "あり" : manifestRequired ? "なし（Gitea 保存に必要）" : "任意（環境のみモード）",
      "import / 保存前は manifest + appId が必要"
    )
  );

  const venvDir = probeExistingVenvDir(workspaceRoot) || defaultWorkspaceVenvDir(workspaceRoot);
  const pyExe =
    process.platform === "win32"
      ? path.join(venvDir, "Scripts", "python.exe")
      : path.join(venvDir, "bin", "python");
  const venvOk = fs.existsSync(pyExe);
  checks.push(
    check(
      "venv_root",
      "仮想環境（.venv 優先）",
      venvOk,
      venvOk ? path.relative(root, venvDir).replace(/\\/g, "/") : "未作成",
      "環境タブ「Python 環境を用意する」"
    )
  );

  const gitignoreOk = fs.existsSync(path.join(root, ".gitignore"));
  if (gitignoreOk) {
    const gi = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
    checks.push(
      check(
        "gitignore_nora",
        ".gitignore（.nora/）",
        /\.nora\/?/.test(gi),
        /\.nora\/?/.test(gi) ? ".nora/ を除外" : ".nora/ 行なし — 新規雛形で追加",
        "旧 .nora/session.json は AppData に移行済み"
      )
    );
  }

  const meta = getNoraOpsRepoMeta(workspaceRoot);
  if (meta) {
    checks.push(check("gitea_binding", "Gitea 保存先（キャッシュ）", true, meta.fullName));
    const gid = normalizeGiteaRepoId(session?.giteaRepoId);
    if (gid) {
      const reg = await fetchRegistryByGiteaId(gid);
      checks.push(
        check(
          "gitea_repo_id",
          "giteaRepoId 整合",
          reg?.found && reg.appId === (readNoraManifest(root)?.appId || session?.appId),
          reg?.found
            ? `id=${gid} → ${reg.fullName}`
            : `PC: id=${gid}（サーバー未登録 — 初回 save で backfill）`,
          reg?.found && reg.fullName !== meta.fullName ? "リネーム検知 — セッション更新済みのはず" : ""
        )
      );
    } else {
      checks.push(
        check(
          "gitea_repo_id",
          "giteaRepoId",
          true,
          "未記録（次回 save / provision で付与）",
          "owner/name のみの旧セッションでも save 可能"
        )
      );
    }
  } else if (profile !== MODES.VENV_ONLY) {
    checks.push(
      check(
        "gitea_binding",
        "Gitea 保存先",
        true,
        "未紐づけ（初回保存で provision）",
        "venv-only 以外は保存タブから新規登録"
      )
    );
  }

  const passed = checks.filter((c) => c.ok).length;
  return {
    ok: passed === checks.length,
    passed,
    total: checks.length,
    checks,
    scope: "workspace-design",
  };
}

module.exports = { runWorkspaceDesignChecks, pyprojectRel };
