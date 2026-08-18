import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { gpsSettingsUpdateSchema } from '@tingting/shared';

describe('gpsSettingsUpdateSchema', () => {
  test('accepts a username with an optional replacement password', () => {
    assert.deepEqual(
      gpsSettingsUpdateSchema.parse({ username: '  nepo-gps  ', password: '  secret  ' }),
      { username: 'nepo-gps', password: '  secret  ' },
    );
  });

  test('allows password omission so the stored password is preserved', () => {
    assert.deepEqual(
      gpsSettingsUpdateSchema.parse({ username: 'nepo-gps' }),
      { username: 'nepo-gps' },
    );
  });

  test('rejects blank usernames and blank replacement passwords', () => {
    assert.equal(gpsSettingsUpdateSchema.safeParse({ username: ' ' }).success, false);
    assert.equal(
      gpsSettingsUpdateSchema.safeParse({ username: 'nepo-gps', password: ' ' }).success,
      false,
    );
  });
});
