function parseContentDisposition(value) {
  if (!value) return null;
  const star = /filename\*\s*=\s*UTF-8''([^;\s]+)/i.exec(value);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      return star[1].trim();
    }
  }
  const plain = /filename\s*=\s*"([^"]+)"/i.exec(value) || /filename\s*=\s*([^;\s]+)/i.exec(value);
  if (!plain) return null;
  return plain[1].replace(/"/g, "").trim();
}

function isTextContentType(contentType) {
  const t = String(contentType || "").toLowerCase();
  if (!t) return true;
  if (t.startsWith("text/")) return true;
  if (t.includes("json")) return true;
  if (t.includes("xml")) return true;
  if (t.includes("javascript")) return true;
  if (t.includes("+json")) return true;
  if (t.includes("yaml")) return true;
  if (t.includes("x-www-form-urlencoded")) return true;
  return false;
}

function looksBinaryBuffer(buf) {
  const sample = buf.subarray(0, Math.min(buf.length, 512));
  for (const b of sample) {
    if (b === 0) return true;
  }
  return false;
}

module.exports = {
  parseContentDisposition,
  isTextContentType,
  looksBinaryBuffer,
};
