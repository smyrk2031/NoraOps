const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const STATE_SCHEMA = "nora.security-warn-state/1";

const {
  readSecurityWarnStateRecord,
  writeSecurityWarnStateRecord,
} = require("./workspaceStore");

function readState(workspaceRoot) {
  return readSecurityWarnStateRecord(workspaceRoot);
}

function writeState(workspaceRoot, state) {
  writeSecurityWarnStateRecord(workspaceRoot, state);
}

function fingerprint(finding) {
  const raw = [
    finding.ruleId || "",
    finding.file || "",
    String(finding.line || 0),
    (finding.snippet || "").trim(),
  ].join("|");
  return crypto.createHash("sha256").update(raw, "utf8").digest("hex").slice(0, 24);
}

function enrichFindings(findings) {
  return (findings || []).map((f) => ({ ...f, fp: fingerprint(f) }));
}

/** 抑制・確認済みを除いたセキュリティ warn */
function getActiveSecWarns(workspaceRoot, summary) {
  const state = readState(workspaceRoot);
  const skip = new Set([...(state.suppressed || []), ...(state.reviewed || [])]);
  const warns = summary?.secWarns || [];
  return enrichFindings(warns).filter((f) => !skip.has(f.fp));
}

/** Runner 公開をブロックする未処理 warn */
function getActivePublishBlockingWarns(workspaceRoot, summary) {
  return getActiveSecWarns(workspaceRoot, summary).filter((f) => f.blocksPublish);
}

function suppressFingerprints(workspaceRoot, fps) {
  const state = readState(workspaceRoot);
  const set = new Set(state.suppressed || []);
  for (const fp of fps || []) set.add(fp);
  state.suppressed = [...set];
  writeState(workspaceRoot, state);
}

function markReviewed(workspaceRoot, fps) {
  const state = readState(workspaceRoot);
  const rev = new Set(state.reviewed || []);
  const sup = new Set(state.suppressed || []);
  for (const fp of fps || []) {
    rev.add(fp);
    sup.delete(fp);
  }
  state.reviewed = [...rev];
  state.suppressed = [...sup];
  writeState(workspaceRoot, state);
}

function canPublishToRunner(workspaceRoot, summary) {
  return getActivePublishBlockingWarns(workspaceRoot, summary).length === 0;
}

function publishBlockMessage(workspaceRoot, summary) {
  const pending = getActivePublishBlockingWarns(workspaceRoot, summary);
  if (!pending.length) return "";
  const lines = pending.slice(0, 5).map((f) => `・${f.file}:${f.line} ${f.message}`);
  if (pending.length > 5) lines.push(`…他 ${pending.length - 5} 件`);
  return (
    `Runner 公開（nora-published）は、セキュリティ警告を確認するまでできません（${pending.length} 件）。\n` +
    "「セキュリティ警告を確認」で各項目を開き、チェックまたは「次回から警告しない」を付けてください。\n\n" +
    lines.join("\n")
  );
}

module.exports = {
  fingerprint,
  enrichFindings,
  getActiveSecWarns,
  getActivePublishBlockingWarns,
  canPublishToRunner,
  publishBlockMessage,
  suppressFingerprints,
  markReviewed,
  readState,
};
