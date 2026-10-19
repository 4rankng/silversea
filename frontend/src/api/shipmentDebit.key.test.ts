/**
 * Card 191026160000 (§2e) — the export Idempotency-Key must stay within the
 * transport's 100-char limit for EVERY selection size. The raw sorted-id join
 * (`debit-note-1-2-…`) blew it on real multi-lot selections, which is the
 * entire "XUẤT DEBIT không xuất được" (400 Idempotency-Key không được vượt quá
 * 100 ký tự) — captured live against the local stack in
 * qa/2026-10-19_chiphi2-b_after/. Cases CP2-D5-KEY.
 */
import { describe, expect, it, vi } from 'vitest';

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('../lib/api', () => ({ api: { post } }));

import { createDebitNoteBatch } from './shipmentDebit';

function keyOfLastCall(): string {
  const init = post.mock.calls.at(-1)?.[2] as { headers: Record<string, string> };
  return init.headers['Idempotency-Key'];
}

describe('createDebitNoteBatch idempotency key (card 191026160000 §2e)', () => {
  it('small selections keep a short stable key', async () => {
    post.mockResolvedValue({ id: 1 });
    await createDebitNoteBatch([2, 1]);
    const key = keyOfLastCall();
    expect(key).toMatch(/^debit-note-2-[0-9a-f]+$/);
    expect(key.length).toBeLessThanOrEqual(100);
  });

  it('an 8864-lot selection still derives a ≤100-char key', async () => {
    post.mockResolvedValue({ id: 1 });
    const ids = Array.from({ length: 8864 }, (_, i) => i + 1);
    await createDebitNoteBatch(ids);
    const key = keyOfLastCall();
    // The old shape was ~53k chars — the whole failure.
    expect(key.length).toBeLessThanOrEqual(100);
    expect(key.startsWith('debit-note-8864-')).toBe(true);
  });

  it('same selection ⇒ same key; different selection ⇒ different key (replay contract)', async () => {
    post.mockResolvedValue({ id: 1 });
    await createDebitNoteBatch([5, 3, 9]);
    const a = keyOfLastCall();
    await createDebitNoteBatch([9, 3, 5]); // order-insensitive
    expect(keyOfLastCall()).toBe(a);
    await createDebitNoteBatch([5, 3, 10]);
    expect(keyOfLastCall()).not.toBe(a);
  });
});
