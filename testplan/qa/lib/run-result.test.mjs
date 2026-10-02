import assert from 'node:assert/strict';
import test from 'node:test';
import { runExitCode } from './run-result.mjs';

test('a fully executed passing topic succeeds', () => {
  assert.equal(runExitCode([{ verdict: 'PASS' }, { verdict: 'PASS' }]), 0);
});

for (const verdict of ['FAIL', 'ERROR', 'BLOCKED', 'SKIP', 'INCONCLUSIVE', undefined]) {
  test(`a ${verdict ?? 'missing'} verdict cannot be reported as a successful topic`, () => {
    assert.equal(runExitCode([{ verdict: 'PASS' }, { verdict }]), 1);
  });
}

test('an empty topic is not verified', () => {
  assert.equal(runExitCode([]), 1);
});
