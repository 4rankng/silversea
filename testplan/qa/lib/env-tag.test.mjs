import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { tagNonPassErrors } from './env-tag.mjs';

/**
 * Card 20260928_189. Ten case files held 24 BLOCKED returns and not one named
 * the environment, so a reader could not tell a missing staging fixture from a
 * local gap. The rule is enforced at the runner boundary, which is what these
 * tests hold.
 */
const env = { env: 'local' };
const staging = { env: 'staging' };

describe('BLOCKED messages name their environment', () => {
  test('a BLOCKED error with no tag gets one, first', () => {
    const r = tagNonPassErrors({ verdict: 'BLOCKED', errors: ['no rows on /shipments'] }, env);
    assert.equal(r.errors[0], '[local] no rows on /shipments');
  });

  test('a FAIL is tagged too — it is still a non-PASS verdict', () => {
    const r = tagNonPassErrors({ verdict: 'FAIL', errors: ['expected 2 rows, got 0'] }, staging);
    assert.equal(r.errors[0], '[staging] expected 2 rows, got 0');
  });

  test('the tag goes FIRST so it survives log truncation', () => {
    const r = tagNonPassErrors({ verdict: 'BLOCKED', errors: ['x'.repeat(400)] }, env);
    assert.ok(r.errors[0].startsWith('[local] '), 'the env must lead, not trail');
  });

  test('an already-tagged message is not tagged twice', () => {
    const r = tagNonPassErrors({ verdict: 'BLOCKED', errors: ['[staging] already tagged'] }, env);
    assert.equal(r.errors[0], '[staging] already tagged', 'the case got to tag it itself; respect that');
    // Counted with matchAll, not match: the pattern has a capture group, so
    // match() would return [full, group] and report 2 for a single tag.
    const tags = [...r.errors[0].matchAll(/\[\s*(?:local|staging)\s*\]/g)];
    assert.equal(tags.length, 1, 'exactly one env tag, not two');
  });

  test('a case that tags itself per-message keeps every tag distinct', () => {
    const r = tagNonPassErrors(
      { verdict: 'BLOCKED', errors: ['[local] first reason', 'second reason'] },
      env,
    );
    assert.deepEqual(r.errors, ['[local] first reason', '[local] second reason']);
  });

  test('PASS is never tagged — a passing case has no reason to explain', () => {
    const r = tagNonPassErrors({ verdict: 'PASS', errors: ['not really an error'] }, env);
    assert.deepEqual(r.errors, ['not really an error']);
  });

  test('ERROR is left alone: a stack trace is not a verdict message', () => {
    const trace = ['Error: boom\n    at foo (/a/b.ts:1:1)'];
    const r = tagNonPassErrors({ verdict: 'ERROR', errors: trace }, env);
    assert.deepEqual(r.errors, trace);
  });

  test('an unknown env adds nothing rather than the word undefined', () => {
    const r = tagNonPassErrors({ verdict: 'BLOCKED', errors: ['why'] }, {});
    assert.deepEqual(r.errors, ['why'], 'tagging "[undefined]" is worse than no tag');
  });

  test('a non-string error is stringified, not dropped', () => {
    const r = tagNonPassErrors({ verdict: 'BLOCKED', errors: [{ message: 'objecty' }] }, env);
    assert.equal(r.errors[0], '[local] objecty');
  });

  test('a result with no errors array survives untouched', () => {
    const r = tagNonPassErrors({ verdict: 'BLOCKED' }, env);
    assert.deepEqual(r.errors, []);
  });

  test('null and undefined results do not throw', () => {
    assert.doesNotThrow(() => tagNonPassErrors(null, env));
    assert.doesNotThrow(() => tagNonPassErrors(undefined, env));
  });
});
