import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getPgErrorCode, isPgUniqueViolation } from '../../errors';

/** Shape-matched fixtures for both throw morphologies (direct + Drizzle-wrapped). */
function directErr(constraint?: string, detail?: string) {
  return Object.assign(new Error('dup'), { code: '23505', constraint, detail });
}
function wrappedErr(constraint?: string, detail?: string) {
  return Object.assign(new Error('dup'), {
    cause: { code: '23505', constraint, detail: detail ?? `Key (code)=(X1) already exists` },
  });
}

test('getPgErrorCode reads direct and Drizzle-wrapped codes, null otherwise', () => {
  assert.equal(getPgErrorCode(directErr()), '23505');
  assert.equal(getPgErrorCode(wrappedErr()), '23505');
  assert.equal(getPgErrorCode(new Error('plain')), null);
  assert.equal(getPgErrorCode(null), null);
  assert.equal(getPgErrorCode('nope'), null);
});

test('isPgUniqueViolation detects 23505 in both morphologies', () => {
  assert.equal(isPgUniqueViolation(directErr()), true);
  assert.equal(isPgUniqueViolation(wrappedErr()), true);
  assert.equal(isPgUniqueViolation(new Error('plain')), false);
  assert.equal(isPgUniqueViolation(Object.assign(new Error('x'), { code: '40001' })), false);
  assert.equal(isPgUniqueViolation(null), false);
});

test('isPgUniqueViolation narrows by constraint name via constraint or detail', () => {
  assert.equal(isPgUniqueViolation(directErr('users_email_uniq'), 'users_email_uniq'), true);
  assert.equal(isPgUniqueViolation(wrappedErr('users_email_uniq'), 'users_email_'), true);
  assert.equal(isPgUniqueViolation(wrappedErr(undefined, 'Key (email)=(a@b) already exists'), 'users_email_uniq'), false);
  assert.equal(
    isPgUniqueViolation(
      Object.assign(new Error('dup'), { code: '23505', detail: 'Key (id)=(3) on table idempotency_keys_endpoint_key_uniq' }),
      'idempotency_keys_endpoint_key_uniq',
    ),
    true,
  );
  assert.equal(isPgUniqueViolation(directErr('users_email_uniq'), 'other_uniq'), false);
});
