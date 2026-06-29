const vscode = require("vscode");
const { requestJson } = require("./noraopsApi");
const { getNoraOpsConfig } = require("./config");

const EXAMPLE_PROBLEM =
  "例: 部品在庫の入出庫を記録し、不足時にアラートを出したい";
const EXAMPLE_INPUT = "例: Excel/CSV の入庫・出庫データ、品番・数量・日付";
const EXAMPLE_OUTPUT = "例: 在庫一覧画面、不足品目の一覧、CSV エクスポート";

async function runConciergeWizard() {
  const problem = await vscode.window.showInputBox({
    title: "NoraOps コンシェルジュ (1/3)",
    prompt: "解決したいことは何ですか？",
    placeHolder: EXAMPLE_PROBLEM,
    ignoreFocusOut: true,
  });
  if (problem === undefined) return null;
  if (!problem || problem.trim().length < 3) {
    vscode.window.showWarningMessage("3 文字以上で入力してください。");
    return null;
  }

  const inputDesc = await vscode.window.showInputBox({
    title: "NoraOps コンシェルジュ (2/3)",
    prompt: "入力データのイメージは？",
    placeHolder: EXAMPLE_INPUT,
    ignoreFocusOut: true,
  });
  if (inputDesc === undefined) return null;

  const outputDesc = await vscode.window.showInputBox({
    title: "NoraOps コンシェルジュ (3/3)",
    prompt: "出力・画面のイメージは？",
    placeHolder: EXAMPLE_OUTPUT,
    ignoreFocusOut: true,
  });
  if (outputDesc === undefined) return null;

  return analyzeConcierge(problem.trim(), inputDesc.trim(), outputDesc.trim());
}

function fillConciergeTemplate(template, vars) {
  if (!template || !vars) return null;
  let s = String(template);
  for (const [k, v] of Object.entries(vars)) {
    const re = new RegExp(`{{\\s*${k}\\s*}}`, "g");
    s = s.replace(re, String(v ?? ""));
  }
  return s;
}

async function fetchConciergePromptTemplate() {
  const { serverBaseUrl } = getNoraOpsConfig();
  const { status, json } = await requestJson(
    "GET",
    `${serverBaseUrl}/api/v1/noraops/concierge/prompt-template`
  );
  if (status !== 200) {
    throw new Error(`prompt-template HTTP ${status}`);
  }
  return json;
}

async function analyzeConcierge(problem, inputDesc, outputDesc) {
  const { serverBaseUrl } = getNoraOpsConfig();
  const { status, json } = await requestJson(
    "POST",
    `${serverBaseUrl}/api/v1/noraops/concierge/analyze`,
    {
      problem,
      input_desc: inputDesc,
      output_desc: outputDesc,
    }
  );
  if (status >= 400) {
    const d = json?.detail;
    const msg =
      typeof d === "string"
        ? d
        : Array.isArray(d)
          ? d.map((x) => x.msg || JSON.stringify(x)).join("; ")
          : `HTTP ${status}`;
    throw new Error(msg);
  }
  const base = { ...json, problem, inputDesc, outputDesc };
  let copilotPrompt = json.copilotPrompt || "";
  try {
    const tmpl = await fetchConciergePromptTemplate();
    if (tmpl?.template && json.promptVariables) {
      const filled = fillConciergeTemplate(tmpl.template, json.promptVariables);
      if (filled && filled.trim()) {
        copilotPrompt = filled;
      }
    }
  } catch {
    /* テンプレ取得失敗時は analyze の copilotPrompt のまま */
  }
  return { ...base, copilotPrompt };
}

async function showConciergeResult(result) {
  const doc = await vscode.workspace.openTextDocument({
    content: result.copilotPrompt || "",
    language: "markdown",
  });
  await vscode.window.showTextDocument(doc, { preview: true });

  const actions = ["プロンプトをコピー", "閉じる"];
  if (result.recommendExisting && result.matches?.length) {
    actions.unshift("類似リポを確認");
  }
  const pick = await vscode.window.showInformationMessage(
    result.summary || "コンシェルジュ結果",
    { modal: true, detail: result.recommendExisting ? "既存アプリの改良を検討してください。" : "新規作成向けの Copilot プロンプトを表示しました。" },
    ...actions
  );
  if (pick === "プロンプトをコピー") {
    await vscode.env.clipboard.writeText(result.copilotPrompt || "");
    vscode.window.showInformationMessage(
      "Copilot 用プロンプトをコピーしました。GitHub Copilot Chat（Agent モード）に貼り付けてください。"
    );
  }
  return result;
}

async function runConciergeWithUi() {
  try {
    const result = await runConciergeWizard();
    if (!result) return null;
    await showConciergeResult(result);
    return result;
  } catch (e) {
    vscode.window.showErrorMessage(`コンシェルジュ: ${e.message}`);
    return null;
  }
}

module.exports = {
  runConciergeWizard,
  analyzeConcierge,
  runConciergeWithUi,
  fillConciergeTemplate,
  fetchConciergePromptTemplate,
  EXAMPLE_PROBLEM,
  EXAMPLE_INPUT,
  EXAMPLE_OUTPUT,
};
