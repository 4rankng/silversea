import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeBody } from '../middleware/audit';
import { extractAuditEntityId } from '../services/audit.service';

describe('audit request-body sanitization', () => {
  test('keeps extracted entity IDs inside the PostgreSQL integer range', () => {
    assert.equal(extractAuditEntityId('/api/config/driver-user-bindings/42', {}), 42);
    assert.equal(extractAuditEntityId('/api/config/driver-user-bindings/2147483648', {}), null);
    assert.equal(extractAuditEntityId('/api/trips/12abc/lock', {}), null);
    assert.equal(extractAuditEntityId('/api/config/items', { id: '2147483648' }), null);
  });

  test('removes Resend credentials without dropping safe mutation context', () => {
    const sanitized = sanitizeBody({
      resendApiKey: 're_plaintext_must_not_persist',
      resend_api_key: 're_snake_case_must_not_persist',
      clearResendApiKey: false,
      provider: 'resend',
    });

    assert.deepEqual(sanitized, {
      clearResendApiKey: false,
      provider: 'resend',
    });
    assert.doesNotMatch(JSON.stringify(sanitized), /re_plaintext/);
  });

  test('recursively removes password and credential variants while preserving safe flags', () => {
    const sanitized = sanitizeBody({
      currentPassword: 'old-secret',
      newPassword: 'new-secret',
      confirmPassword: 'new-secret',
      nested: {
        password_hash: 'hash',
        Credential: 'token-credential',
        profile: {
          accessToken: 'jwt',
          clearResendApiKey: true,
          keepMe: 'safe',
        },
      },
      items: [
        { apiKey: 'api-secret', name: 'first' },
        { SettingsEncryptionKey: 'enc-secret', keep: 'second' },
      ],
    });

    assert.deepEqual(sanitized, {
      nested: {
        profile: {
          clearResendApiKey: true,
          keepMe: 'safe',
        },
      },
      items: [
        { name: 'first' },
        { keep: 'second' },
      ],
    });
  });
});
