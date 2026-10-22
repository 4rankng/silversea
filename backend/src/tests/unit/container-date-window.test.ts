// Card 261022201006b — "Filter ngày leak": a date-only filter bound against a
// timestamptz column (ngày đóng/trả = shipments.customs_cutoff_at) must span
// the ASIA/HO_CHI_MINH day 00:00:00.000 ≤ x < next-day 00:00 — NOT the UTC day
// that `new Date('YYYY-MM-DD')` produced. The UTC window dropped every row
// between VN 00:00 and 06:59 of the filtered day and leaked the NEXT day's VN
// early morning rows into it ("lọc ngày A vẫn trả lô ngày khác").
//
// Review finding 1: only canonical YYYY-MM-DD days or tz-qualified instants
// are accepted — anything else would parse in the SERVER timezone and re-open
// the leak, so it yields null and the route rejects with 400.
// Review finding 3: the upper bound is END-EXCLUSIVE (repo VN-day law).
//
// Pure unit test — boundary instants at 00:00 / 23:59 VN (3 consecutive days).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { businessZoneDayEndExclusiveInstant, businessZoneDayStartInstant } from '../../services/container-date-filter';

describe('businessZoneDayStartInstant — date-only bounds open at VN midnight', () => {
  it('maps a date-only day to its 00:00 VN instant (17:00Z of the previous day)', () => {
    assert.equal(
      businessZoneDayStartInstant('2026-10-24')?.toISOString(),
      '2026-10-23T17:00:00.000Z',
    );
    assert.equal(
      businessZoneDayStartInstant('2026-10-25')?.toISOString(),
      '2026-10-24T17:00:00.000Z',
    );
    assert.equal(
      businessZoneDayStartInstant('2026-10-23')?.toISOString(),
      '2026-10-22T17:00:00.000Z',
    );
  });

  it('passes a tz-qualified instant through unchanged', () => {
    assert.equal(
      businessZoneDayStartInstant('2026-10-24T00:30:00+07:00')?.toISOString(),
      '2026-10-23T17:30:00.000Z',
    );
    assert.equal(
      businessZoneDayStartInstant('2026-10-23T17:30:00.000Z')?.toISOString(),
      '2026-10-23T17:30:00.000Z',
    );
  });

  it('rejects every server-timezone-parseable shape (review finding 1)', () => {
    for (const bad of [
      '24/10/2026', '', '   ',
      '2026-1-2', '1/2/2026',              // non-canonical date shapes
      '2026-10-22T12:00', '2026-10-22T12:00:00', // tz-less datetimes
      '2026-02-30', '2026-13-01',          // rolled-over calendar input
    ]) {
      assert.equal(businessZoneDayStartInstant(bad), null, `should reject: ${bad}`);
    }
  });
});

describe('businessZoneDayEndExclusiveInstant — date-only bounds close at the next VN midnight', () => {
  it('maps a date-only day to the NEXT day 00:00 VN instant (17:00Z)', () => {
    assert.equal(
      businessZoneDayEndExclusiveInstant('2026-10-24')?.toISOString(),
      '2026-10-24T17:00:00.000Z',
    );
  });

  it('keeps consecutive-day windows disjoint and adjacent at the VN boundary', () => {
    const dayAEnd = businessZoneDayEndExclusiveInstant('2026-10-24')!.getTime();
    const dayBStart = businessZoneDayStartInstant('2026-10-25')!.getTime();
    // End-exclusive: day A's bound IS day B's start — `lt(dayAEnd)` and
    // `gte(dayBStart)` cannot both hold for any instant, and no instant falls
    // in a gap.
    assert.equal(dayAEnd, dayBStart);
    // The instant "2026-10-25 00:00:00 VN" belongs to day B only.
    const midnightB = new Date('2026-10-24T17:00:00.000Z').getTime();
    assert.ok(midnightB >= businessZoneDayStartInstant('2026-10-25')!.getTime());
    assert.ok(midnightB >= businessZoneDayEndExclusiveInstant('2026-10-24')!.getTime());
    // A next-day 00:30 VN row falls OUTSIDE day A's window…
    const nextDayEarly = new Date('2026-10-24T17:30:00.000Z').getTime(); // 2026-10-25 00:30 VN
    assert.ok(nextDayEarly >= businessZoneDayEndExclusiveInstant('2026-10-24')!.getTime());
    assert.ok(nextDayEarly >= businessZoneDayStartInstant('2026-10-25')!.getTime());
    // …and a same-day 23:45 VN row falls INSIDE its own window.
    const sameDayLate = new Date('2026-10-24T16:45:00.000Z').getTime(); // 2026-10-24 23:45 VN
    assert.ok(sameDayLate >= businessZoneDayStartInstant('2026-10-24')!.getTime());
    assert.ok(sameDayLate < businessZoneDayEndExclusiveInstant('2026-10-24')!.getTime());
  });

  it('returns the instant + 1ms for tz-qualified instants (legacy lte meaning at wire precision)', () => {
    assert.equal(
      businessZoneDayEndExclusiveInstant('2026-10-24T00:30:00+07:00')?.toISOString(),
      '2026-10-23T17:30:00.001Z',
    );
  });

  it('rejects every server-timezone-parseable shape (review finding 1)', () => {
    for (const bad of ['not-a-date', '2026-10-22T12:00', '2026-02-30']) {
      assert.equal(businessZoneDayEndExclusiveInstant(bad), null, `should reject: ${bad}`);
    }
  });
});
