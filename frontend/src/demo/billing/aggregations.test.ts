/**
 * SIL-160: AR/AP aggregation math pinned against the demo seed fixtures —
 * kỳ filter, row ordering, AR tổng hợp and the AP cấn trừ formula
 * (thực trả = cước − UNC chi hộ, driver-cash fees excluded).
 */
import { describe, expect, it } from 'vitest';
import {
  apSheetFor,
  arSheetFor,
  contKindLabel,
  demoDefaultMonth,
  uncVndOfTrip,
} from './aggregations';
import { demoTrips } from '../data/seed';

describe('demo billing — kỳ mặc định', () => {
  it('picks the month with the most seed trips (2026-10)', () => {
    expect(demoDefaultMonth()).toBe('2026-10');
  });
});

describe('demo billing — AR phải thu khách hàng', () => {
  it('aggregates Samsung 2026-10 from fixtures: 3 chuyến, 14.100.000 VND', () => {
    const sheet = arSheetFor('SAM', '2026-10');
    expect(sheet.tripCount).toBe(3);
    expect(sheet.totalVnd).toBe(14_100_000);
    expect(sheet.rows.map((r) => r.tripId)).toEqual(['T-2301', 'T-2401', 'T-2414']);
  });

  it('mixes in-house and vendor trips — the customer owes for both', () => {
    const sheet = arSheetFor('SAM', '2026-10');
    expect(sheet.rows.map((r) => r.freightVnd)).toEqual([4_800_000, 4_800_000, 4_500_000]);
  });

  it('sorts rows by date then trip code', () => {
    const sheet = arSheetFor('CTP', '2026-10');
    expect(sheet.rows.map((r) => r.tripId)).toEqual(['T-2403', 'T-2404', 'T-2408', 'T-2416']);
    expect(sheet.totalVnd).toBe(14_600_000);
  });

  it('returns an empty sheet for a month without trips', () => {
    const sheet = arSheetFor('SAM', '2026-11');
    expect(sheet.rows).toHaveLength(0);
    expect(sheet.totalVnd).toBe(0);
  });

  it('labels cont kind as size + flow', () => {
    expect(contKindLabel(40, 'export')).toBe('40′ · Hàng xuất');
    expect(contKindLabel(20, 'import')).toBe('20′ · Hàng nhập');
  });

  it('carries booking on every row and bill when the fixture has one', () => {
    const sheet = arSheetFor('INT', '2026-10');
    const t2406 = sheet.rows.find((r) => r.tripId === 'T-2406');
    expect(t2406?.bookingNo).toBe('HLCUVN7712043');
    expect(t2406?.billNo).toBe('HLCU7712043');
  });
});

describe('demo billing — AP phải trả nhà xe ngoài (cấn trừ)', () => {
  it('computes UNC chi hộ from bank-transfer port fees only', () => {
    const trip = demoTrips.find((t) => t.id === 'T-2414')!;
    // lift 40′ 2.150.000 + drop 40′ 1.850.000, both method 'unc'.
    expect(uncVndOfTrip(trip)).toBe(4_000_000);
  });

  it('excludes driver-cash fees from the deduction (T-2416)', () => {
    const trip = demoTrips.find((t) => t.id === 'T-2416')!;
    // lift is driver-cash (hoàn ứng lane); only drop UNC 1.850.000 counts.
    expect(uncVndOfTrip(trip)).toBe(1_850_000);
  });

  it('applies thực trả = cước − UNC per row for Nam Hải', () => {
    const sheet = apSheetFor('VND-01', '2026-10');
    expect(sheet.tripCount).toBe(2);
    expect(sheet.rows.map((r) => r.tripId)).toEqual(['T-2414', 'T-2415']);
    expect(sheet.rows[0]).toMatchObject({ freightVnd: 4_500_000, uncVnd: 4_000_000, netVnd: 500_000 });
    expect(sheet.rows[1]).toMatchObject({ freightVnd: 3_600_000, uncVnd: 1_250_000, netVnd: 2_350_000 });
  });

  it('totals the three money columns independently', () => {
    const sheet = apSheetFor('VND-01', '2026-10');
    expect(sheet.totalFreightVnd).toBe(8_100_000);
    expect(sheet.totalUncVnd).toBe(5_250_000);
    expect(sheet.totalNetVnd).toBe(2_850_000);
  });

  it('keeps the deduction identity on every row of every vendor sheet', () => {
    for (const vendorId of ['VND-01', 'VND-02', 'VND-03']) {
      const sheet = apSheetFor(vendorId, '2026-10');
      for (const row of sheet.rows) {
        expect(row.netVnd).toBe(row.freightVnd - row.uncVnd);
      }
    }
  });

  it('flags rows with a deduction (unc > 0) for the amber highlight', () => {
    const sheet = apSheetFor('VND-02', '2026-10');
    expect(sheet.rows).toHaveLength(1);
    expect(sheet.rows[0].uncVnd).toBeGreaterThan(0);
    expect(sheet.rows[0].netVnd).toBe(3_050_000);
  });

  it('returns an empty sheet for a vendor without trips in the period', () => {
    const sheet = apSheetFor('VND-03', '2026-10');
    expect(sheet.rows).toHaveLength(0);
    expect(sheet.totalNetVnd).toBe(0);
  });
});
