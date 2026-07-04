/**
 * xLLM エクスポート用の任意圧縮（全文は維持しないオプション）
 */

const COMPRESS_MODES = {
  NONE: "none",
  LIGHT: "light",
  STANDARD: "standard",
  STRUCTURE: "structure",
};

const DEFAULT_COMPRESS_MODE = COMPRESS_MODES.STANDARD;

const PRESET_META = [
  {
    id: COMPRESS_MODES.NONE,
    label: "なし（全文）",
    hint: "圧縮 0% — そのまま貼り付け",
    shortTag: "最安全",
    estRatio: 1,
    keeps: "すべての行・コメント・空白をそのまま送ります。",
    removes: "なし",
    risk: "トークン数だけが最大になります。精度は最も高いです。",
    recommend: "初回の難しいバグ調査や、コメントも含めて全部見てほしいとき。",
  },
  {
    id: COMPRESS_MODES.LIGHT,
    label: "軽量",
    hint: "目安 15〜25% 削減",
    shortTag: "ほぼ安全",
    estRatio: 0.8,
    keeps: "import / def / class 名、文字列リテラル、ロジックのコード本体。",
    removes: "連続空行、行末空白、Python 等の # 行コメント。",
    risk: "コメントだけ消えます。実装の意味はほぼ残ります。",
    recommend: "少しだけ短くしたいが、中身は変えたくないとき。",
  },
  {
    id: COMPRESS_MODES.STANDARD,
    label: "標準（おすすめ）",
    hint: "目安 35〜50% 削減",
    shortTag: "おすすめ",
    estRatio: 0.55,
    keeps: "関数・クラス定義、import、設定キー、HTML タグ構造、JSON のキーと値の骨格。",
    removes: "ブロックコメント（\"\"\" … \"\"\"、/* … */）、HTML の余分な空白、長い JSON 文字列の中身（一部省略）。",
    risk: "ドキュメント用コメントは消えますが、動くコードの構造は残ります。多くの改修依頼で十分な精度です。",
    recommend: "通常はこれで OK。はじめて使う方もここからで問題ありません。",
  },
  {
    id: COMPRESS_MODES.STRUCTURE,
    label: "骨格のみ",
    hint: "目安 60〜80% 削減",
    shortTag: "注意",
    estRatio: 0.35,
    keeps: "ファイル一覧、関数・クラスのシグネチャ、HTML のタグ名、PowerApps / JSON のキー構造。",
    removes: "Python / MATLAB の関数本体（… に置換）、HTML の長いテキストノード、長い文字列。",
    risk: "実装の細部が消えるため、AI が具体的な修正案を出しにくくなることがあります。",
    recommend: "「どんなファイルがあるか」だけ伝えたい、巨大プロジェクトの概要把握時のみ。",
  },
];

const COMPRESS_HELP = {
  title: "ソース圧縮について",
  intro:
    "外部 AI にはトークン上限があるため、送るソースを短くするオプションです。ロジックや構造を優先して削り、コメントや空白から手を付けます。",
  defaultNote: "迷ったら「標準（おすすめ）」を選んでください。コードの意味はほぼ保たれ、コメントや空白が主に削られます。",
  excludedAlways:
    ".env / .venv / .git など機密・生成物はもともとプロンプトに含めません（圧縮の有無に関係なく除外）。",
  perLanguage: [
    { lang: "Python / MATLAB", note: "骨格のみでは def / function の中身が … になります。標準ではコメントのみ削減。" },
    { lang: "HTML / Web", note: "標準でタグ構造は残し空白を詰めます。骨格のみでは長い表示テキストも省略します。" },
    { lang: "PowerApps (msapp 解凍 src)", note: "JSON / YAML のキー構造は残し、長い値文字列を短くします。フォルダ構成の把握向け。" },
    { lang: "JSON / YAML", note: "標準で minify。骨格のみでは 80 文字超の文字列値を省略します。" },
  ],
};

function normalizeCompressMode(raw) {
  const s = String(raw || COMPRESS_MODES.NONE).toLowerCase();
  return Object.values(COMPRESS_MODES).includes(s) ? s : COMPRESS_MODES.NONE;
}

function collapseBlankLines(text, maxRun = 2) {
  const lines = String(text).split(/\r?\n/);
  const out = [];
  let blanks = 0;
  for (const line of lines) {
    if (!line.trim()) {
      blanks += 1;
      if (blanks <= maxRun) out.push("");
      continue;
    }
    blanks = 0;
    out.push(line.replace(/[ \t]+$/, ""));
  }
  return out.join("\n");
}

function stripHashComments(text) {
  return String(text)
    .split(/\r?\n/)
    .map((line) => {
      const t = line.trimStart();
      if (t.startsWith("#") && !t.startsWith("#!")) return "";
      return line.replace(/[ \t]+$/, "");
    })
    .join("\n");
}

function stripBlockComments(text, open, close) {
  let s = String(text);
  let idx;
  while ((idx = s.indexOf(open)) !== -1) {
    const end = s.indexOf(close, idx + open.length);
    if (end === -1) break;
    s = s.slice(0, idx) + "\n" + s.slice(end + close.length);
  }
  return s;
}

function compressPythonStructure(text) {
  const lines = String(text).split(/\r?\n/);
  const out = [];
  let inDef = false;
  let defIndent = "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (!inDef) out.push(line);
      continue;
    }
    if (/^(import |from |@|class |def |async def )/.test(trimmed) || trimmed.startsWith("#")) {
      inDef = /^(class |def |async def )/.test(trimmed);
      defIndent = inDef ? (line.match(/^(\s*)/) || ["", ""])[1] : "";
      out.push(line);
      continue;
    }
    if (inDef) {
      if (line.startsWith(defIndent) && line.trim() && !line.trim().startsWith('"""') && !line.trim().startsWith("'''")) {
        if (!out.length || out[out.length - 1] !== `${defIndent}...`) {
          out.push(`${defIndent}...`);
        }
        continue;
      }
      if (!line.startsWith(defIndent)) inDef = false;
    }
    if (!inDef) out.push(line);
  }
  return collapseBlankLines(out.join("\n"));
}

function compressHtmlStructure(text) {
  let s = stripBlockComments(String(text), "<!--", "-->");
  s = s.replace(/>\s+</g, "><");
  s = s.replace(/>([^<]{40,})</g, ">[…]<");
  return collapseBlankLines(s, 1);
}

function compressJsonYaml(text, ext) {
  let s = String(text).trim();
  if (ext === ".json") {
    try {
      const data = JSON.parse(s);
      s = JSON.stringify(data, null, 0);
    } catch {
      /* keep */
    }
  }
  return s.replace(/"([^"]{80,})"/g, '"[…truncated]"');
}

function compressMatlabStructure(text) {
  const lines = String(text).split(/\r?\n/);
  const out = [];
  let inFn = false;
  for (const line of lines) {
    const t = line.trim();
    if (/^function\b/i.test(t)) {
      inFn = true;
      out.push(line);
      continue;
    }
    if (inFn) {
      if (/^end\s*($|%)/i.test(t) || /^function\b/i.test(t)) {
        inFn = !/^end\b/i.test(t);
        out.push(line);
      } else if (!t.startsWith("%")) {
        if (out[out.length - 1] !== "    % ...") out.push("    % ...");
      } else {
        out.push(line);
      }
      continue;
    }
    out.push(line);
  }
  return collapseBlankLines(out.join("\n"));
}

function compressFileContent(content, relPath, mode) {
  const m = normalizeCompressMode(mode);
  if (m === COMPRESS_MODES.NONE) return content;
  const ext = (relPath.match(/\.[^.]+$/) || [""])[0].toLowerCase();
  let text = String(content);

  if (m === COMPRESS_MODES.LIGHT) {
    text = collapseBlankLines(text);
    if ([".py", ".sh", ".yaml", ".yml", ".toml"].includes(ext)) {
      text = stripHashComments(text);
    }
    return text;
  }

  if (m === COMPRESS_MODES.STANDARD) {
    text = collapseBlankLines(text);
    if ([".py", ".js", ".ts", ".css"].includes(ext)) {
      text = stripBlockComments(text, '"""', '"""');
      text = stripBlockComments(text, "'''", "'''");
      text = stripBlockComments(text, "/*", "*/");
    }
    if (ext === ".html") text = compressHtmlStructure(text);
    if ([".json", ".yaml", ".yml"].includes(ext)) text = compressJsonYaml(text, ext);
    if ([".py", ".sh"].includes(ext)) text = stripHashComments(text);
    return text;
  }

  if (m === COMPRESS_MODES.STRUCTURE) {
    if (ext === ".py") return compressPythonStructure(text);
    if (ext === ".html" || ext === ".htm") return compressHtmlStructure(text);
    if ([".js", ".ts", ".css", ".xml"].includes(ext)) {
      text = stripBlockComments(text, "/*", "*/");
      return collapseBlankLines(text, 1);
    }
    if ([".json", ".yaml", ".yml"].includes(ext)) return compressJsonYaml(text, ext);
    if (ext === ".m") return compressMatlabStructure(text);
    return collapseBlankLines(stripHashComments(text));
  }

  return text;
}

function estimateCompressedLength(originalLen, mode) {
  const meta = PRESET_META.find((p) => p.id === normalizeCompressMode(mode));
  return Math.max(1, Math.round(originalLen * (meta?.estRatio ?? 1)));
}

module.exports = {
  COMPRESS_MODES,
  DEFAULT_COMPRESS_MODE,
  PRESET_META,
  COMPRESS_HELP,
  normalizeCompressMode,
  compressFileContent,
  estimateCompressedLength,
};
