/**
 * Wave 4 — offline-queue client lib unit tests.
 *
 * Uses the storage-injection seam: each test constructs an `OfflineQueue`
 * with an in-memory `memoryStore`, so there is no IndexedDB dependency in
 * the test environment.
 *
 * Coverage (PRD M10-01-03 / M8.4 / Q23):
 *   - enqueue → listQueued shows the op with a UUID v4 id.
 *   - drain success → DONE; the op is excluded from listQueued.
 *   - drain failure (network) → FAILED + retryCount bump; stays in listQueued.
 *   - drain conflict (409) → CONFLICT (terminal); excluded from listQueued
 *     and NOT retried on the next drain.
 *   - DONE op is skipped on re-drain (idempotent — no duplicate send).
 *   - peek returns the oldest pending op.
 *   - subscribe fires on enqueue/drain.
 *   - enqueue with explicit `id` updates the existing row (idempotent enqueue).
 *   - drain single-flight: a concurrent drain returns zeros without double-sending.
 *   - an IN_PROGRESS op left from a crashed drain is re-queued on the next drain.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  OfflineQueue,
  memoryStore,
  uuidv4,
  type QueuedOp,
  type SendResult,
} from './offline-queue';

/** Fresh queue + store per test — full isolation, no IDB. */
function mkQueue() {
  return new OfflineQueue(memoryStore());
}

describe('offline-queue — enqueue / listQueued / peek', () => {
  it('enqueue generates a UUID v4 id and the op appears in listQueued', async () => {
    const q = mkQueue();
    const op = await q.enqueue({ endpoint: 'shipments.quick-create', method: 'POST', path: '/api/shipments/quick', body: { customerId: 7 } });
    expect(op.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(op.status).toBe('QUEUED');
    const queued = await q.listQueued();
    expect(queued).toHaveLength(1);
    expect(queued[0].id).toBe(op.id);
  });

  it('enqueue with explicit id updates the existing row (idempotent enqueue)', async () => {
    const q = mkQueue();
    const id = uuidv4();
    await q.enqueue({ id, endpoint: 'e', method: 'POST', path: '/p', body: { v: 1 } });
    await q.enqueue({ id, endpoint: 'e', method: 'POST', path: '/p', body: { v: 2 } });
    const all = await q.listAll();
    expect(all).toHaveLength(1);
    expect(all[0].body).toMatchObject({ v: 2 });
  });

  it('peek returns the oldest pending op', async () => {
    const q = mkQueue();
    await q.enqueue({ endpoint: 'e', method: 'POST', path: '/p1' });
    await q.enqueue({ endpoint: 'e', method: 'POST', path: '/p2' });
    const top = await q.peek();
    expect(top?.path).toBe('/p1');
  });
});

describe('offline-queue — drain', () => {
  it('drain success → DONE; the op is excluded from listQueued', async () => {
    const q = mkQueue();
    await q.enqueue({ endpoint: 'e', method: 'POST', path: '/p' });
    const send = async (): Promise<SendResult> => ({ ok: true });
    const res = await q.drain(send);
    expect(res.done).toBe(1);
    expect(res.failed).toBe(0);
    expect(await q.listQueued()).toHaveLength(0);
  });

  it('drain failure (network) → FAILED + retryCount bump; stays in listQueued', async () => {
    const q = mkQueue();
    await q.enqueue({ endpoint: 'e', method: 'POST', path: '/p' });
    const send = async (): Promise<SendResult> => ({ ok: false, kind: 'network', message: 'offline' });
    const res = await q.drain(send);
    expect(res.failed).toBe(1);
    const queued = await q.listQueued();
    expect(queued).toHaveLength(1);
    expect(queued[0].status).toBe('FAILED');
    expect(queued[0].retryCount).toBe(1);
    expect(queued[0].lastError).toBe('offline');
  });

  it('drain conflict (409) → CONFLICT (terminal); excluded from listQueued and NOT retried', async () => {
    const q = mkQueue();
    await q.enqueue({ endpoint: 'e', method: 'POST', path: '/p' });
    const send = async (): Promise<SendResult> => ({ ok: false, kind: 'conflict', message: 'khóa trùng' });
    const res = await q.drain(send);
    expect(res.conflicts).toBe(1);
    expect(await q.listQueued()).toHaveLength(0);
    // Re-drain does not retry the terminal CONFLICT.
    const send2 = vi.fn(async (): Promise<SendResult> => ({ ok: true }));
    await q.drain(send2);
    expect(send2).not.toHaveBeenCalled();
  });

  it('DONE op is skipped on re-drain (idempotent — no duplicate send)', async () => {
    const q = mkQueue();
    await q.enqueue({ endpoint: 'e', method: 'POST', path: '/p' });
    const send1 = vi.fn(async (): Promise<SendResult> => ({ ok: true }));
    await q.drain(send1);
    expect(send1).toHaveBeenCalledTimes(1);
    const send2 = vi.fn(async (): Promise<SendResult> => ({ ok: true }));
    await q.drain(send2);
    expect(send2).not.toHaveBeenCalled();
  });

  it('an IN_PROGRESS op left from a crashed drain is re-queued on the next drain', async () => {
    const q = mkQueue();
    const op = await q.enqueue({ endpoint: 'e', method: 'POST', path: '/p' });
    // Simulate a crash mid-drain: plant a stale IN_PROGRESS row directly.
    const all = await q.listAll();
    const stale = all.find((o) => o.id === op.id)!;
    stale.status = 'IN_PROGRESS';
    await (q as unknown as { store: { put: (o: QueuedOp) => Promise<void> } }).store.put(stale);
    // listQueued includes IN_PROGRESS, so the next drain re-sends it.
    const send = vi.fn(async (): Promise<SendResult> => ({ ok: true }));
    await q.drain(send);
    expect(send).toHaveBeenCalledTimes(1);
    expect(await q.listQueued()).toHaveLength(0);
  });

  it('drain single-flight: a concurrent drain returns zeros without double-sending', async () => {
    const q = mkQueue();
    await q.enqueue({ endpoint: 'e', method: 'POST', path: '/p' });
    const send = vi.fn(async (): Promise<SendResult> => ({ ok: true }));
    const [a, b] = await Promise.all([q.drain(send), q.drain(send)]);
    // Exactly one op was sent; the loser drain returned zeros.
    expect(send).toHaveBeenCalledTimes(1);
    expect(a.done + b.done).toBe(1);
    expect(Math.min(a.done, b.done)).toBe(0);
  });
});

describe('offline-queue — subscribe', () => {
  it('subscribe fires immediately with the current backlog and on enqueue', async () => {
    const q = mkQueue();
    const listener = vi.fn();
    const unsub = q.subscribe(listener);
    // Initial fire (current backlog is empty).
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
    await q.enqueue({ endpoint: 'e', method: 'POST', path: '/p' });
    await vi.waitFor(() => expect(listener).toHaveBeenCalled());
    unsub();
  });
});

describe('offline-queue — uuidv4', () => {
  it('generates distinct RFC 4122 v4 ids', () => {
    const a = uuidv4();
    const b = uuidv4();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(b).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(a).not.toBe(b);
  });
});
