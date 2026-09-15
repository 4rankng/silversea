import { describe, expect, it } from 'vitest';
import { isValidOptionalEmail } from './optional-email';

describe('optional email API parity', () => {
  it('accepts blank and trimmed addresses but rejects malformed local and domain parts', () => {
    for (const value of ['', '   ', ' ten@congty.vn ', 'ten+ops@congty.vn']) {
      expect(isValidOptionalEmail(value), value).toBe(true);
    }
    for (const value of ['abc', 'a@b', 'a@b..vn', 'a..b@congty.vn', 'a b@congty.vn']) {
      expect(isValidOptionalEmail(value), value).toBe(false);
    }
  });
});
