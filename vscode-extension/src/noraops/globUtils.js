function globMatch(rel, pattern) {
  const norm = rel.replace(/\\/g, "/");
  const p = pattern.replace(/\\/g, "/");

  if (p.startsWith("**/")) {
    const rest = p.slice(3);
    if (!rest) return true;
    if (rest.startsWith("*.")) {
      const suffix = rest.slice(1);
      return norm.endsWith(suffix);
    }
    if (rest.endsWith("/**")) {
      const segment = rest.slice(0, -3);
      return norm === segment || norm.startsWith(`${segment}/`) || norm.includes(`/${segment}/`);
    }
    if (rest.includes("*")) {
      const reSrc = `^${rest.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`;
      return new RegExp(reSrc).test(norm);
    }
    return norm === rest || norm.endsWith(`/${rest}`) || norm.includes(`/${rest}/`);
  }

  if (p.endsWith("/**")) {
    const prefix = p.slice(0, -3);
    return norm === prefix || norm.startsWith(`${prefix}/`);
  }

  return norm === p || norm.endsWith(`/${p}`);
}

function matchesGlobs(rel, globs, excludeGlobs) {
  if (!globs?.length) return true;
  const ok = globs.some((g) => globMatch(rel, g));
  if (!ok) return false;
  if (excludeGlobs?.some((g) => globMatch(rel, g))) return false;
  return true;
}

module.exports = { globMatch, matchesGlobs };
