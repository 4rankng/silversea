import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { filterContainersByDateRange } from './container-date-filter';

describe('filterContainersByDateRange', () => {
  const makeContainer = (appointmentAt: string | null) => ({
    customerAppointmentAt: appointmentAt ? new Date(appointmentAt) : null,
    // Extra fields should be preserved.
    shipmentId: 1,
    containerTypeCode: '40HC',
  });

  const containers = [
    makeContainer('2026-08-19T17:00:00.000Z'), // → 2026-08-20 local
    makeContainer('2026-08-20T02:00:00.000Z'), // → 2026-08-20 local
    makeContainer('2026-08-21T10:00:00.000Z'), // → 2026-08-21 local
    makeContainer('2026-08-22T01:00:00.000Z'), // → 2026-08-22 local
    makeContainer(null),                         // no appointment
  ];
  // Range-active counts below EXCLUDE the last (undated) row: SIL-588 (id 688,
  // khách 29/10) supersedes card 231026000252's "undated = luôn hiện" lane —
  // an undated row has no day the range names, so the scoped counts drop it
  // exactly like the row law `shipmentTransportDateCondition` drops its lot,
  // and it returns the moment the range is cleared.

  it('returns all containers when no date range is active', () => {
    const result = filterContainersByDateRange(containers, undefined, undefined);
    assert.equal(result.length, 5);
    assert.equal(result, containers); // same reference
  });

  it('returns all containers when both bounds are null', () => {
    const result = filterContainersByDateRange(containers, null, null);
    assert.equal(result.length, 5);
    assert.equal(result, containers);
  });

  it('filters by dateFrom only', () => {
    const result = filterContainersByDateRange(containers, '2026-08-21', undefined);
    assert.equal(result.length, 2); // 08-21, 08-22 — undated drops (SIL-588)
    assert.equal(result[0].containerTypeCode, '40HC');
  });

  it('filters by dateTo only', () => {
    const result = filterContainersByDateRange(containers, undefined, '2026-08-20');
    assert.equal(result.length, 2); // 2 x 08-20 — undated drops (SIL-588)
  });

  it('filters by both dateFrom and dateTo (inclusive)', () => {
    const result = filterContainersByDateRange(containers, '2026-08-20', '2026-08-20');
    assert.equal(result.length, 2); // 2 x 08-20 — undated drops (SIL-588)
  });

  it('filters a wider range', () => {
    const result = filterContainersByDateRange(containers, '2026-08-20', '2026-08-21');
    assert.equal(result.length, 3); // 3 dated — undated drops (SIL-588)
  });

  it('SIL-588 pin: drops containers with no appointment and no fallback when a range is active', () => {
    // Such a row has no day the range could match — the same law the row
    // filter `shipmentTransportDateCondition` applies to its lot (previously
    // kept by card 231026000252's "undated = luôn hiện" lane).
    const onlyNull = [makeContainer(null)];
    const result = filterContainersByDateRange(onlyNull, '2026-08-20', '2026-08-20');
    assert.equal(result.length, 0);
  });

  it('returns undated containers when the range is cleared', () => {
    // The drop is bound to the active range only: the no-filter path keeps
    // the full set (same reference), undated rows included.
    const onlyNull = [makeContainer(null)];
    assert.equal(filterContainersByDateRange(onlyNull, undefined, undefined).length, 1);
    assert.equal(filterContainersByDateRange(onlyNull, undefined, '2026-08-20').length, 0);
    assert.equal(filterContainersByDateRange(onlyNull, '2026-08-20', undefined).length, 0);
  });

  it('keeps undated containers whose fallback date is inside the range', () => {
    const onlyNull = [makeContainer(null)];
    const result = filterContainersByDateRange(onlyNull, '2026-08-20', '2026-08-20', () => '2026-08-20');
    assert.equal(result.length, 1);
  });

  it('drops undated containers whose fallback date is outside the range', () => {
    const onlyNull = [makeContainer(null)];
    const result = filterContainersByDateRange(onlyNull, '2026-08-20', '2026-08-20', () => '2026-09-10');
    assert.equal(result.length, 0);
  });

  it('SIL-588 pin: drops undated containers when the fallback resolver yields null', () => {
    // null fallback = no day at all = the undated lane — it DROPS under an
    // active range (previously kept by card 231026000252's null lane).
    const onlyNull = [makeContainer(null)];
    const result = filterContainersByDateRange(onlyNull, '2026-08-20', '2026-08-20', () => null);
    assert.equal(result.length, 0);
  });

  it('prefers the real appointment over the fallback date', () => {
    const dated = [makeContainer('2026-08-21T10:00:00.000Z')]; // → 2026-08-21 local
    const result = filterContainersByDateRange(dated, '2026-08-20', '2026-08-20', () => '2026-08-20');
    assert.equal(result.length, 0);
  });

  it('returns empty when no containers match the range', () => {
    const datedOnly = containers.slice(0, 4); // dated rows only — isolates the dated out-range law
    const result = filterContainersByDateRange(datedOnly, '2027-01-01', '2027-01-31');
    assert.equal(result.length, 0);
  });

  it('preserves extra properties on container objects', () => {
    const result = filterContainersByDateRange(containers, '2026-08-20', '2026-08-20');
    assert.equal(result[0].shipmentId, 1);
    assert.equal(result[0].containerTypeCode, '40HC');
  });
});

/**
 * The four named law cases of card 231026000252, one `it()` each — with the
 * card's null lane superseded by SIL-588 (id 688, khách 29/10): a row's day
 * is coalesce(appointment, fallback EDD) — the pure twin of the workboard's
 * `containerTransportDateSql()` — so the two row shapes map exactly:
 *   "LCL dated"  = day from the fallback leg  (container-less LCL lot row,
 *                  whose day is the lot transportDate/EDD);
 *   "cont dated" = day from the appointment   (a container row).
 * An undated row (both legs null) drops under an active range and returns
 * when the range is cleared — the scoped-count mirror of the lot-level row
 * law pinned in backend/src/tests/unit/shipment-transport-date-condition.test.ts
 * (SIL-588) and the container triage in cus-container-day-triage.test.ts.
 */
describe('day law — card 231026000252, null lane superseded by SIL-588 (LCL dated in/out-range, LCL undated, cont dated)', () => {
  /** Container-less LCL lot row shape: no appointment leg, day = lot EDD. */
  interface LclLotRow {
    customerAppointmentAt: Date | null;
    lot: { transportDate: string | null };
  }
  const rows = (transportDate: string | null): LclLotRow[] => [{ customerAppointmentAt: null, lot: { transportDate } }];

  it('LCL dated in-range: the lot EDD leg passes the filter', () => {
    const result = filterContainersByDateRange(
      rows('2026-10-17'), '2026-10-17', '2026-10-17', (r) => r.lot.transportDate,
    );
    assert.equal(result.length, 1);
  });

  it('LCL dated out-range: a dated LCL row is filtered out like a cont row', () => {
    // THE card symptom: transportDate=2026-10-17 must not survive 23/10..23/10
    // (lot K547238574983).
    const result = filterContainersByDateRange(
      rows('2026-10-17'), '2026-10-23', '2026-10-23', (r) => r.lot.transportDate,
    );
    assert.equal(result.length, 0);
  });

  it('SIL-588 pin — LCL undated: drops under an active range, returns when cleared', () => {
    // No day at all (no appointment, null fallback): under an ACTIVE range it
    // matches nothing and drops; the no-filter path keeps it visible.
    for (const [from, to] of [
      ['2026-10-23', '2026-10-23'],
      ['2026-10-17', '2026-10-17'],
    ] as const) {
      const result = filterContainersByDateRange(rows(null), from, to, (r) => r.lot.transportDate);
      assert.equal(result.length, 0, `undated must drop under ${from}..${to}`);
    }
    assert.equal(
      filterContainersByDateRange(rows(null), undefined, undefined, (r) => r.lot.transportDate).length,
      1,
      'undated must return when the range is cleared',
    );
  });

  it('cont dated: appointment rows filter by their appointment day', () => {
    const rows = [{
      customerAppointmentAt: new Date('2026-10-16T17:00:00.000Z'), // → 2026-10-17 VN
    }];
    assert.equal(filterContainersByDateRange(rows, '2026-10-17', '2026-10-17').length, 1);
    assert.equal(filterContainersByDateRange(rows, '2026-10-23', '2026-10-23').length, 0);
  });
});
