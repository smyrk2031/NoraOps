/** sec.ip_literal 用ユーザー救済ホワイトリスト（globalState・ユーザー単位） */

const { parseIpv4Octets } = require("./securityAllowlist");

const STORAGE_KEY = "noraops.security.ipUserWhitelist";
const MAX_ENTRIES = 32;

let _context = null;

function bindExtensionContext(context) {
  _context = context;
}

function normalizeList(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const v = validateIpAddress(item);
    if (!v.ok) continue;
    const key = v.ip.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v.ip);
  }
  return out;
}

function getUserIpWhitelist() {
  return normalizeList(_context?.globalState?.get(STORAGE_KEY));
}

async function saveUserIpWhitelist(ips) {
  if (!_context) return { ok: false, error: "拡張が初期化されていません", list: [] };
  const list = normalizeList(ips).slice(0, MAX_ENTRIES);
  await _context.globalState.update(STORAGE_KEY, list);
  return { ok: true, list };
}

function validateIpAddress(raw) {
  const s = String(raw || "").trim();
  if (!s) return { ok: false, error: "IP を入力してください" };
  if (s.includes(":")) {
    const normalized = s.toLowerCase();
    if (!/^[0-9a-f:.]+$/i.test(normalized) || (normalized.match(/:/g) || []).length < 2) {
      return { ok: false, error: "IPv6 の形式が不正です" };
    }
    return { ok: true, ip: normalized };
  }
  const p = parseIpv4Octets(s);
  if (!p) return { ok: false, error: "IPv4 は 0–255 の 4 オクテットで指定してください" };
  return { ok: true, ip: p.join(".") };
}

function isUserIpWhitelisted(ip, userList) {
  const normalized = String(ip).toLowerCase();
  const list = userList || getUserIpWhitelist();
  return list.some((entry) => String(entry).toLowerCase() === normalized);
}

async function addUserIp(raw) {
  const v = validateIpAddress(raw);
  if (!v.ok) return { ok: false, error: v.error, list: getUserIpWhitelist() };
  const list = getUserIpWhitelist();
  if (list.length >= MAX_ENTRIES) {
    return { ok: false, error: `登録上限（${MAX_ENTRIES} 件）に達しています`, list };
  }
  if (isUserIpWhitelisted(v.ip, list)) {
    return { ok: true, list, duplicate: true };
  }
  return saveUserIpWhitelist([...list, v.ip]);
}

async function removeUserIp(raw) {
  const v = validateIpAddress(raw);
  const key = (v.ok ? v.ip : String(raw || "").trim()).toLowerCase();
  const list = getUserIpWhitelist().filter((ip) => String(ip).toLowerCase() !== key);
  return saveUserIpWhitelist(list);
}

module.exports = {
  STORAGE_KEY,
  MAX_ENTRIES,
  bindExtensionContext,
  getUserIpWhitelist,
  saveUserIpWhitelist,
  validateIpAddress,
  isUserIpWhitelisted,
  addUserIp,
  removeUserIp,
  normalizeList,
};
