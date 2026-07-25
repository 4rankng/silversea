import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  registerJob,
  getJob,
  listJobs,
  clearRegistry,
  advisoryLockKey,
} from '../scheduler/registry';
import { executeWithRetries } from '../scheduler/runner';

describe('scheduler registry', () => {
  beforeEach(() => clearRegistry());

  test('registerJob stores a job and getJob retrieves it', () => {
    registerJob({ name: 'reminders', cron: '0 9 * * *', handler: () => {} });
    const job = getJob('reminders');
    assert.ok(job);
    assert.strictEqual(job!.name, 'reminders');
    assert.strictEqual(job!.cron, '0 9 * * *');
  });

  test('re-registering the same name replaces the prior definition', () => {
    registerJob({ name: 'close', cron: '0 0 * * *', handler: () => {} });
    registerJob({ name: 'close', cron: '0 1 * * *', handler: () => {}, retries: 2 });
    const job = getJob('close');
    assert.strictEqual(job!.cron, '0 1 * * *');
    assert.strictEqual(job!.retries, 2);
  });

  test('registerJob rejects empty name', () => {
    assert.throws(() =>
      registerJob({ name: '', cron: '* * * * *', handler: () => {} }),
    );
  });

  test('registerJob rejects names with invalid characters', () => {
    assert.throws(() =>
      registerJob({ name: 'has space', cron: '* * * * *', handler: () => {} }),
    );
    assert.throws(() =>
      registerJob({ name: 'has/slash', cron: '* * * * *', handler: () => {} }),
    );
  });

  test('listJobs returns a snapshot of all registered jobs', () => {
    registerJob({ name: 'a', cron: '* * * * *', handler: () => {} });
    registerJob({ name: 'b', cron: '* * * * *', handler: () => {} });
    const names = listJobs().map((j) => j.name).sort();
    assert.deepStrictEqual(names, ['a', 'b']);
  });

  test('listJobs snapshot is decoupled from the registry', () => {
    registerJob({ name: 'a', cron: '* * * * *', handler: () => {} });
    const snap = listJobs();
    registerJob({ name: 'b', cron: '* * * * *', handler: () => {} });
    assert.strictEqual(snap.length, 1);
    assert.strictEqual(listJobs().length, 2);
  });
});

describe('advisoryLockKey', () => {
  test('is deterministic for the same name', () => {
    assert.strictEqual(
      advisoryLockKey('receivable-reminders'),
      advisoryLockKey('receivable-reminders'),
    );
  });

  test('is positive and fits int4 (Postgres advisory-lock constraint)', () => {
    for (const name of ['a', 'receivable-reminders', 'salary-close', 'x'.repeat(64)]) {
      const k = advisoryLockKey(name);
      assert.ok(Number.isInteger(k), `${name}: not integer`);
      assert.ok(k > 0, `${name}: not positive`);
      assert.ok(k < 0x7fffffff, `${name}: exceeds int4 max`);
    }
  });

  test('collides rarely — distinct names produce distinct keys for a sample', () => {
    const names = [
      'scheduler-heartbeat',
      'receivable-reminders',
      'salary-period-close',
      'email-retry',
      'fuel-reconciliation',
      'statement-issuance',
    ];
    const keys = new Set(names.map(advisoryLockKey));
    // 6 distinct names should produce 6 distinct keys; any collision is a real
    // bug worth investigating (and would make two different jobs race for the
    // same lock).
    assert.strictEqual(keys.size, names.length, 'unexpected advisory-lock-key collision');
  });

  test('same name across calls is stable', () => {
    // Wave 0 guarantee: a second backend pod computing the key for the same job
    // must get the same int, or the lock won't coordinate them.
    const a = advisoryLockKey('receivable-reminders');
    const b = advisoryLockKey('receivable-reminders');
    assert.strictEqual(a, b);
  });
});

describe('executeWithRetries', () => {
  // The writer captures every call so we can assert the audit-row state machine
  // (ATTEMPT before each handler run, then SUCCESS or FAILED once at the end)
  // without touching a database.
  type Call = ['ATTEMPT', number] | ['SUCCESS', number] | ['FAILED', number, string | undefined];
  function makeWriter(): { calls: Call[]; write: (s: 'ATTEMPT'|'SUCCESS'|'FAILED', a: number, e?: string) => Promise<void> } {
    const calls: Call[] = [];
    return {
      calls,
      write: async (status, attempt, error) => {
        if (status === 'FAILED') calls.push(['FAILED', attempt, error]);
        else calls.push([status, attempt]);
      },
    };
  }

  test('succeeds on first attempt — writes ATTEMPT(1) then SUCCESS(1)', async () => {
    const { calls, write } = makeWriter();
    const outcome = await executeWithRetries(async () => {}, 3, 0, write);
    assert.strictEqual(outcome.status, 'SUCCESS');
    assert.strictEqual(outcome.attempt, 1);
    assert.deepStrictEqual(calls, [['ATTEMPT', 1], ['SUCCESS', 1]]);
  });

  test('succeeds on retry — stamps the SUCCESS row with the actual attempt (B2 regression)', async () => {
    const { calls, write } = makeWriter();
    let n = 0;
    const outcome = await executeWithRetries(
      async () => { n++; if (n < 3) throw new Error('boom'); },
      3,
      0,
      write,
    );
    assert.strictEqual(outcome.status, 'SUCCESS');
    assert.strictEqual(outcome.attempt, 3, 'outcome must report the actual success attempt');
    assert.deepStrictEqual(
      calls,
      [
        ['ATTEMPT', 1], ['ATTEMPT', 2], ['ATTEMPT', 3], ['SUCCESS', 3],
      ],
      'SUCCESS row must be stamped with attempt=3, not the initial 1 or 2',
    );
  });

  test('exhausts retries — writes FAILED with the final attempt count and error (B2 regression)', async () => {
    const { calls, write } = makeWriter();
    const outcome = await executeWithRetries(
      async () => { throw new Error('always fails'); },
      3,
      0,
      write,
    );
    assert.strictEqual(outcome.status, 'FAILED');
    assert.strictEqual(outcome.attempt, 3, 'FAILED attempt must equal maxAttempts');
    assert.strictEqual(outcome.error, 'always fails');
    // No ATTEMPT-less FAILED; ATTEMPT writes happen before each try.
    assert.deepStrictEqual(
      calls,
      [
        ['ATTEMPT', 1], ['ATTEMPT', 2], ['ATTEMPT', 3],
        ['FAILED', 3, 'always fails'],
      ],
    );
  });

  test('retries=0 (maxAttempts=1) — single attempt, no retry sleep', async () => {
    const { calls, write } = makeWriter();
    const outcome = await executeWithRetries(
      async () => { throw new Error('nope'); },
      1,
      0,
      write,
    );
    assert.strictEqual(outcome.status, 'FAILED');
    assert.strictEqual(outcome.attempt, 1);
    assert.deepStrictEqual(calls, [['ATTEMPT', 1], ['FAILED', 1, 'nope']]);
  });

  test('writer throw does not mask the handler outcome', async () => {
    const failingWrite = async () => { throw new Error('db unavailable'); };
    const outcome = await executeWithRetries(async () => { /* succeed */ }, 1, 0, failingWrite);
    assert.strictEqual(outcome.status, 'SUCCESS');
    assert.strictEqual(outcome.attempt, 1);
  });
});
