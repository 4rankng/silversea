import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';

import { client, db } from '../db';
import * as s from '../db/schema';
import { decryptSecret } from '../services/crypto';
import {
  EMAIL_SETTING_KEYS,
  getEmailSettings,
  invalidateEmailSettings,
  saveEmailSettings,
} from '../services/email-settings.service';

let originalStoredValue: string | undefined;

before(async () => {
  const [row] = await db
    .select({ value: s.appSettings.value })
    .from(s.appSettings)
    .where(eq(s.appSettings.key, EMAIL_SETTING_KEYS.resendApiKey))
    .limit(1);
  originalStoredValue = row?.value;
  await db.delete(s.appSettings).where(eq(s.appSettings.key, EMAIL_SETTING_KEYS.resendApiKey));
  invalidateEmailSettings();
});

after(async () => {
  try {
    await db.delete(s.appSettings).where(eq(s.appSettings.key, EMAIL_SETTING_KEYS.resendApiKey));
    if (originalStoredValue !== undefined) {
      await db.insert(s.appSettings).values({
        key: EMAIL_SETTING_KEYS.resendApiKey,
        value: originalStoredValue,
      });
    }
    invalidateEmailSettings();
  } finally {
    await client.end({ timeout: 1 });
  }
});

describe('email settings service', () => {
  test('starts unconfigured without an environment fallback', async () => {
    assert.deepEqual(await getEmailSettings(), { resendApiKey: '' });
  });

  test('encrypts a replacement and returns the decrypted runtime value', async () => {
    const saved = await saveEmailSettings({ resendApiKey: 're_test_first' });
    assert.equal(saved.resendApiKey, 're_test_first');

    const [row] = await db
      .select({ value: s.appSettings.value })
      .from(s.appSettings)
      .where(eq(s.appSettings.key, EMAIL_SETTING_KEYS.resendApiKey))
      .limit(1);
    assert.ok(row.value.startsWith('enc:v1:'));
    assert.notEqual(row.value, 're_test_first');
    assert.equal(decryptSecret(row.value), 're_test_first');
  });

  test('blank input preserves the stored key', async () => {
    await saveEmailSettings({ resendApiKey: '   ' });
    assert.equal((await getEmailSettings()).resendApiKey, 're_test_first');
  });

  test('replacement is visible immediately and explicit clear removes it', async () => {
    await saveEmailSettings({ resendApiKey: 're_test_second' });
    assert.equal((await getEmailSettings()).resendApiKey, 're_test_second');

    await saveEmailSettings({ clearResendApiKey: true });
    assert.equal((await getEmailSettings()).resendApiKey, '');
    const [clearedRow] = await db
      .select({ value: s.appSettings.value })
      .from(s.appSettings)
      .where(eq(s.appSettings.key, EMAIL_SETTING_KEYS.resendApiKey))
      .limit(1);
    assert.equal(clearedRow, undefined);
  });

  test('explicit clear recovers from corrupt ciphertext without decrypting it', async () => {
    await db.insert(s.appSettings).values({
      key: EMAIL_SETTING_KEYS.resendApiKey,
      value: 'enc:v1:corrupt',
    });
    invalidateEmailSettings();

    await saveEmailSettings({ clearResendApiKey: true });
    assert.equal((await getEmailSettings()).resendApiKey, '');
  });
});
