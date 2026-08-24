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
    assert.equal(result.length, 2);
    assert.equal(result[0].containerTypeCode, '40HC');
  });

  it('filters by dateTo only', () => {
    const result = filterContainersByDateRange(containers, undefined, '2026-08-20');
    assert.equal(result.length, 2);
  });

  it('filters by both dateFrom and dateTo (inclusive)', () => {
    const result = filterContainersByDateRange(containers, '2026-08-20', '2026-08-20');
    assert.equal(result.length, 2);
  });

  it('filters a wider range', () => {
    const result = filterContainersByDateRange(containers, '2026-08-20', '2026-08-21');
    assert.equal(result.length, 3);
  });

  it('excludes containers with no appointment when a range is active', () => {
    const onlyNull = [makeContainer(null)];
    const result = filterContainersByDateRange(onlyNull, '2026-08-20', '2026-08-20');
    assert.equal(result.length, 0);
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

  it('drops undated containers when the fallback resolver yields null', () => {
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
    const result = filterContainersByDateRange(containers, '2027-01-01', '2027-01-31');
    assert.equal(result.length, 0);
  });

  it('preserves extra properties on container objects', () => {
    const result = filterContainersByDateRange(containers, '2026-08-20', '2026-08-20');
    assert.equal(result[0].shipmentId, 1);
    assert.equal(result[0].containerTypeCode, '40HC');
  });
});
