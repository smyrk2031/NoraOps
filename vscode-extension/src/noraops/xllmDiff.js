/**
 * xLLM — 適用前 diff 表示用（簡易行 diff）
 */

/**
 * @returns {{ type: 'same'|'add'|'del'|'change', oldLine?: string, newLine?: string }[]}
 */
function buildLineDiff(oldText, newText) {
  const a = String(oldText ?? "").split(/\r?\n/);
  const b = String(newText ?? "").split(/\r?\n/);
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      ops.push({ type: "same", oldLine: a[i], newLine: b[j] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: "del", oldLine: a[i] });
      i++;
    } else {
      ops.push({ type: "add", newLine: b[j] });
      j++;
    }
  }
  while (i < m) {
    ops.push({ type: "del", oldLine: a[i++] });
  }
  while (j < n) {
    ops.push({ type: "add", newLine: b[j++] });
  }
  return ops;
}

function summarizeDiff(ops) {
  let add = 0;
  let del = 0;
  for (const o of ops) {
    if (o.type === "add") add++;
    if (o.type === "del") del++;
  }
  return { add, del, same: ops.filter((o) => o.type === "same").length };
}

function formatDiffForDisplay(ops, limit = 400) {
  const lines = [];
  let count = 0;
  for (const o of ops) {
    if (count >= limit) {
      lines.push("…（差分が長いため省略）");
      break;
    }
    if (o.type === "same") {
      lines.push("  " + (o.oldLine ?? ""));
    } else if (o.type === "del") {
      lines.push("- " + (o.oldLine ?? ""));
    } else if (o.type === "add") {
      lines.push("+ " + (o.newLine ?? ""));
    }
    count++;
  }
  return lines.join("\n");
}

module.exports = {
  buildLineDiff,
  summarizeDiff,
  formatDiffForDisplay,
};
