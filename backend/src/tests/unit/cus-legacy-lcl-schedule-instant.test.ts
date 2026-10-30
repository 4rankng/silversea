/**
 * SIL-610 (id 713) — legacy LCL lots (pre-SIL-587) carry only the date-level
 * expectedDeliveryDate, so the Tổng quan renders date-only. The one real time
 * such a lot owns is its live trip's "Giờ chạy" (plannedStartAt, seeded from
 * the lot's schedule at issue). deriveLegacyScheduleInstant turns that trip
 * instant into the wire's derivedScheduleAt — same-day-ICT only, display-only,
 * and never when a stored closingAt/plannedReturnAt exists.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { deriveLegacyScheduleInstant } from '../../services/cus-workspace-mapping.service';

const EDD = '2026-10-29';

describe('deriveLegacyScheduleInstant (SIL-610)', () => {
  test('SIL-610-C1 LCL date-only + trip plannedStartAt on the EDD day → derived instant', () => {
    // 03:30Z = 10:30 ICT on 29/10.
    const derived = deriveLegacyScheduleInstant('LCL', EDD, null, null, [
      { plannedStartAt: new Date('2026-10-29T03:30:00.000Z'), plannedEndAt: new Date('2026-10-29T05:30:00.000Z') },
    ]);
    assert.equal(derived, '2026-10-29T03:30:00.000Z');
  });

  test('SIL-610-C1 ICT day boundary: 17:00Z previous day = 00:00 ICT on the EDD → derived', () => {
    const derived = deriveLegacyScheduleInstant('LCL', EDD, null, null, [
      { plannedStartAt: new Date('2026-10-28T17:00:00.000Z'), plannedEndAt: null },
    ]);
    assert.equal(derived, '2026-10-28T17:00:00.000Z');
  });

  test('SIL-610-C2 FCL never derives, even with a same-day trip', () => {
    const derived = deriveLegacyScheduleInstant('FCL', EDD, null, null, [
      { plannedStartAt: new Date('2026-10-29T03:30:00.000Z'), plannedEndAt: null },
    ]);
    assert.equal(derived, null);
  });

  test('SIL-610-C2 a stored closingAt or plannedReturnAt wins — no derivation', () => {
    const trip = [{ plannedStartAt: new Date('2026-10-29T03:30:00.000Z'), plannedEndAt: null }];
    assert.equal(deriveLegacyScheduleInstant('LCL', EDD, new Date('2026-10-29T04:00:00.000Z'), null, trip), null);
    assert.equal(deriveLegacyScheduleInstant('LCL', EDD, null, new Date('2026-10-29T04:00:00.000Z'), trip), null);
  });

  test('SIL-610-C2 no EDD, no trips, or trips on another day → null (date-only display stays)', () => {
    const otherDay = [{ plannedStartAt: new Date('2026-10-30T03:30:00.000Z'), plannedEndAt: null }];
    assert.equal(deriveLegacyScheduleInstant('LCL', null, null, null, otherDay), null);
    assert.equal(deriveLegacyScheduleInstant('LCL', EDD, null, null, []), null);
    assert.equal(deriveLegacyScheduleInstant('LCL', EDD, null, null, otherDay), null);
  });

  test('SIL-610-C3 plannedStartAt null falls back to plannedEndAt; earliest promised-day instant wins', () => {
    const derived = deriveLegacyScheduleInstant('LCL', EDD, null, null, [
      { plannedStartAt: null, plannedEndAt: new Date('2026-10-29T07:00:00.000Z') },
      { plannedStartAt: new Date('2026-10-29T02:00:00.000Z'), plannedEndAt: null },
    ]);
    assert.equal(derived, '2026-10-29T02:00:00.000Z');
  });

  test('SIL-610-C3 a trip whose window ENDS on the promised day still yields that end instant', () => {
    // Departs 17:00 ICT on 28/10, ends 03:00 ICT on the promised 29/10.
    const derived = deriveLegacyScheduleInstant('LCL', EDD, null, null, [
      {
        plannedStartAt: new Date('2026-10-28T10:00:00.000Z'),
        plannedEndAt: new Date('2026-10-28T20:00:00.000Z'),
      },
    ]);
    assert.equal(derived, '2026-10-28T20:00:00.000Z');
  });

  test('SIL-610-C2 a trip that ran on another day yields nothing (no invented day/time)', () => {
    // Whole window on 28/10 ICT — the promised 29/10 has no recorded time.
    const derived = deriveLegacyScheduleInstant('LCL', EDD, null, null, [
      {
        plannedStartAt: new Date('2026-10-28T10:00:00.000Z'),
        plannedEndAt: new Date('2026-10-28T14:00:00.000Z'),
      },
    ]);
    assert.equal(derived, null);
  });

  test('SIL-610-C3 trips with neither instant are ignored', () => {
    const derived = deriveLegacyScheduleInstant('LCL', EDD, null, null, [
      { plannedStartAt: null, plannedEndAt: null },
    ]);
    assert.equal(derived, null);
  });
});
