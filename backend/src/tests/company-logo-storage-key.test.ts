import { after, test } from 'node:test';
import assert from 'node:assert';
import { client } from '../db';
import { isCompanyLogoStorageKey } from '../routes/upload';

test('company logo storage keys are valid protected photo keys', () => {
  assert.strictEqual(
    isCompanyLogoStorageKey('company-assets/logo-15acbf4b-f3c8-445b-a622-22147cde4c9d.png'),
    true,
  );
});

test('company logo storage keys reject traversal and non-logo paths', () => {
  assert.strictEqual(isCompanyLogoStorageKey('company-assets/../logo.png'), false);
  assert.strictEqual(isCompanyLogoStorageKey('company-assets/logo-nested/file.png'), false);
  assert.strictEqual(isCompanyLogoStorageKey('company-assets/logo-test.jpg'), false);
  assert.strictEqual(isCompanyLogoStorageKey('trips/1/container-test.png'), false);
});

after(async () => {
  await client.end();
});
