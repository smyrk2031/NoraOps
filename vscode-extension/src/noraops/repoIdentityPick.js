const vscode = require("vscode");

/**
 * 新規リポ作成時に「同じアプリのコピー」か「別アプリ」かをユーザー向けに選ばせる。
 * @returns {Promise<"same-app"|"new-app"|null>}
 */
async function pickNewRepoIdentity() {
  const pick = await vscode.window.showQuickPick(
    [
      {
        label: "$(copy) バックアップ用に別名でコピーを作る",
        description: "今のアプリの続き・別案・チーム別コピー向け",
        detail:
          "中身は同じアプリのまま、Gitea 上の別リポジトリ名で保存します。公開（Runner）はリポごとに別管理になります。",
        id: "same-app",
      },
      {
        label: "$(add) まったく新しいアプリとして作る",
        description: "別プロジェクト・元を切り離す向け",
        detail:
          "新しいアプリ ID を発行し、別アプリとしてクラウドに登録します。元のリポとは無関係になります。",
        id: "new-app",
      },
    ],
    {
      title: "新規リポジトリ — どちらを選びますか？",
      placeHolder: "用途に近い方を選んでください",
      matchOnDescription: true,
      matchOnDetail: true,
    }
  );
  return pick?.id || null;
}

module.exports = { pickNewRepoIdentity };
