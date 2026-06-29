/**
 * xLLM — ポリシー／セキュリティチェック結果をプロンプト用に短く整形
 */

const MAX_NOTICE_ITEMS = 8;

/**
 * @param {import("./checkRunner").CheckSummary | null | undefined} summary
 */
function buildCheckNoticeForPrompt(summary) {
  if (!summary) {
    return { text: "", hasIssues: false, secErrors: 0, polErrors: 0, warnCount: 0 };
  }
  const sec = summary.secErrors || [];
  const pol = summary.polErrors || [];
  const secWarns = (summary.secWarns || []).slice(0, 3);
  if (!sec.length && !pol.length && !secWarns.length) {
    return { text: "", hasIssues: false, secErrors: 0, polErrors: 0, warnCount: 0 };
  }

  const lines = [`## チェック結果（送信前・要確認）`, ``];
  const items = [
    ...sec.map((f) => `- [セキュリティ] ${loc(f)} — ${trimMsg(f.message)}`),
    ...pol.map((f) => `- [ポリシー] ${loc(f)} — ${trimMsg(f.message)}`),
    ...secWarns.map((f) => `- [警告] ${loc(f)} — ${trimMsg(f.message)}`),
  ];
  const total = items.length;
  for (const line of items.slice(0, MAX_NOTICE_ITEMS)) {
    lines.push(line);
  }
  if (total > MAX_NOTICE_ITEMS) {
    lines.push(`- …他 ${total - MAX_NOTICE_ITEMS} 件（VS Code の Problems で確認）`);
  }
  lines.push(
    ``,
    `**注意**: 秘密情報・IP 直書き等は外部 AI に送らない／出力に含めない。上記があれば修正を優先。`
  );
  return {
    text: lines.join("\n"),
    hasIssues: true,
    secErrors: sec.length,
    polErrors: pol.length,
    warnCount: secWarns.length,
  };
}

function loc(f) {
  const file = f.file || f.ruleId || "—";
  if (f.line > 0) return `${file}:${f.line}`;
  return file;
}

function trimMsg(msg) {
  const s = String(msg || "").trim();
  return s.length > 120 ? `${s.slice(0, 117)}…` : s;
}

function buildCheckNoticeForUi(notice) {
  if (!notice?.hasIssues) return "";
  const parts = [];
  if (notice.secErrors) parts.push(`セキュリティ ${notice.secErrors}`);
  if (notice.polErrors) parts.push(`ポリシー ${notice.polErrors}`);
  if (notice.warnCount) parts.push(`警告 ${notice.warnCount}`);
  return parts.join(" · ");
}

module.exports = {
  buildCheckNoticeForPrompt,
  buildCheckNoticeForUi,
  MAX_NOTICE_ITEMS,
};
