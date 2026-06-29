/** F5 / ターミナル実行ガードのブロック判定（vscode 非依存・テスト可） */

function shouldBlockExecution(summary) {
  return (summary?.secErrors?.length || 0) > 0;
}

module.exports = { shouldBlockExecution };
