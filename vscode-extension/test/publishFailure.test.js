const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { describePublishFailureDetail } = require("../src/noraops/publishFailureDetail");

describe("describePublishFailureDetail", () => {
  it("returns null when publish skipped or ok", () => {
    assert.equal(describePublishFailureDetail({ ok: true }, { ok: true }), null);
    assert.equal(describePublishFailureDetail({ skipped: true }, { ok: true }), null);
    assert.equal(describePublishFailureDetail(null, { ok: true }), null);
  });

  it("describes partial failure with push fullName", () => {
    const detail = describePublishFailureDetail(
      { ok: false, error: "v1.0.0 は既に公開済みです。" },
      { ok: true, fullName: "alice/demo" }
    );
    assert.ok(detail);
    assert.match(detail.title, /公開に失敗/);
    assert.match(detail.body, /Gitea（alice\/demo）への保存は完了/);
    assert.match(detail.body, /既に公開済み/);
    assert.ok(detail.steps.length >= 2);
  });

  it("handles security_warn_unreviewed separately", () => {
    const detail = describePublishFailureDetail(
      {
        ok: false,
        reason: "security_warn_unreviewed",
        message: "未確認の警告が 2 件あります。",
      },
      { ok: true }
    );
    assert.ok(detail);
    assert.match(detail.title, /未実施/);
    assert.match(detail.body, /未確認の警告/);
  });
});
