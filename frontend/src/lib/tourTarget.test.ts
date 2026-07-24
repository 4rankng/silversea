import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resolveTourTarget, waitForTourTarget } from './tourTarget';

/**
 * Tour-target resolver contract. The resolver is the single lookup the
 * spotlight engine (Phase 3) uses; precedence (data-tour-id → id) and the
 * no-throw-on-timeout contract must hold.
 */
describe('resolveTourTarget', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('finds an element by data-tour-id', () => {
    const el = document.createElement('button');
    el.setAttribute('data-tour-id', 'trip-create-button');
    document.body.appendChild(el);
    expect(resolveTourTarget('trip-create-button')).toBe(el);
  });

  it('finds an element by id (legacy stable ids)', () => {
    const el = document.createElement('button');
    el.id = 'trip-new-submit';
    document.body.appendChild(el);
    expect(resolveTourTarget('trip-new-submit')).toBe(el);
  });

  it('prefers data-tour-id when both attributes are present on different elements', () => {
    const byId = document.createElement('button');
    byId.id = 'shared-id';
    document.body.appendChild(byId);
    const byAttr = document.createElement('button');
    byAttr.setAttribute('data-tour-id', 'shared-id');
    document.body.appendChild(byAttr);
    expect(resolveTourTarget('shared-id')).toBe(byAttr);
  });

  it('returns null when the target is absent', () => {
    expect(resolveTourTarget('does-not-exist')).toBeNull();
  });

  it('returns null for an empty targetId', () => {
    expect(resolveTourTarget('')).toBeNull();
  });

  it('escapes CSS meta-characters in a data-tour-id', () => {
    const el = document.createElement('button');
    // A targetId containing a character that is special in CSS selectors.
    el.setAttribute('data-tour-id', 'item[0]');
    document.body.appendChild(el);
    expect(resolveTourTarget('item[0]')).toBe(el);
  });
});

describe('waitForTourTarget', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('resolves immediately when the target is already mounted and visible', async () => {
    const el = document.createElement('input');
    el.id = 'customer-id';
    document.body.appendChild(el);
    await expect(waitForTourTarget('customer-id', { timeoutMs: 1000 })).resolves.toBe(el);
  });

  it('resolves once the target mounts later', async () => {
    const promise = waitForTourTarget('late-target', { timeoutMs: 500 });
    setTimeout(() => {
      const el = document.createElement('div');
      el.setAttribute('data-tour-id', 'late-target');
      document.body.appendChild(el);
    }, 120);
    const result = await promise;
    expect(result?.getAttribute('data-tour-id')).toBe('late-target');
  });

  it('returns null on timeout (does not throw)', async () => {
    const start = Date.now();
    const result = await waitForTourTarget('never', { timeoutMs: 80 });
    expect(result).toBeNull();
    expect(Date.now() - start).toBeGreaterThanOrEqual(70);
  });

  it('returns null immediately for timeoutMs 0 when the target is absent', async () => {
    const result = await waitForTourTarget('absent', { timeoutMs: 0 });
    expect(result).toBeNull();
  });

  it('keeps polling while the element is hidden (display:none) until timeout', async () => {
    const el = document.createElement('div');
    el.id = 'hidden-target';
    (el.style as unknown as { display: string }).display = 'none';
    document.body.appendChild(el);
    vi.useFakeTimers();
    try {
      const promise = waitForTourTarget('hidden-target', { timeoutMs: 300 });
      // Advance past the deadline.
      vi.advanceTimersByTime(350);
      const result = await promise;
      expect(result).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
