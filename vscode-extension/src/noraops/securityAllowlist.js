/** sec.ip_literal 用 IP allowlist と検出判定 */

const DEFAULT_SECURITY_IP_ALLOWLIST = ["127.0.0.1", "0.0.0.0", "::1", "8.8.8.8"];
const DEFAULT_SECURITY_IPV6_ALLOWLIST = ["::1"];

function mergeAllowlistEntries(serverList, defaults) {
  const out = [];
  const seen = new Set();
  for (const ip of [...(serverList || []), ...defaults]) {
    const key = String(ip).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(String(ip));
  }
  return out;
}

function getSecurityAllowlist(securityBundle) {
  const server = securityBundle?.allowlist || {};
  return {
    ips: mergeAllowlistEntries(server.ips, DEFAULT_SECURITY_IP_ALLOWLIST),
    ipv6: mergeAllowlistEntries(server.ipv6, DEFAULT_SECURITY_IPV6_ALLOWLIST),
  };
}

function isAllowlistedIp(ip, allow) {
  const normalized = String(ip).toLowerCase();
  if (allow.ips?.includes(ip) || allow.ips?.includes(normalized)) return true;
  if (allow.ipv6?.includes(ip) || allow.ipv6?.includes(normalized)) return true;
  return false;
}

function parseIpv4Octets(ip) {
  const parts = String(ip).split(".").map((s) => Number(s));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return null;
  }
  return parts;
}

/**
 * 172.* / 168系（192.168.*）— 直書き NG（allowlist のみ例外）。
 */
function isNgIpv4Pattern(ip) {
  const p = parseIpv4Octets(ip);
  if (!p) return false;
  const [a, b] = p;
  if (a === 172) return true;
  if (a === 192 && b === 168) return true;
  if (a === 168) return true;
  return false;
}

/**
 * 10.* 等 — ノイズ低減のため検出しない（allowlist 以外）。
 */
function isLowRiskExemptIpv4(ip) {
  const p = parseIpv4Octets(ip);
  if (!p) return true;
  const [a, b] = p;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateOrSpecialIpv6(ip) {
  const normalized = String(ip).toLowerCase();
  if (normalized === "::1") return true;
  if (normalized.startsWith("fe80:")) return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  return false;
}

/**
 * sec.ip_literal で警告するか。
 * - NG: 公衆 IP、172.*、168系（192.168.* / 168.*）
 * - OK: allowlist、10.*、ループバック等
 */
function shouldFlagGlobalIpLiteral(ip, allow) {
  if (isAllowlistedIp(ip, allow)) return false;
  if (String(ip).includes(":")) {
    if (isPrivateOrSpecialIpv6(ip)) return false;
    return true;
  }
  if (isNgIpv4Pattern(ip)) return true;
  if (isLowRiskExemptIpv4(ip)) return false;
  return true;
}

module.exports = {
  DEFAULT_SECURITY_IP_ALLOWLIST,
  DEFAULT_SECURITY_IPV6_ALLOWLIST,
  mergeAllowlistEntries,
  getSecurityAllowlist,
  isAllowlistedIp,
  isNgIpv4Pattern,
  isLowRiskExemptIpv4,
  shouldFlagGlobalIpLiteral,
  parseIpv4Octets,
};
