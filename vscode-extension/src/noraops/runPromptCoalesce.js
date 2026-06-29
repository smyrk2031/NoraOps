/** 同一実行試行内のモーダル重複表示を防ぐ */

const inflightRunPrompts = new Map();

async function coalesceRunPrompt(key, fn) {
  const existing = inflightRunPrompts.get(key);
  if (existing) {
    await existing;
    return;
  }
  const task = (async () => {
    try {
      await fn();
    } finally {
      if (inflightRunPrompts.get(key) === task) {
        inflightRunPrompts.delete(key);
      }
    }
  })();
  inflightRunPrompts.set(key, task);
  await task;
}

module.exports = { coalesceRunPrompt };
