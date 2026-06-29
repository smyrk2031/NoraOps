const fs = require("fs");
const path = require("path");

const MOCK_PLACEHOLDER_MARKER = "NORAOPS_MOCK_PLACEHOLDER";
const MOCK_INDEX_REL = "nora/mock/index.html";
const MOCK_SPEC_REL = "nora/mock/spec.json";

const MOCK_SAMPLE_CATEGORIES = {
  office: { id: "office", label: "事務・オフィス", short: "事務", icon: "🏢", color: "#0d9488" },
  data: { id: "data", label: "データ・分析", short: "データ", icon: "📊", color: "#6366f1" },
  creative: { id: "creative", label: "クリエイティブ", short: "制作", icon: "🎨", color: "#a855f7" },
  utility: { id: "utility", label: "便利ツール", short: "ツール", icon: "🔧", color: "#d97706" },
};

const MOCK_EXAMPLES = [
  {
    id: "supplies",
    category: "office",
    icon: "📦",
    title: "備品管理",
    desc: "在庫・貸出・発注アラート",
    appTitle: "備品・消耗品管理",
    targetPlatform: "browser",
    operationSteps: `① ログインしてダッシュボードを開く
② 「備品一覧」で在庫数・保管場所を確認する
③ 検索欄で品名または管理番号を絞り込む
④ 「貸出登録」で備品・数量・借りる人・返却予定日を入力する
⑤ 「返却登録」で返却日を記録する
⑥ 在庫が発注点を下回った備品をアラート一覧で確認する
⑦ 「発注申請」を作成して承認待ち一覧に送る
⑧ 月次レポート（貸出履歴・コスト）を CSV 出力する`,
  },
  {
    id: "excel-merge",
    category: "office",
    icon: "📊",
    title: "Excel 統合",
    desc: "複数ブックを1つにまとめる",
    appTitle: "Excel ファイル統合ツール",
    targetPlatform: "browser",
    operationSteps: `① 「ファイル追加」で複数の Excel（.xlsx）を選択する
② 一覧でファイル名・シート数・行数のプレビューを確認する
③ 統合方式（縦結合 / 横結合 / シート別マージ）を選ぶ
④ キー列（例: 管理ID）を指定して重複行の扱い（残す・削除）を設定する
⑤ 列名の揺れ（例: 氏名 / 名前）をマッピング表で揃える
⑥ 「プレビュー実行」で統合結果の先頭100行を確認する
⑦ エラー行（型不一致・必須欠落）をエラーパネルで修正または除外する
⑧ 統合結果を新しい Excel ファイルとしてダウンロードする`,
  },
  {
    id: "file-rename",
    category: "utility",
    icon: "✏️",
    title: "ファイル名一括変換",
    desc: "フォルダ内の名前を規則で変更",
    appTitle: "ファイル名一括変換",
    targetPlatform: "tkinter",
    operationSteps: `① 対象フォルダを指定する（参照ボタンまたはパス入力）
② フォルダ内のファイル一覧（変更前名称）を表示する
③ 変換ルールを選ぶ（連番付与 / 日付プレフィックス / 文字列置換 / 正規表現）
④ ルールのプレビュー例（変更後名称）を一覧で確認する
⑤ 衝突（同名ファイル）がある行を警告表示する
⑥ 対象拡張子フィルタ（例: .jpg のみ）を設定する
⑦ 「ドライラン」で変更内容だけ確認する
⑧ 「実行」で一括リネームし、結果ログを保存する`,
  },
  {
    id: "expense",
    category: "office",
    icon: "🧾",
    title: "経費精算",
    desc: "申請・承認・集計",
    appTitle: "経費精算申請",
    targetPlatform: "browser",
    operationSteps: `① 新規申請を作成し、申請日・所属・目的を入力する
② 明細行を追加（日付・科目・金額・摘要・領収書添付）
③ 合計金額と税区分を自動計算して確認する
④ 承認ルート（上長→経理）をプレビューする
⑤ 「申請」ボタンで提出し、ステータスを「承認待ち」にする
⑥ 承認者画面で差戻し・承認・却下を操作する
⑦ 承認済み一覧から CSV / Excel を出力する
⑧ 月次集計ダッシュボードで科目別グラフを確認する`,
  },
  {
    id: "meeting-room",
    category: "office",
    icon: "🏛️",
    title: "会議室予約",
    desc: "空き確認・予約・キャンセル",
    appTitle: "会議室予約",
    targetPlatform: "browser",
    operationSteps: `① 日付を選び、会議室ごとのタイムライン（空き・予約済み）を表示する
② 空きスロットをクリックして予約モーダルを開く
③ 会議名・利用者・人数・設備（プロジェクター等）を入力する
④ 重複予約がないか確認して「予約確定」する
⑤ 自分の予約一覧から変更・延長・キャンセルする
⑥ 管理者は全予約を一覧し、強制キャンセルできる
⑦ 週次カレンダー表示に切り替える
⑧ 予約一覧を CSV 出力する`,
  },
  {
    id: "shift",
    category: "office",
    icon: "📅",
    title: "シフト表作成",
    desc: "担当割当・印刷用レイアウト",
    appTitle: "シフト表作成",
    targetPlatform: "browser",
    operationSteps: `① 対象月とチーム（例: 営業A班）を選ぶ
② メンバー一覧（利用者A 等）を登録・並べ替える
③ 日付×メンバーの表にシフト（早番・遅番・休）を入力する
④ セルをクリックしてシフト種別を切り替える
⑤ 1日あたりの必要人数と実配置人数の差分を警告表示する
⑥ テンプレート（前月コピー）を適用する
⑦ 印刷プレビュー（A4横）でレイアウトを確認する
⑧ PDF / Excel で出力する`,
  },
  {
    id: "doc-register",
    category: "office",
    icon: "📋",
    title: "文書登録・検索",
    desc: "社内文書の登録と全文検索",
    appTitle: "文書管理・検索",
    targetPlatform: "browser",
    operationSteps: `① 新規文書を登録（タイトル・分類・タグ・PDF 添付）
② 一覧で分類タブ（規程・マニュアル・議事録）を切り替える
③ キーワード検索でタイトル・タグ・概要を横断検索する
④ 検索結果から詳細画面を開き、プレビュー表示する
⑤ 版番号を更新して改訂履歴を残す
⑥ お気に入り登録してクイックアクセス一覧に追加する
⑦ 権限（公開範囲）を設定する
⑧ エクスポート（一覧 CSV）を実行する`,
  },
  {
    id: "data-analysis",
    category: "data",
    icon: "🔬",
    title: "データ解析",
    desc: "CSV 取込・集計・エクスポート",
    appTitle: "データ解析ワークベンチ",
    targetPlatform: "browser",
    operationSteps: `① プロジェクトを選ぶか新規作成する
② CSV / Excel ファイルをアップロードする
③ 列の型（数値・日付・文字）を確認・修正する
④ フィルタ条件を追加して対象行を絞り込む
⑤ 集計（合計・平均・グループ別）を実行する
⑥ 結果テーブルをソート・ページ送りで確認する
⑦ 解析結果に名前を付けて保存する
⑧ エクスポート（CSV / レポート PDF）を実行する`,
  },
  {
    id: "csv-chart",
    category: "data",
    icon: "📈",
    title: "CSV グラフ化",
    desc: "列選択でグラフ表示",
    appTitle: "CSV グラフビューア",
    targetPlatform: "browser",
    operationSteps: `① CSV ファイルを読み込む
② 列ヘッダーから X 軸・Y 軸に使う列を選ぶ
③ グラフ種別（棒・折れ線・円）を切り替える
④ 系列（複数列）を追加・削除する
⑤ 凡例・タイトル・軸ラベルを編集する
⑥ 期間フィルタで表示データを絞る
⑦ グラフ画像を PNG で保存する
⑧ 設定済みグラフ定義を JSON として保存する`,
  },
  {
    id: "dashboard",
    category: "data",
    icon: "📉",
    title: "分析ダッシュボード",
    desc: "KPI・ウィジェット・期間切替",
    appTitle: "分析ダッシュボード",
    targetPlatform: "browser",
    operationSteps: `① ダッシュボード一覧から開く（または新規作成）
② KPI カード（売上・件数・前年比）を確認する
③ 期間（日・週・月）を切り替える
④ 部門・拠点フィルタでドリルダウンする
⑤ 各ウィジェット（表・グラフ）をクリックして詳細モーダルを開く
⑥ アラート閾値を超えた指標をハイライト表示する
⑦ レイアウトを編集モードで並べ替える
⑧ PDF / 共有リンクでレポートを出力する`,
  },
  {
    id: "image-edit",
    category: "creative",
    icon: "🖼️",
    title: "画像編集",
    desc: "トリミング・調整・保存",
    appTitle: "簡易画像編集",
    targetPlatform: "tkinter",
    operationSteps: `① 画像ファイルを開く（ドラッグ＆ドrop またはファイル選択）
② プレビューで拡大・縮小・フィット表示を切り替える
③ トリミング範囲をドラッグで指定する
④ 明るさ・コントラスト・彩度をスライダーで調整する
⑤ 回転（90°）・左右反転を適用する
⑥ テキストラベルを画像上に配置する
⑦ 変更を「別名保存」する
⑧ 処理履歴から直前の操作を元に戻す`,
  },
  {
    id: "model-3d",
    category: "creative",
    icon: "🧊",
    title: "3D モデル確認",
    desc: "回転・断面・寸法表示",
    appTitle: "3D モデルビューア",
    targetPlatform: "browser",
    operationSteps: `① 3D ファイル（例: .obj / .stl）を読み込む
② ビューポートでマウスドラッグによりモデルを回転・パン・ズームする
③ 表示モード（ワイヤー / ソリッド / テクスチャ）を切り替える
④ 部品A・部品B ごとに色分け表示（パーツツリー）を選ぶ
⑤ 断面プレーンをスライダーで動かし、内部形状を確認する
⑥ 2点間の距離を計測し、寸法ラベルを表示する
⑦ スクリーンショットを PNG で保存する
⑧ カメラ視点（正面・上面・等角）をプリセットから切り替える`,
  },
];

const EXAMPLE_APP_TITLE = MOCK_EXAMPLES[0].appTitle;
const EXAMPLE_OPERATION_STEPS = MOCK_EXAMPLES[0].operationSteps;

const TARGET_PLATFORMS = [
  { id: "browser", label: "ブラウザアプリ風", short: "Web" },
  { id: "tkinter", label: "Windowsアプリ風", short: "Win" },
];

const TARGET_PLATFORM_BLOCKS = {
  browser: `## 最終実装の想定（UI の参考）
- 最終的には **ブラウザで動く Web アプリ** にします
- モックは HTML ですが、**モダンなブラウザアプリ**（ヘッダー・サイドバー・カード UI・テーブル）の雰囲気にしてください
- レスポンシブは必須ではありませんが、デスクトップブラウザを想定したレイアウトにしてください`,

  tkinter: `## 最終実装の想定（UI の参考）
- 最終的には **Windows 向けデスクトップアプリ（Python tkinter）** にします
- モックは HTML ですが、見た目は **Windows の実用ツール風** UI にしてください（グレー基調・標準的なボタン・リスト・メニューバー・ダイアログ風モーダル）
- Web 特有の豪華なグラデーションや SaaS 風デザインは避け、**Windows アプリっぽい実用寄り** に見えるようにしてください`,
};

const MOCK_SYSTEM_BLOCK = `## 出力形式（必須）
- **1 ファイルの HTML** として出力すること（ファイル名: \`index.html\`）
- 保存先パス: \`nora/mock/index.html\`
- CSS は原則 \`<style>\` 内。JS は \`<script>\` 内（閉域でも動くように外部 CDN に依存しない）
- 相対パスで \`static/\` を使う場合は、上記パスを基準にすること

## モックの性質
- **見た目のデモ**として、サンプルデータを入れた状態で **実際に操作できる** こと（ボタン・タブ・モーダル等）
- バックエンド API は不要。データは JS 内の配列 / オブジェクトでよい
- 各主要 UI ブロックに \`data-feature="機能名"\` を付ける（後で Python 実装と対応づけるため）

## 優先順位
- **ユーザーが求める全機能・全操作手順を漏れなく実装**することに注力
- **デザイン性は二の次**でよい（素朴な UI で可）
- **1000 行以下**を目安にする（超える場合は機能を削るより、冗長な markup を圧縮）

## 禁止・注意
- 秘密情報・実在の個人データを含めない
- 外部 API / CDN 必須の構成にしない`;

function normalizeTargetPlatform(id) {
  const v = String(id || "browser").trim().toLowerCase();
  return TARGET_PLATFORMS.some((p) => p.id === v) ? v : "browser";
}

function buildTargetPlatformBlock(targetPlatform) {
  const key = normalizeTargetPlatform(targetPlatform);
  return TARGET_PLATFORM_BLOCKS[key] || TARGET_PLATFORM_BLOCKS.browser;
}

/**
 * @param {{ appTitle: string, operationSteps: string, targetPlatform?: string }} input
 */
function buildMockPrompt(input) {
  const appTitle = String(input?.appTitle || "").trim();
  const operationSteps = String(input?.operationSteps || "").trim();
  const targetPlatform = normalizeTargetPlatform(input?.targetPlatform);
  const platformBlock = buildTargetPlatformBlock(targetPlatform);
  const platformLabel = TARGET_PLATFORMS.find((p) => p.id === targetPlatform)?.label || "Web";

  return `# アプリモック HTML の作成依頼

## アプリタイトル
${appTitle}

## 操作手順（ユーザー視点）
${operationSteps}

## 最終実装の種類
${platformLabel}

---
（以下 NoraOps 自動付与）

${platformBlock}

${MOCK_SYSTEM_BLOCK}`;
}

function mockIndexPath(workspaceRoot) {
  const { noraJoin } = require("./scaffold");
  return noraJoin(workspaceRoot, "mock", "index.html");
}

function mockSpecPath(workspaceRoot) {
  const { noraJoin } = require("./scaffold");
  return noraJoin(workspaceRoot, "mock", "spec.json");
}

function isMockIndexPlaceholder(content) {
  return String(content).includes(MOCK_PLACEHOLDER_MARKER);
}

function isMockReady(workspaceRoot) {
  const p = mockIndexPath(workspaceRoot);
  if (!fs.existsSync(p)) return false;
  try {
    const text = fs.readFileSync(p, "utf8");
    if (isMockIndexPlaceholder(text)) return false;
    return text.trim().length > 80;
  } catch {
    return false;
  }
}

function readMockSpec(workspaceRoot) {
  const p = mockSpecPath(workspaceRoot);
  if (!fs.existsSync(p)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    if (data && typeof data === "object") {
      return {
        appTitle: data.appTitle || "",
        operationSteps: data.operationSteps || "",
        targetPlatform: normalizeTargetPlatform(data.targetPlatform),
        updatedAt: data.updatedAt || null,
      };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function writeMockSpec(workspaceRoot, { appTitle, operationSteps, targetPlatform }) {
  const p = mockSpecPath(workspaceRoot);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const payload = {
    schema: "nora.mock-spec/1",
    appTitle: String(appTitle || "").trim(),
    operationSteps: String(operationSteps || "").trim(),
    targetPlatform: normalizeTargetPlatform(targetPlatform),
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(p, JSON.stringify(payload, null, 2) + "\n", "utf8");
  return payload;
}

function readMockIndexHtml(workspaceRoot) {
  const p = mockIndexPath(workspaceRoot);
  if (!fs.existsSync(p)) return null;
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

function estimateTokens(text) {
  const s = String(text || "");
  if (!s) return 0;
  const jp = (s.match(/[\u3000-\u303f\u3040-\u30ff\u4e00-\u9faf]/g) || []).length;
  const ratio = jp / Math.max(s.length, 1);
  const div = ratio > 0.3 ? 2.2 : 4;
  return Math.ceil(s.length / div);
}

function computeTextStats(text) {
  const s = String(text || "");
  return {
    lines: s ? s.split(/\r?\n/).length : 0,
    chars: s.length,
    tokens: estimateTokens(s),
  };
}

function buildMockPreviewPayload(workspaceRoot) {
  const html = readMockIndexHtml(workspaceRoot);
  if (html == null) return null;
  return {
    html,
    mockReady: isMockReady(workspaceRoot),
    hasFile: true,
    stats: computeTextStats(html),
  };
}

function readManifestDisplayName(workspaceRoot) {
  const p = path.join(workspaceRoot, "nora", "manifest.json");
  try {
    if (fs.existsSync(p)) {
      const man = JSON.parse(fs.readFileSync(p, "utf8"));
      if (man?.displayName) return String(man.displayName);
    }
  } catch {
    /* ignore */
  }
  return null;
}

function getMockExampleById(id) {
  return MOCK_EXAMPLES.find((ex) => ex.id === id) || null;
}

module.exports = {
  MOCK_PLACEHOLDER_MARKER,
  MOCK_INDEX_REL,
  MOCK_SPEC_REL,
  EXAMPLE_APP_TITLE,
  EXAMPLE_OPERATION_STEPS,
  MOCK_EXAMPLES,
  MOCK_SAMPLE_CATEGORIES,
  TARGET_PLATFORMS,
  MOCK_SYSTEM_BLOCK,
  buildMockPrompt,
  normalizeTargetPlatform,
  mockIndexPath,
  mockSpecPath,
  isMockReady,
  readMockSpec,
  writeMockSpec,
  readMockIndexHtml,
  buildMockPreviewPayload,
  computeTextStats,
  estimateTokens,
  readManifestDisplayName,
  getMockExampleById,
};
