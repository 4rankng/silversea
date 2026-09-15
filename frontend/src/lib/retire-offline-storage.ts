/** Upgrade-only cleanup; this module has no command sender or replay path. */
const LEGACY_QUEUE = 'silversea.driver-offline-command-queue.v1';
export type RetirementResult = { found: boolean; cleanupIncomplete: boolean };

function retireIndexedDb(): Promise<RetirementResult> {
  if (typeof indexedDB === 'undefined') return Promise.resolve({ found: false, cleanupIncomplete: false });
  return new Promise((resolve) => {
    let finished = false;
    let created = false;
    const finish = (result: RetirementResult) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      resolve(result);
    };
    const timeout = setTimeout(() => finish({ found: false, cleanupIncomplete: true }), 3_000);
    const request = indexedDB.open('silversea');
    request.onupgradeneeded = () => {
      // A fresh profile has no retired database. Do not create one.
      created = true;
      request.transaction?.abort();
    };
    request.onerror = () => finish({ found: false, cleanupIncomplete: !created });
    request.onblocked = () => finish({ found: false, cleanupIncomplete: true });
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('offline-queue')) {
        db.close();
        finish({ found: false, cleanupIncomplete: false });
        return;
      }
      let found = false;
      const tx = db.transaction('offline-queue', 'readwrite');
      const store = tx.objectStore('offline-queue');
      const count = store.count();
      count.onsuccess = () => { found = count.result > 0; };
      store.clear();
      tx.onerror = tx.onabort = () => { db.close(); finish({ found, cleanupIncomplete: true }); };
      tx.oncomplete = () => {
        const version = db.version + 1;
        db.close();
        const upgrade = indexedDB.open('silversea', version);
        upgrade.onupgradeneeded = () => {
          if (upgrade.result.objectStoreNames.contains('offline-queue')) {
            upgrade.result.deleteObjectStore('offline-queue');
          }
        };
        upgrade.onsuccess = () => { upgrade.result.close(); finish({ found, cleanupIncomplete: false }); };
        upgrade.onerror = upgrade.onblocked = () => finish({ found, cleanupIncomplete: true });
      };
    };
  });
}

export async function retireOfflineStorage(): Promise<RetirementResult> {
  let found = false;
  let cleanupIncomplete = false;
  try {
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (key && (key === LEGACY_QUEUE || key.startsWith(`${LEGACY_QUEUE}:`) || key === 'pending_logout_tokens')) {
        found = true;
        localStorage.removeItem(key);
      }
    }
  } catch { cleanupIncomplete = true; }
  const indexed = await retireIndexedDb().catch(() => ({ found: false, cleanupIncomplete: true }));
  return { found: found || indexed.found, cleanupIncomplete: cleanupIncomplete || indexed.cleanupIncomplete };
}
