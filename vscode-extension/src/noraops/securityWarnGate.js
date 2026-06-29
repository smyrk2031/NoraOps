const vscode = require("vscode");
const { openSecurityWarnReview } = require("./securityWarnReview");
const {
  getActiveSecWarns,
  canPublishToRunner,
  publishBlockMessage,
} = require("./securityWarnStore");

const { coalesceRunPrompt } = require("./runPromptCoalesce");

/**
 * F5 前: 救済ホワイトリスト IP は毎回警告（ブロックしない・抑制不可）。
 */
async function promptReliefIpWarnsBeforeRun(summary) {
  const relief = (summary?.findings || []).filter(
    (f) => f.category === "security" && f.userReliefWhitelist === true
  );
  if (!relief.length) return;

  const ips = [...new Set(relief.map((f) => f.matchedIp).filter(Boolean))];
  const locs = relief.slice(0, 6).map((f) => {
    const loc = f.file ? `${f.file}:${f.line || "?"}` : "（コード内）";
    return `・${loc} — ${f.matchedIp || ""}`;
  });
  if (relief.length > 6) locs.push(`…他 ${relief.length - 6} か所`);

  await vscode.window.showWarningMessage(
    `救済ホワイトリスト登録済みの IP 直書きが ${relief.length} か所あります。F5 は続行できます。`,
    {
      modal: true,
      detail:
        `登録 IP: ${ips.join(", ")}\n\n` +
        "万が一の直書き用の救済措置です。可能ならホスト名や環境変数へ移行してください。\n\n" +
        locs.join("\n"),
    },
    "問題を開く",
    "そのまま実行"
  ).then((pick) => {
    if (pick === "問題を開く") {
      return vscode.commands.executeCommand("workbench.actions.view.problems");
    }
    return undefined;
  });
}

/**
 * F5 前: IP 以外の warn があれば確認を促す（ブロックしない）。
 * resolveDebugConfiguration 等から複数回呼ばれてもダイアログは1回だけ。
 * @returns {Promise<boolean>} true = 続行可
 */
async function promptSecWarnsBeforeRun(workspaceRoot, summary) {
  if (!workspaceRoot) return true;
  const key = `run-warn:${workspaceRoot}`;
  await coalesceRunPrompt(key, async () => {
    await promptReliefIpWarnsBeforeRun(summary);

    const active = getActiveSecWarns(workspaceRoot, summary).filter((f) => !f.userReliefWhitelist);
    if (!active.length) return;

    const pick = await vscode.window.showWarningMessage(
      `セキュリティ警告が ${active.length} 件あります（パスワード・メール・トークン等）。確認しますか？`,
      { modal: true },
      "確認する",
      "そのまま実行"
    );
    if (pick === "確認する") {
      await openSecurityWarnReview(workspaceRoot, summary, { mode: "run" });
    }
  });
  return true;
}

async function blockPublishIfNeeded(workspaceRoot, summary) {
  if (canPublishToRunner(workspaceRoot, summary)) {
    return { ok: true };
  }
  const msg = publishBlockMessage(workspaceRoot, summary);
  const pick = await vscode.window.showErrorMessage(
    "Runner 公開できません",
    { modal: true, detail: msg },
    "警告を確認",
    "閉じる"
  );
  if (pick === "警告を確認") {
    await openSecurityWarnReview(workspaceRoot, summary, { mode: "publish" });
  }
  return { ok: false, reason: "security_warn_unreviewed", message: msg };
}

module.exports = {
  coalesceRunPrompt,
  promptReliefIpWarnsBeforeRun,
  promptSecWarnsBeforeRun,
  blockPublishIfNeeded,
  canPublishToRunner,
  publishBlockMessage,
};
