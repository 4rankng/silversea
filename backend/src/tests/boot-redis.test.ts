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
});
