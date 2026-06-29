const vscode = require("vscode");
const { requestJson } = require("./noraopsApi");
const { getNoraOpsConfig } = require("./config");
const { compareSemver } = require("../toolManager");

const DEFAULT_COPILOT_MIN = "1.122.0";

async function fetchAiClientFeatures() {
  const { serverBaseUrl } = getNoraOpsConfig();
  try {
    const { status, json } = await requestJson("GET", `${serverBaseUrl}/api/v1/noraops/ai/status`);
    if (status !== 200) return null;
    return json;
  } catch {
    return null;
  }
}

function availableProviders(status) {
  const features = status?.features || {};
  const copilotMin = status.copilotMinHostVersion || DEFAULT_COPILOT_MIN;
  const copilotOk = !!features.copilot && compareSemver(vscode.version, copilotMin) >= 0;
  return { copilotOk, copilotMin };
}

function resolveAiProvider(status) {
  if (!status?.enabled) return null;
  const { copilotOk } = availableProviders(status);
  if (copilotOk) return "copilot";
  return null;
}

async function chooseAiProvider(status, options = {}) {
  if (options.forceProvider === "copilot") return "copilot";
  if (options.skipProviderPick) return resolveAiProvider(status, vscode.version);

  const { copilotOk, copilotMin } = availableProviders(status);
  if (copilotOk) return "copilot";

  if (status?.features?.copilot && compareSemver(vscode.version, copilotMin) < 0) {
    return null;
  }

  const pick = await vscode.window.showQuickPick(
    [
      {
        label: "$(book) 手順を Web で見る",
        description: "コピペ用設定ファイルの全文",
        value: "help",
      },
    ],
    {
      title: "セキュア AI — 接続方法",
      placeHolder: "Copilot BYOK が利用できません。Web 手順を参照してください。",
    }
  );
  if (!pick) return null;
  if (pick.value === "help") {
    const { openAiSetupHelp } = require("./aiSetupGuide");
    await openAiSetupHelp();
  }
  return null;
}

function modalPayload(kind, title, body, extra = {}) {
  return { ok: false, modal: { kind, title, body, offerHelp: true, ...extra } };
}

async function runAiAssistSetup(context, workspaceRoot, options = {}) {
  const status = await fetchAiClientFeatures();
  if (!status?.enabled) {
    return modalPayload(
      "warn",
      "セキュア AI は使えません",
      "サーバーで AI が無効です。管理者に CMS → AI 中継 を ON にしてもらってください。\n\n" +
        "※ 契約済み Copilot の方はプロンプトをコピーして Copilot に貼り付けてください。\n\n" +
        "⚠ 個人の無料 Copilot や機密保持のない外部 AI への社内データ送信は禁止です。",
      { steps: ["CMS で AI 中継を ON", "Azure .env を管理者が設定", "下の「手順を見る」で詳細確認"] }
    );
  }

  const { detectPersonalGithubCopilotRisk } = require("./copilotByokCheck");
  const risk = await detectPersonalGithubCopilotRisk();
  if (risk.risk && options.allowPersonalCopilot !== true) {
    return modalPayload(
      "danger",
      "個人 Copilot が検出されました",
      `${risk.message}\n\n組織のセキュア AI（Copilot BYOK）を使うか、契約済み Copilot をそのままご利用ください。`
    );
  }

  const provider = await chooseAiProvider(status, options);
  const { copilotOk, copilotMin } = availableProviders(status);

  if (!provider && status?.features?.copilot && compareSemver(vscode.version, copilotMin) < 0) {
    return modalPayload(
      "warn",
      "VS Code の更新が必要です",
      `GitHub Copilot BYOK には VS Code ${copilotMin} 以上が必要です（現在 ${vscode.version}）。\n\nVS Code を更新するか、Web 手順を参照してください。`
    );
  }

  if (!provider) {
    return modalPayload(
      "warn",
      "セキュア AI を開始できません",
      "利用可能な AI 連携がありません。サーバー設定（Copilot BYOK）を確認してください。",
      { steps: ["CMS → AI 中継で Copilot を ON", "「手順を見る」で手動セットアップ"] }
    );
  }

  const { installCopilotExtensions, applyByokSettingsFromServer } = require("./copilotByokSetup");
  const { getCopilotExtensionStatus } = require("./copilotByokCheck");
  if (!getCopilotExtensionStatus().ok) {
    const inst = await installCopilotExtensions();
    if (!inst.ok) {
      return modalPayload(
        "warn",
        "Copilot 拡張",
        "Copilot 拡張のインストールに失敗しました。Marketplace から手動で追加するか、Web 手順を参照してください。",
        { steps: ["GitHub.copilot", "GitHub.copilot-chat をインストール", "手順ページの settings.json を反映"] }
      );
    }
  }
  const applied = await applyByokSettingsFromServer({ silentConfirm: true });
  if (applied?.disabled || applied?.notConfigured) {
    return modalPayload(
      "warn",
      "BYOK 未設定",
      "サーバー側の Azure OpenAI 設定が未完了です。管理者に .env を確認してもらってください。"
    );
  }
  try {
    await vscode.commands.executeCommand("workbench.action.chat.open");
  } catch {
    try {
      await vscode.commands.executeCommand("github.copilot.chat.focus");
    } catch {
      return modalPayload(
        "warn",
        "チャットを開けません",
        "Copilot Chat を手動で開き、クリップボードのプロンプトを貼り付けてください。settings.json の反映は完了しています。",
        { steps: ["Copilot Chat を手動で開く", "Azure API キーを Copilot 設定で入力（未入力の場合）", "プロンプトを貼り付け"] }
      );
    }
  }
  return {
    ok: true,
    provider: "copilot",
    notice: {
      kind: "ok",
      title: "Copilot BYOK を設定しました",
      body:
        "endpoint / deployment を settings.json に反映済みです。\n\n" +
        "Azure API キーが未設定の場合は Copilot 設定で組織手順に従って入力してください。\n\n" +
        "うまくいかない場合は「手順を見る」から Web ページのコピペ手順を参照してください。",
      offerHelp: true,
    },
  };
}

module.exports = {
  fetchAiClientFeatures,
  resolveAiProvider,
  chooseAiProvider,
  runAiAssistSetup,
};
