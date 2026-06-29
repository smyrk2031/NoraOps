/**
 * NoraOps 主要機能スモークチェック（GUI 用）。
 * 開発者向け npm test / pytest とは別 — 本番運用中の接続確認向け。
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { getNoraOpsConfig } = require("./config");
const { requestJson } = require("./noraopsApi");

function check(id, name, ok, detail = "", hint = "") {
  return { id, name, ok, detail, hint };
}

function dirSizeMb(dirPath) {
  if (!fs.existsSync(dirPath)) return 0;
  let total = 0;
  const stack = [dirPath];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(full);
      else {
        try {
          total += fs.statSync(full).size;
        } catch {
          /* ignore */
        }
      }
    }
  }
  return (total / 1048576).toFixed(1);
}

async function runClientHealthCheck() {
  const cfg = getNoraOpsConfig();
  const checks = [];

  checks.push(
    check(
      "cfg_server",
      "noraops.server.baseUrl",
      !!cfg.serverBaseUrl,
      cfg.serverBaseUrl || "未設定"
    )
  );

  if (!cfg.serverBaseUrl) {
    return { ok: false, passed: 0, total: checks.length, checks, component: "noraops4code" };
  }

  const base = cfg.serverBaseUrl.replace(/\/$/, "");

  try {
    const health = await requestJson("GET", `${base}/api/v1/portal/health`);
    checks.push(
      check(
        "portal_health",
        "FastAPI（ポータル API）",
        health.status === 200,
        `HTTP ${health.status}`
      )
    );
  } catch (e) {
    checks.push(check("portal_health", "FastAPI（ポータル API）", false, e.message));
  }

  try {
    const rules = await requestJson("GET", `${base}/api/v1/checks/rules`);
    checks.push(
      check("checks_rules", "チェックルール配布", rules.status === 200, `HTTP ${rules.status}`)
    );
  } catch (e) {
    checks.push(check("checks_rules", "チェックルール配布", false, e.message));
  }

  try {
    const gitea = await requestJson("GET", `${base}/api/v1/noraops/client/gitea-status`);
    const ok = gitea.status === 200 && gitea.json?.userReachable;
    checks.push(
      check(
        "gitea_status",
        "Gitea 接続（サーバー経由）",
        ok,
        gitea.json?.login || gitea.json?.createRepoError || `HTTP ${gitea.status}`,
        gitea.json?.createRepoHint || ""
      )
    );
  } catch (e) {
    checks.push(check("gitea_status", "Gitea 接続（サーバー経由）", false, e.message));
  }

  try {
    const { fetchToolsStatus } = require("./toolInstaller");
    const st = await fetchToolsStatus();
    checks.push(
      check(
        "tools_uv",
        "uv ツール",
        st.uv?.installed,
        st.uv?.installed ? st.uv.version || "導入済み" : "未導入 — ツールをセットアップ"
      )
    );
  } catch (e) {
    checks.push(check("tools_uv", "uv ツール", false, e.message));
  }

  try {
    const { getAuthHeaders } = require("./authHeaders");
    const headers = await getAuthHeaders();
    const sess = await requestJson(
      "POST",
      `${base}/api/v1/noraops/push/sessions`,
      { device_label: "health-check", scope: "write" },
      headers
    );
    checks.push(
      check(
        "session_write",
        "保存用セッション",
        sess.status === 200 && !!sess.json?.pushToken,
        sess.status === 200 ? "発行 OK" : `HTTP ${sess.status}`
      )
    );
  } catch (e) {
    checks.push(check("session_write", "保存用セッション", false, e.message));
  }

  try {
    const cat = await requestJson("GET", `${base}/api/v1/portal/catalog/published`);
    checks.push(
      check(
        "catalog",
        "Runner カタログ API",
        cat.status === 200,
        cat.status === 200 ? `${cat.json?.count ?? 0} 件` : `HTTP ${cat.status}`
      )
    );
  } catch (e) {
    checks.push(check("catalog", "Runner カタログ API", false, e.message));
  }

  try {
    const diag = await requestJson("GET", `${base}/api/v1/noraops/diagnostics/run`);
    if (diag.status === 200 && diag.json?.checks) {
      for (const c of diag.json.checks) {
        checks.push(
          check(`srv_${c.id}`, `[サーバー] ${c.name}`, c.ok, c.detail, c.hint || "")
        );
      }
    } else {
      checks.push(
        check("server_diag", "サーバー詳細診断", false, `HTTP ${diag.status}`)
      );
    }
  } catch (e) {
    checks.push(check("server_diag", "サーバー詳細診断", false, e.message));
  }

  try {
    const binding = await requestJson(
      "GET",
      `${base}/api/v1/noraops/apps/binding?app_id=nora.app.health-probe`
    );
    checks.push(
      check(
        "app_registry_api",
        "アプリ紐づけ API（giteaRepoId）",
        binding.status === 200 && binding.json?.found === false,
        binding.status === 200 ? "lookup OK（未登録 probe）" : `HTTP ${binding.status}`,
        "Phase 4: binding?gitea_repo_id= も利用可"
      )
    );
  } catch (e) {
    checks.push(check("app_registry_api", "アプリ紐づけ API", false, e.message));
  }

  let workspaceRoot = null;
  try {
    const vscode = require("vscode");
    workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || null;
  } catch {
    /* headless test */
  }
  if (workspaceRoot) {
    try {
      const { runWorkspaceDesignChecks } = require("./workspaceDesignCheck");
      const ws = await runWorkspaceDesignChecks(workspaceRoot);
      for (const c of ws.checks) {
        checks.push(
          check(`ws_${c.id}`, `[ワークスペース] ${c.name}`, c.ok, c.detail, c.hint || "")
        );
      }
    } catch (e) {
      checks.push(check("ws_design", "ワークスペース設計チェック", false, e.message));
    }
  } else {
    checks.push(
      check(
        "ws_folder",
        "ワークスペース設計チェック",
        true,
        "スキップ（フォルダ未オープン）",
        "Creator でフォルダを開くと pyproject / giteaRepoId 等を確認"
      )
    );
  }

  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  const noraRoot = path.join(local, "NoraOps");
  const venvs = path.join(noraRoot, "venvs");
  const runner = path.join(noraRoot, "runner-apps");
  checks.push(
    check(
      "local_storage",
      "ローカルキャッシュ",
      true,
      `venvs ${dirSizeMb(venvs)} MB · runner-apps ${dirSizeMb(runner)} MB`,
      "「ストレージ管理」は今後の UX 改善で GUI 化予定"
    )
  );

  const passed = checks.filter((c) => c.ok).length;
  return {
    ok: passed === checks.length,
    passed,
    total: checks.length,
    checks,
    component: "noraops4code",
  };
}

function formatHealthReport(result) {
  const lines = [
    `NoraOps 動作確認: ${result.passed} / ${result.total} OK`,
    "",
  ];
  for (const c of result.checks) {
    lines.push(`${c.ok ? "✓" : "✗"} ${c.name}: ${c.detail}`);
    if (c.hint) lines.push(`    → ${c.hint}`);
  }
  return lines.join("\n");
}

module.exports = { runClientHealthCheck, formatHealthReport };
