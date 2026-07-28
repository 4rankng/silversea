import { describe, expect, it } from 'vitest';
import { businessDateISO } from './format';

describe('businessDateISO', () => {
  it('uses the Vietnam calendar date around the UTC rollover', () => {
    expect(businessDateISO(new Date('2026-07-27T17:30:00.000Z'))).toBe('2026-07-28');
    expect(businessDateISO(new Date('2026-07-28T16:59:59.000Z'))).toBe('2026-07-28');
    expect(businessDateISO(new Date('2026-07-28T17:00:00.000Z'))).toBe('2026-07-29');
  });
});
