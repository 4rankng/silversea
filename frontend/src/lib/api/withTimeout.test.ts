import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { raceWithTimeout, TimeoutError } from './withTimeout';

describe('raceWithTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves with the underlying value when the promise wins', async () => {
    await expect(raceWithTimeout(Promise.resolve('data'), 15_000)).resolves.toBe('data');
  });

  it('rejects with TimeoutError when the timer fires first', async () => {
    const never = new Promise<never>(() => {});
    const raced = raceWithTimeout(never, 15_000);
    const assertion = expect(raced).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
  });

  it('rejects with a named TimeoutError ("hết thời gian chờ")', async () => {
    const never = new Promise<never>(() => {});
    const raced = raceWithTimeout(never, 15_000);
    const assertion = expect(raced).rejects.toMatchObject({ name: 'TimeoutError', message: 'hết thời gian chờ' });
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
  });

  it('clears the timer when the promise settles early (no dangling handle)', async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    await raceWithTimeout(Promise.resolve(1), 15_000);
    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });
});
