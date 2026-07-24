const BLOCKED_TAG = /^(think|tool_call|minimax:[a-z_]+)$/i;
const BLOCKED_PREFIXES = ['<think', '<tool_call', '<minimax:'];

/** Remove model-internal markup before token deltas reach the UI. */
export function createSafeTextDeltaFilter(emit: (text: string) => void): {
  push: (delta: string) => void;
  finish: () => void;
} {
  let pending = '';
  let blockedCloseTag: string | null = null;

  const drain = (finishing = false): void => {
    while (pending.length > 0) {
      if (blockedCloseTag) {
        const closeAt = pending.toLowerCase().indexOf(blockedCloseTag);
        if (closeAt < 0) {
          pending = pending.slice(Math.max(0, pending.length - blockedCloseTag.length + 1));
          return;
        }
        pending = pending.slice(closeAt + blockedCloseTag.length);
        blockedCloseTag = null;
        continue;
      }

      const openAt = pending.indexOf('<');
      if (openAt < 0) {
        emit(pending);
        pending = '';
        return;
      }
      if (openAt > 0) {
        emit(pending.slice(0, openAt));
        pending = pending.slice(openAt);
        continue;
      }

      const tagEnd = pending.indexOf('>');
      if (tagEnd < 0) {
        const lower = pending.toLowerCase();
        const couldBeBlocked = BLOCKED_PREFIXES.some((prefix) => prefix.startsWith(lower) || lower.startsWith(prefix));
        if (couldBeBlocked && !finishing) return;
        emit('<');
        pending = pending.slice(1);
        continue;
      }

      const rawTag = pending.slice(1, tagEnd).trim();
      const selfClosing = /\/\s*$/.test(rawTag);
      const tagName = rawTag
        .replace(/^\//, '')
        .replace(/\/\s*$/, '')
        .trim()
        .split(/\s/, 1)[0] ?? '';
      if (!rawTag.startsWith('/') && BLOCKED_TAG.test(tagName)) {
        pending = pending.slice(tagEnd + 1);
        if (selfClosing) continue;
        blockedCloseTag = `</${tagName.toLowerCase()}>`;
        continue;
      }
      if (rawTag.startsWith('/') && BLOCKED_TAG.test(tagName)) {
        pending = pending.slice(tagEnd + 1);
        continue;
      }

      emit(pending.slice(0, tagEnd + 1));
      pending = pending.slice(tagEnd + 1);
    }
  };

  return {
    push(delta) {
      pending += delta;
      drain(false);
    },
    finish() {
      if (blockedCloseTag) {
        pending = '';
        return;
      }
      const lower = pending.toLowerCase();
      if (BLOCKED_PREFIXES.some((prefix) => prefix.startsWith(lower))) {
        pending = '';
        return;
      }
      drain(true);
    },
  };
}
