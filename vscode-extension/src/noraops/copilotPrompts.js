const path = require("path");
const { readWorkspaceSession } = require("./pathsMeta");

/**
 * Copilot / Cursor 等に貼り付けるプロンプト（pyproject 未作成時）
 */
function buildPyprojectPrompt(workspaceRoot) {
  const folderName = path.basename(workspaceRoot);
  const session = readWorkspaceSession(workspaceRoot);
  const displayName = session?.displayName || folderName;
  const { packageNameSlug } = require("./pathsMeta");
  const appSlug = packageNameSlug(session?.appId?.replace(/^nora\.app\./, "") || folderName);

  return `NoraOps で Python アプリを続けたいです。まだ pyproject.toml がありません。
次のファイルを **新規作成** してください（既存ファイルがあれば上書きしないで確認してから）。

## 作成してほしいもの

1. **nora/packages/pyproject.toml**（uv 形式・正本）
   - name: "${appSlug}"
   - version: "0.1.0"
   - description: "${displayName}"
   - requires-python: ">=3.11"
   - dependencies: []（空で可）
   - [tool.uv] package = false
   - readme は "../../README.md" を参照

2. **nora/packages/main.py**（最小サンプル）
   - \`def main()\` と \`if __name__ == "__main__"\` で print 1 行

3. （任意）**nora/packages/requirements.txt**
   - コメントで「正本は pyproject.toml」と書いておく

## ルール

- ホストには **IP アドレスを直書きしない**（127.0.0.1 以外は環境変数や設定ファイルで）
- パスワードや API キーをコードに直書きしない

作成後、ユーザーは NoraOps の「Python 環境を用意する」で uv sync します。`;
}

function buildRequirementsPrompt(workspaceRoot) {
  return `nora/packages/pyproject.toml の dependencies を更新したあと、
同じフォルダの requirements.txt を pyproject と整合する形で作り直してください（uv 利用前提）。`;
}

module.exports = { buildPyprojectPrompt, buildRequirementsPrompt };
