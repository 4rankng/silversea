import assert from 'node:assert/strict';
import test from 'node:test';

process.env.SETTINGS_ENCRYPTION_KEY = 'ab'.repeat(32);

const { decryptSecret, encryptSecret } = await import('../services/crypto');

test('encryptSecret accepts a documented 32-byte hex master key', () => {
  const encrypted = encryptSecret('gps-password');

  assert.match(encrypted, /^enc:v1:/);
  assert.equal(decryptSecret(encrypted), 'gps-password');
});
