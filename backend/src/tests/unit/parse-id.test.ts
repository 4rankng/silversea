import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseId, parseOptionalId } from '../../routes/utils/parse-id';
import { ApiError } from '../../errors';

describe('route ID boundaries', () => {
  it('accepts complete positive integers', () => {
    assert.equal(parseId('1'), 1); assert.equal(parseId('00123'), 123);
    assert.equal(parseId(' 123 '), 123); assert.equal(parseId(['123']), 123);
    assert.equal(parseId(String(Number.MAX_SAFE_INTEGER)), Number.MAX_SAFE_INTEGER);
  });
  it('rejects partial, fractional, signed, exponent and unsafe IDs without truncating', () => {
    for (const value of [undefined, '', '0', '-1', '+1', '123oops', '123.5', '1e3', '0x10', '9007199254740992']) {
      assert.throws(() => parseId(value, 'Mã dòng'), (error: unknown) => error instanceof ApiError && error.statusCode === 400 && error.message === 'Mã dòng không hợp lệ');
    }
  });
  it('preserves absent optional fields and rejects malformed present fields', () => {
    for (const value of [undefined, null, '']) assert.equal(parseOptionalId(value, 'Mã'), null);
    assert.equal(parseOptionalId(123, 'Mã'), 123);
    for (const value of [0, 1.5, '123abc', {}, true]) assert.throws(() => parseOptionalId(value, 'Mã'), ApiError);
  });
});
