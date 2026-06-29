const fs = require("fs");
const path = require("path");

/** import 名 → uv/pip パッケージ名 */
const IMPORT_TO_PACKAGE = {
  PIL: "pillow",
  cv2: "opencv-python",
  sklearn: "scikit-learn",
  yaml: "pyyaml",
  bs4: "beautifulsoup4",
  dotenv: "python-dotenv",
};

const STDLIB = new Set([
  "__future__",
  "abc",
  "argparse",
  "array",
  "ast",
  "asyncio",
  "atexit",
  "base64",
  "binascii",
  "bisect",
  "builtins",
  "calendar",
  "collections",
  "concurrent",
  "contextlib",
  "copy",
  "csv",
  "dataclasses",
  "datetime",
  "decimal",
  "difflib",
  "dis",
  "email",
  "enum",
  "errno",
  "fnmatch",
  "fractions",
  "functools",
  "gc",
  "getpass",
  "glob",
  "gzip",
  "hashlib",
  "heapq",
  "hmac",
  "html",
  "http",
  "importlib",
  "inspect",
  "io",
  "ipaddress",
  "itertools",
  "json",
  "keyword",
  "logging",
  "math",
  "mimetypes",
  "multiprocessing",
  "numbers",
  "operator",
  "os",
  "pathlib",
  "pickle",
  "platform",
  "pprint",
  "queue",
  "quopri",
  "random",
  "re",
  "reprlib",
  "secrets",
  "select",
  "shlex",
  "shutil",
  "signal",
  "socket",
  "sqlite3",
  "ssl",
  "stat",
  "statistics",
  "string",
  "struct",
  "subprocess",
  "sys",
  "tarfile",
  "tempfile",
  "textwrap",
  "threading",
  "time",
  "traceback",
  "types",
  "typing",
  "unicodedata",
  "unittest",
  "urllib",
  "uuid",
  "warnings",
  "weakref",
  "xml",
  "zipfile",
  "zlib",
]);

function normalizePkgName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
}

function importNameToPackage(importName) {
  if (IMPORT_TO_PACKAGE[importName]) return IMPORT_TO_PACKAGE[importName];
  return importName.toLowerCase();
}

function parsePyprojectDependencyNames(pyprojectPath) {
  if (!fs.existsSync(pyprojectPath)) return [];
  const text = fs.readFileSync(pyprojectPath, "utf8");
  const deps = [];
  const block = text.match(/dependencies\s*=\s*\[([\s\S]*?)\]/);
  if (!block) return deps;
  for (const m of block[1].matchAll(/"([^"]+)"/g)) {
    const raw = m[1].split(/[<>=\[!~]/)[0].trim();
    if (raw) deps.push(normalizePkgName(raw));
  }
  return deps;
}

function parsePythonImportsFromFile(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, "utf8");
  const imports = new Set();
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    let m = t.match(/^import\s+([\w.]+)/);
    if (m) {
      imports.add(m[1].split(".")[0]);
      continue;
    }
    m = t.match(/^from\s+([\w.]+)\s+import/);
    if (m) imports.add(m[1].split(".")[0]);
  }
  return [...imports];
}

function isLikelyStdlib(importName) {
  const top = importName.split(".")[0];
  return STDLIB.has(top);
}

/**
 * main.py の import のうち、pyproject.toml に未記載のもの（= uv sync では入らない）
 * @returns {{ importName: string, packageName: string }[]}
 */
function findUndeclaredImports(mainPath, pyprojectPath) {
  const imports = parsePythonImportsFromFile(mainPath);
  const deps = new Set(parsePyprojectDependencyNames(pyprojectPath));
  const out = [];
  for (const imp of imports) {
    if (isLikelyStdlib(imp)) continue;
    const pkg = importNameToPackage(imp);
    if (deps.has(normalizePkgName(pkg)) || deps.has(normalizePkgName(imp))) continue;
    out.push({ importName: imp, packageName: pkg });
  }
  return out;
}

function findUndeclaredImportsForWorkspace(workspaceRoot, packagesDir, pyprojectPathFn) {
  const mainPath = path.join(packagesDir(workspaceRoot), "main.py");
  const pyPath = pyprojectPathFn(workspaceRoot);
  return findUndeclaredImports(mainPath, pyPath);
}

function findMissingInstalled(packages, undeclaredOrAll) {
  const installed = new Set(packages.map((p) => normalizePkgName(p.name)));
  return undeclaredOrAll.filter(
    (item) => !installed.has(normalizePkgName(item.packageName))
  );
}

module.exports = {
  parsePyprojectDependencyNames,
  parsePythonImportsFromFile,
  findUndeclaredImports,
  findUndeclaredImportsForWorkspace,
  findMissingInstalled,
  importNameToPackage,
  normalizePkgName,
};
