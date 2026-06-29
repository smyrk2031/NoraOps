/** Webview 状態の短時間キャッシュ（タブ reveal 時の再計算を抑える） */

function createStaleCache(ttlMs = 15000) {
  let entry = null;
  return {
    get() {
      if (entry && Date.now() - entry.at < ttlMs) return entry.data;
      return null;
    },
    set(data) {
      entry = { data, at: Date.now() };
    },
    clear() {
      entry = null;
    },
  };
}

module.exports = { createStaleCache };
