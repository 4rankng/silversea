import { describe, expect, it } from 'vitest';
import { businessDateISO, formatBusinessRef, formatDateTimeShort } from './format';

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
    expect(formatDateTimeShort('2026-09-11T06:30:00Z')).toBe('13:30 11/09/2026');
    // Day rollover across zones: 17:30Z = 00:30 next day +07.
    expect(formatDateTimeShort('2026-09-10T17:30:00Z')).toBe('00:30 11/09/2026');
    expect(formatDateTimeShort('not-a-date')).toBe('—');
    expect(formatDateTimeShort(null)).toBe('—');
  });
});

// Card 20260922_52 — internal ids and machine-generated placeholders never
// render (design law §8 / card 20260919_38). The operator's 23/09 screenshot
// showed the fixture row's raw values on the board.
describe('formatBusinessRef', () => {
  it('hides the leaked q10 fixture signature and the INV-EMPTY placeholder', () => {
    expect(formatBusinessRef('INV-EMPTY-1790165053059-q10-8h9x64')).toBe('—');
    expect(formatBusinessRef('INV-EMPTY-1790038443239-q10-q63uv3')).toBe('—');
    expect(formatBusinessRef('Q10-1790165053059-q10-8h9x64-3')).toBe('—');
    expect(formatBusinessRef('Q10 customer 1790165053059-q10-8h9x64 3')).toBe('—');
  });

  it('keeps real business identifiers, and renders absent values as the house empty token', () => {
    expect(formatBusinessRef('HD-C18-01')).toBe('HD-C18-01');
    expect(formatBusinessRef('SHP-2609-00020')).toBe('SHP-2609-00020');
    expect(formatBusinessRef('INV-77/decl 1023456')).toBe('INV-77/decl 1023456');
    expect(formatBusinessRef('CÔNG TY TNHH MỘT THÀNH VIÊN LONG MINH')).toBe('CÔNG TY TNHH MỘT THÀNH VIÊN LONG MINH');
    expect(formatBusinessRef(null)).toBe('—');
    expect(formatBusinessRef('   ')).toBe('—');
  });
});
