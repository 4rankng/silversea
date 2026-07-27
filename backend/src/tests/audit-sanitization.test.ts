import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeBody } from '../middleware/audit';

describe('audit request-body sanitization', () => {
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
});
