/**
 * 保存成功・公開失敗時の UI 用メッセージ（vscode 非依存・テスト可）。
 * @returns {{ kind: string, title: string, body: string, steps: string[] } | null}
 */
function describePublishFailureDetail(publish, push) {
  if (!publish || publish.ok || publish.skipped) return null;

  const fullName = push?.fullName || "";
  const cloudLine = fullName
    ? `Gitea（${fullName}）への保存は完了しています。`
    : "クラウドへの保存は完了しています。";
  const err = String(publish.error || publish.message || publish.reason || "原因不明のエラー");

  if (publish.reason === "security_warn_unreviewed") {
    return {
      kind: "warn",
      title: "Runner 公開は未実施です",
      body: `${cloudLine}\n\n${publish.message || "セキュリティ警告の確認が必要です。"}`,
      steps: [
        "ホームの「セキュリティ」から警告を確認してください",
        "確認後、もう一度「Runner に公開」にチェックして保存してください",
      ],
    };
  }

  const steps = [
    "版番号を上げて、もう一度「Runner に公開」にチェックして保存してください",
    "README・pyproject.toml・nora/manifest.json など公開前チェックを満たしているか確認してください",
    "続く場合は管理者に連絡してください",
  ];
  if (/既に公開済み|already published|パッチ以上/i.test(err)) {
    steps[0] = "版番号をパッチ以上に上げて、再度「保存 + 公開」を実行してください";
  }
  if (/artifact|zip|clone/i.test(err)) {
    steps.unshift("Gitea 上でリポジトリと tag が正しく付いているか確認してください");
  }

  return {
    kind: "warn",
    title: "Runner への公開に失敗しました",
    body: `${cloudLine}\n\n公開エラー: ${err}`,
    steps,
  };
}

module.exports = { describePublishFailureDetail };
