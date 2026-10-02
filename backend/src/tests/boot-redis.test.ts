// Boot-time Redis gate: the check used by index.ts to fail loud when the
// configured redis URL is unreachable, instead of serving 503s per request.
// These pins cover the verdict function directly — a dead port must resolve
// fast with a clear error, a live port must resolve ok with the URL echoed,
// and credentials must never leak into the loggable form.
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { checkRedisAtBoot, redactRedisUrl } from '../lib/boot-redis';
import { disconnectRedis } from '../lib/redis';

after(async () => {
  await disconnectRedis();
});

describe('boot redis check', () => {
  test('dead port resolves not-ok, fast, with the URL and error named', async () => {
    const started = Date.now();
    const verdict = await checkRedisAtBoot('redis://localhost:6399', 1000);
    const elapsed = Date.now() - started;
    assert.equal(verdict.ok, false, 'nothing listens on 6399 in the test stack');
    assert.equal(verdict.url, 'redis://localhost:6399');
    assert.ok(verdict.error, 'an error reason is required for the boot banner');
    assert.ok(elapsed < 5000, `must fail fast, took ${elapsed}ms`);
  });

  test('live redis resolves ok with the redacted URL echoed', async () => {
    const verdict = await checkRedisAtBoot('redis://localhost:6391', 2000);
    assert.equal(verdict.ok, true, 'ss-prod-redis runs on 6391 in the dev stack');
    assert.equal(verdict.url, 'redis://localhost:6391');
  });

  test('credentials never survive into the loggable URL', () => {
    assert.equal(redactRedisUrl('redis://:secretpw@localhost:6391'), 'redis://***@localhost:6391');
    assert.equal(redactRedisUrl('redis://user:pw@localhost:6391'), 'redis://***@localhost:6391');
    assert.equal(redactRedisUrl('redis://localhost:6391'), 'redis://localhost:6391');
    assert.equal(redactRedisUrl('not a url'), '(unparseable redis url)');
  });

  // Card 20260928_186. The guard timer used to be scheduled without keeping
  // its handle, so it could never be cleared: even when Redis connected on the
  // first try the timer stayed pending for the full timeoutMs+500 and held the
  // event loop open. The verdict was right, the boot was needlessly slow.
  //
  // The pin identifies the guard by its exact delay (timeoutMs+500) and asserts
  // that *that handle* reaches clearTimeout. A count of cleared timers would
  // not do: ioredis clears its own connect timers internally, so a bare
  // "cleared > 0" passes even when the guard is still dangling. On the old
  // code the guard is created and never cleared, so this fails.
  const trackGuard = async <T>(
    run: () => Promise<T>,
    guardDelay: number,
  ): Promise<{ result: T; created: number; clearedGuard: boolean }> => {
    // The handle type differs between the DOM and Node lib declarations
    // (number vs Timeout), so derive it rather than naming it.
    type TimerHandle = ReturnType<typeof globalThis.setTimeout>;
    const created: { delay: number; handle: TimerHandle }[] = [];
    const cleared = new Set<TimerHandle>();
    const realSetTimeout = globalThis.setTimeout as unknown as (...args: unknown[]) => TimerHandle;
    const realClearTimeout = globalThis.clearTimeout as unknown as (...args: unknown[]) => void;

    globalThis.setTimeout = ((handler: TimerHandler, timeout?: number, ...rest: unknown[]) => {
      const handle = realSetTimeout(handler, timeout, ...rest);
      created.push({ delay: Number(timeout ?? 0), handle });
      return handle;
    }) as unknown as typeof globalThis.setTimeout;
    globalThis.clearTimeout = ((handle: TimerHandle) => {
      cleared.add(handle);
      return realClearTimeout(handle);
    }) as unknown as typeof globalThis.clearTimeout;

    try {
      const result = await run();
      const guards = created.filter((t) => t.delay === guardDelay);
      return { result, created: guards.length, clearedGuard: guards.some((g) => cleared.has(g.handle)) };
    } finally {
      globalThis.setTimeout = realSetTimeout as unknown as typeof globalThis.setTimeout;
      globalThis.clearTimeout = realClearTimeout as unknown as typeof globalThis.clearTimeout;
      // Never leave a spied timer armed: the spy is off, so nothing else owns it.
      for (const t of created) realClearTimeout(t.handle);
    }
  };

  test('a live redis clears the hung-connect guard rather than leaving it pending', async () => {
    const timeoutMs = 2000;
    const { result, created, clearedGuard } = await trackGuard(
      () => checkRedisAtBoot('redis://localhost:6391', timeoutMs),
      timeoutMs + 500,
    );
    assert.equal(result.ok, true, 'ss-prod-redis runs on 6391 in the dev stack');
    assert.equal(created, 1, `expected exactly one ${timeoutMs + 500}ms guard timer`);
    assert.ok(clearedGuard, 'the verdict settled on the first try, so the guard handle must reach clearTimeout');
  });

  test('an unreachable redis also clears the guard instead of leaving it armed', async () => {
    const timeoutMs = 1000;
    const { result, created, clearedGuard } = await trackGuard(
      () => checkRedisAtBoot('redis://localhost:6399', timeoutMs),
      timeoutMs + 500,
    );
    assert.equal(result.ok, false, 'nothing listens on 6399 in the test stack');
    assert.equal(created, 1, `expected exactly one ${timeoutMs + 500}ms guard timer`);
    assert.ok(clearedGuard, 'the connect failed fast, so the guard handle must reach clearTimeout');
  });
});
