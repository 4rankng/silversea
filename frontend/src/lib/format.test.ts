import { describe, expect, it } from 'vitest';
import { businessDateISO, formatDateTimeShort } from './format';

describe('businessDateISO', () => {
  it('uses the Vietnam calendar date around the UTC rollover', () => {
    expect(businessDateISO(new Date('2026-07-27T17:30:00.000Z'))).toBe('2026-07-28');
    expect(businessDateISO(new Date('2026-07-28T16:59:59.000Z'))).toBe('2026-07-28');
    expect(businessDateISO(new Date('2026-07-28T17:00:00.000Z'))).toBe('2026-07-29');
  });
});

describe('formatDateTimeShort', () => {
  it('pins Vietnam wall-clock regardless of host timezone', () => {
    // 06:30Z = 13:30 +07 — the unpinned formatter rendered 14:30 on a +08 host.
    expect(formatDateTimeShort('2026-09-11T06:30:00Z')).toBe('13:30 11/9/26');
    // Day rollover across zones: 17:30Z = 00:30 next day +07.
    expect(formatDateTimeShort('2026-09-10T17:30:00Z')).toBe('00:30 11/9/26');
    expect(formatDateTimeShort('not-a-date')).toBe('—');
    expect(formatDateTimeShort(null)).toBe('—');
  });
});
