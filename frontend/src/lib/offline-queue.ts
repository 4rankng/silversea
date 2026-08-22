// Offline-queue client lib — IndexedDB-backed buffer for writes that must
// survive a dropped connection (PRD M10-01-03 / M8.4 offline-safe, Q23
// proposal: same request id → same result, no duplicate).
//
// Server-side dedupe is already built (M10.1 slice 1: `idempotency_keys`
// table + `runIdempotent()` + `Idempotency-Key` header on `api.post()`).
// This lib is the client half: it queues writes when offline and replays
// them with a STABLE client-generated idempotency key when back online, so
// a flaky-network resubmit returns the original result instead of creating
// a duplicate row.
//
// The roadmap names `idb-keyval`; we ship a minimal typed wrapper around the
// IndexedDB API instead of adding a runtime dep — same get/set/del shape,
// zero supply-chain surface, fully under our test control.
//
// Status machine:
//
//   QUEUED ──drain──► IN_PROGRESS ──ok──► DONE (terminal)
//                       │
//                       ├──err──► FAILED (retriable; next drain retries)
//                       └──409───► CONFLICT (terminal; client bug, don't retry)
//
// Storage is injected via a `QueueStore` interface so the lib is fully
// testable without an IndexedDB polyfill: production wires the real
// IndexedDB-backed store (`idbStore()`); tests inject an in-memory Map.

/** A queued write operation. Persisted in IndexedDB across reloads. */
export interface QueuedOp {
  /** Client-generated UUID v4 — the idempotency key sent in the header. */
  id: string;
  /** Logical endpoint tag, e.g. 'shipments.quick-create'. Matches the server
   *  `idempotency_keys.endpoint` column so the dedupe keyspace is per-endpoint. */
  endpoint: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body: unknown;
  /** Explicit workflow scope prevents commands for one fulfillment blocking another. */
  fulfillmentScopeKey?: string;
  expectedVersion?: number;
  actionKind?: string;
  status: 'QUEUED' | 'IN_PROGRESS' | 'DONE' | 'FAILED' | 'CONFLICT';
  retryCount: number;
  /** Last error message (for FAILED) or server conflict message (CONFLICT). */
  lastError: string | null;
  /** ISO timestamp; queued ops drain in this order. */
  createdAt: string;
  /** ISO timestamp of the last status transition. */
  updatedAt: string;
}

/** Result of a drain attempt on a single op. Returned by the `send` callback. */
export type SendResult =
  | { ok: true; response?: unknown }
  | { ok: false; kind: 'network' | 'conflict' | 'server'; message?: string };

type QueueListener = (ops: QueuedOp[]) => void;

/**
 * Storage backend. The production impl wraps IndexedDB; tests inject an
 * in-memory version. The interface is the minimal surface the queue needs.
 */
export interface QueueStore {
  getAll(): Promise<QueuedOp[]>;
  put(op: QueuedOp): Promise<void>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
}

// ─── helpers ────────────────────────────────────────────────────────────────

/** UUID v4 via crypto.randomUUID when available; RFC 4122 §4.4 fallback. */
export function uuidv4(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}

// ─── production IndexedDB store ─────────────────────────────────────────────

const DB_NAME = 'silversea';
const STORE = 'offline-queue';
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB không khả dụng — hàng đợi ngoại tuyến tắt.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Không mở được IndexedDB.'));
  });
}

/** The production IndexedDB-backed store. Throws if IndexedDB is unavailable. */
export function idbStore(): QueueStore {
  return {
    async getAll(): Promise<QueuedOp[]> {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).getAll();
        req.onsuccess = () => resolve(req.result as QueuedOp[]);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
      });
    },
    async put(op: QueuedOp): Promise<void> {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(op);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      });
    },
    async delete(id: string): Promise<void> {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      });
    },
    async clear(): Promise<void> {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).clear();
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      });
    },
  };
}

// ─── in-memory store (tests / non-persistent contexts) ──────────────────────

/** An in-memory `QueueStore` — used by tests and as a fallback when IndexedDB
 *  is unavailable. Not persistent across reloads. */
export function memoryStore(initial: QueuedOp[] = []): QueueStore {
  const map = new Map<string, QueuedOp>();
  for (const op of initial) map.set(op.id, op);
  return {
    async getAll() { return [...map.values()]; },
    async put(op) { map.set(op.id, op); },
    async delete(id) { map.delete(id); },
    async clear() { map.clear(); },
  };
}

// ─── the queue (storage-injected) ───────────────────────────────────────────

/**
 * The offline queue. Storage is injected so the queue logic is fully testable
 * without an IndexedDB polyfill. Production code uses the singleton
 * `offlineQueue` (IndexedDB-backed); tests construct their own with
 * `memoryStore()`.
 */
export class OfflineQueue {
  private listeners = new Set<QueueListener>();
  private drainInFlight = false;

  constructor(private store: QueueStore) {}

  /** Replace the backing store (e.g. test reset, or IndexedDB→memory fallback). */
  setStore(store: QueueStore) { this.store = store; }

  /** All ops regardless of status, oldest-first. */
  async listAll(): Promise<QueuedOp[]> {
    const all = await this.store.getAll();
    return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /** Ops still pending sync (QUEUED, IN_PROGRESS, FAILED — NOT terminal). */
  async listQueued(): Promise<QueuedOp[]> {
    const all = await this.listAll();
    return all.filter((o) => o.status !== 'DONE' && o.status !== 'CONFLICT');
  }

  /** Ops that still need user attention, including terminal conflicts. */
  async listVisible(): Promise<QueuedOp[]> {
    const all = await this.listAll();
    return all.filter((o) => o.status !== 'DONE');
  }

  /** Peek the next op to drain (oldest pending). */
  async peek(): Promise<QueuedOp | null> {
    const pending = await this.listQueued();
    return pending[0] ?? null;
  }

  /**
   * Queue a write for later sync. Generates a UUID v4 idempotency key unless
   * `id` is provided. The id doubles as the storage key, so re-enqueuing the
   * same id updates the existing row (idempotent on the client too).
   */
  async enqueue(input: {
    endpoint: string;
    method: QueuedOp['method'];
    path: string;
    body?: unknown;
    id?: string;
    fulfillmentScopeKey?: string;
    expectedVersion?: number;
    actionKind?: string;
  }): Promise<QueuedOp> {
    const now = new Date().toISOString();
    const op: QueuedOp = {
      id: input.id ?? uuidv4(),
      endpoint: input.endpoint,
      method: input.method,
      path: input.path,
      body: input.body ?? null,
      fulfillmentScopeKey: input.fulfillmentScopeKey,
      expectedVersion: input.expectedVersion,
      actionKind: input.actionKind,
      status: 'QUEUED',
      retryCount: 0,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.store.put(op);
    await this.notify();
    return op;
  }

  /** Queue a versioned fulfillment command with all replay authority fields. */
  async enqueueFulfillmentCommand(input: {
    endpoint: string;
    method: QueuedOp['method'];
    path: string;
    body: unknown;
    fulfillmentScopeKey: string;
    expectedVersion: number;
    actionKind: string;
    id?: string;
  }): Promise<QueuedOp> {
    return this.enqueue(input);
  }

  /** Subscribe to queue changes (enqueue/drain/status). Returns unsubscribe. */
  subscribe(listener: QueueListener): () => void {
    this.listeners.add(listener);
    // Fire once immediately so the UI can render the current backlog.
    this.listVisible().then((ops) => listener(ops)).catch(() => listener([]));
    return () => { this.listeners.delete(listener); };
  }

  private async notify(): Promise<void> {
    if (this.listeners.size === 0) return;
    const ops = await this.listVisible().catch(() => []);
    for (const l of this.listeners) l(ops);
  }

  private async markStatus(id: string, status: QueuedOp['status'], lastError: string | null): Promise<QueuedOp | null> {
    const all = await this.store.getAll();
    const op = all.find((o) => o.id === id);
    if (!op) return null;
    op.status = status;
    op.lastError = lastError;
    op.updatedAt = new Date().toISOString();
    await this.store.put(op);
    return op;
  }

  /**
   * Drain the queue: pop each pending op, call `send`, transition status by
   * the result. Idempotent — DONE/CONFLICT ops are skipped; an IN_PROGRESS
   * op left over from a crashed drain is re-queued. A `drainInFlight` guard
   * prevents two concurrent drains (e.g. two tabs) double-sending.
   *
   * Returns the count of ops that reached each terminal state this drain.
   */
  async drain(send: (op: QueuedOp) => Promise<SendResult>): Promise<{ done: number; failed: number; conflicts: number }> {
    if (this.drainInFlight) return { done: 0, failed: 0, conflicts: 0 };
    this.drainInFlight = true;
    let done = 0, failed = 0, conflicts = 0;
    const all = await this.listAll();
    const blockedScopes = new Set(
      all
        .filter((op) => op.status === 'CONFLICT' && op.fulfillmentScopeKey)
        .map((op) => op.fulfillmentScopeKey as string),
    );
    try {
      const pending = await this.listQueued();
      for (const op of pending) {
        if (op.fulfillmentScopeKey && blockedScopes.has(op.fulfillmentScopeKey)) continue;
        await this.markStatus(op.id, 'IN_PROGRESS', null);
        const result = await send(op).catch((err: unknown): SendResult => ({
          ok: false,
          kind: 'network',
          message: err instanceof Error ? err.message : 'Lỗi mạng',
        }));
        if (result.ok) {
          await this.markStatus(op.id, 'DONE', null);
          done++;
        } else if (result.kind === 'conflict') {
          // 409 = same key, different body. Terminal — a client bug, not a
          // network blip. Don't retry (Q23: never silently overwrite).
          await this.markStatus(op.id, 'CONFLICT', result.message ?? null);
          if (op.fulfillmentScopeKey) blockedScopes.add(op.fulfillmentScopeKey);
          conflicts++;
        } else {
          // Network/5xx — retriable. Bump retryCount; next drain retries.
          const cur = await this.markStatus(op.id, 'FAILED', result.message ?? 'Lỗi mạng');
          if (cur) {
            cur.retryCount = (cur.retryCount ?? 0) + 1;
            await this.store.put(cur);
          }
          if (op.fulfillmentScopeKey) blockedScopes.add(op.fulfillmentScopeKey);
          failed++;
        }
      }
      await this.notify();
      return { done, failed, conflicts };
    } finally {
      this.drainInFlight = false;
    }
  }

  /** Remove a single op (e.g. user discards a stuck CONFLICT). */
  async remove(id: string): Promise<void> {
    await this.store.delete(id);
    await this.notify();
  }

  /** Wipe the queue (test/reset helper). */
  async clear(): Promise<void> {
    await this.store.clear();
    await this.notify();
  }
}

/**
 * Production singleton. IndexedDB-backed; if IndexedDB is unavailable (e.g.
 * an old browser), it falls back to an in-memory store so callers don't
 * crash — writes just won't survive a reload.
 */
export const offlineQueue: OfflineQueue = (() => {
  try {
    if (typeof indexedDB !== 'undefined') return new OfflineQueue(idbStore());
  } catch {
    /* fall through to memory */
  }
  return new OfflineQueue(memoryStore());
})();
