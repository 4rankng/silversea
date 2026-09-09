import { describe, expect, it } from 'vitest';
import type { ShipmentCusWorkspaceContainerLine } from '@tingting/shared';
import type { ShipmentListItem } from '../../../api/shipmentClient';

import {
  buildInitialDayGroups,
  formatContainerCounts,
  formatLocalDateVi,
  formatShortDateVi,
  formatWeekdayVi,
  isNamedDateKey,
  parseContainerSummaryDemand,
  syncDayGroupsWithContainers,
  toEmptyRow,
  validateDayGroups,
  type AllocationDayGroup,
} from './allocationDayHelpers';
import { carrierOptionKey } from '../../../components/shipment/CarrierAllocationSummary';

const shipment = (overrides: Partial<ShipmentListItem> = {}): ShipmentListItem => ({
  id: 1,
  shipmentCode: 'SS-000100',
  version: 4,
  customerName: 'Công ty ABC',
  blNumber: 'BL-2026-001',
  bookingRef: null,
  containerCount20: 2,
  containerCount40: 2,
  containerTypeSummary: '2 x 40HC + 2 x 20DC',
  totalCargoWeightKg: null,
  allocationStatus: 'NOT_ALLOCATED',
  carrierAllocationSummary: [],
  ...overrides,
} as ShipmentListItem);

const option = (over: Partial<{
  key: string;
  label: string;
  carrierType: 'OWN' | 'EXTERNAL';
  externalCarrierId: number | null;
  isActive?: boolean;
}> = {}) => ({
  key: 'EXTERNAL:77',
  label: 'HÀ AN',
  carrierType: 'EXTERNAL' as const,
  externalCarrierId: 77,
  isActive: true,
  ...over,
});

const haAn = option();
const ownOption = option({
  key: 'OWN',
  label: 'SilverSea',
  carrierType: 'OWN' as const,
  externalCarrierId: null,
});
const options = [haAn, ownOption];

const row = (carrierKey: string, count20 = '', count40 = '') => ({
  key: carrierKey,
  carrierKey,
  count20,
  count40,
});

const day = (
  dateKey: string,
  demand: { count20: number; count40: number },
  rows: Array<{ carrierKey: string; count20: string; count40: string }>,
): AllocationDayGroup => ({
  dateKey,
  dateLabel: formatLocalDateVi(dateKey),
  demand,
  rows: rows.map((r) => ({ ...r, key: crypto.randomUUID() })),
});

// Only the fields syncDayGroupsWithContainers reads; appointment instants are
// pinned to +07-friendly UTC hours so the business-zone local date is stable.
const containerLine = (over: Partial<ShipmentCusWorkspaceContainerLine> = {}): ShipmentCusWorkspaceContainerLine => ({
  customerAppointmentAt: null,
  containerTypeLabel: '40HC',
  carrierType: null,
  externalCarrierId: null,
  ...over,
} as ShipmentCusWorkspaceContainerLine);

describe('allocationDayHelpers — date/label formatting', () => {
  it('maps named date keys to DD/MM/YYYY and sentinel keys to Chưa chốt ngày đóng/trả', () => {
    expect(formatLocalDateVi('2026-09-10')).toBe('10/09/2026');
    expect(formatLocalDateVi('__UNSCHEDULED__')).toBe('Chưa chốt ngày đóng/trả');
    expect(formatLocalDateVi('__ALL__')).toBe('Chưa chốt ngày đóng/trả');
    expect(formatLocalDateVi(null)).toBe('Chưa chốt ngày đóng/trả');
    expect(formatLocalDateVi(undefined)).toBe('Chưa chốt ngày đóng/trả');
  });

  it('returns unrecognized keys unchanged instead of guessing a format', () => {
    expect(formatLocalDateVi('20/09/2026')).toBe('20/09/2026');
  });

  it('classifies named vs sentinel date keys', () => {
    expect(isNamedDateKey('2026-09-10')).toBe(true);
    expect(isNamedDateKey('__UNSCHEDULED__')).toBe(false);
    expect(isNamedDateKey('__ALL__')).toBe(false);
  });

  it('formats compact per-row dates with an em-dash for sentinels', () => {
    expect(formatShortDateVi('2026-09-10')).toBe('10/09');
    expect(formatShortDateVi('__UNSCHEDULED__')).toBe('—');
    expect(formatShortDateVi(null)).toBe('—');
    expect(formatShortDateVi(undefined)).toBe('—');
  });

  it('formats vi-VN weekday headers from the calendar date, empty for sentinels', () => {
    expect(formatWeekdayVi('2026-09-10')).toBe('Thứ Năm');
    expect(formatWeekdayVi('__UNSCHEDULED__')).toBe('');
    expect(formatWeekdayVi(null)).toBe('');
    expect(formatWeekdayVi('not-a-date')).toBe('');
  });

  it('formats container-count strings, dropping zero parts and collapsing to 0', () => {
    expect(formatContainerCounts({ count20: 1, count40: 2 })).toBe("1×20' + 2×40'");
    expect(formatContainerCounts({ count20: 2, count40: 0 })).toBe("2×20'");
    expect(formatContainerCounts({ count20: 0, count40: 2 })).toBe("2×40'");
    expect(formatContainerCounts({ count20: 0, count40: 0 })).toBe('0');
  });

  it('parses containerSummary demand strings into 20/40 counts', () => {
    expect(parseContainerSummaryDemand("1*20DC + 2×40HC")).toEqual({ count20: 1, count40: 2 });
    expect(parseContainerSummaryDemand("2 x 40HC")).toEqual({ count20: 0, count40: 2 });
    expect(parseContainerSummaryDemand("1×20'")).toEqual({ count20: 1, count40: 0 });
    expect(parseContainerSummaryDemand(null)).toEqual({ count20: 0, count40: 0 });
    expect(parseContainerSummaryDemand('Chưa phân loại')).toEqual({ count20: 0, count40: 0 });
  });

  it('defaults new rows to the own-fleet carrier key', () => {
    expect(toEmptyRow().carrierKey).toBe('OWN');
    expect(toEmptyRow('EXTERNAL:77').carrierKey).toBe('EXTERNAL:77');
    expect(carrierOptionKey('EXTERNAL', 77)).toBe('EXTERNAL:77');
    expect(carrierOptionKey('OWN', null)).toBe('OWN');
  });
});

describe('allocationDayHelpers — buildInitialDayGroups', () => {
  it('buckets appointment groups per day with per-day demand and factory names', () => {
    const groups = buildInitialDayGroups(shipment({
      containerCount20: 1,
      containerCount40: 2,
      appointmentGroups: [
        { at: '2026-09-08T02:00:00.000Z', localDate: '2026-09-08', containerSummary: "1×20'", factoryName: 'Nhà máy A', factoryShortName: 'Nhà máy A', factoryFullName: null },
        { at: '2026-09-09T02:00:00.000Z', localDate: '2026-09-09', containerSummary: '2×40HC', factoryName: 'Nhà máy B', factoryShortName: 'Nhà máy B', factoryFullName: null },
      ],
    }));

    expect(groups.map((g) => g.dateKey)).toEqual(['2026-09-08', '2026-09-09']);
    expect(groups[0]!.dateLabel).toBe('08/09/2026');
    expect(groups[0]!.factoryName).toBe('Nhà máy A');
    expect(groups[0]!.demand).toEqual({ count20: 1, count40: 0 });
    expect(groups[1]!.demand).toEqual({ count20: 0, count40: 2 });
    expect(groups.every((g) => g.rows.length === 1 && g.rows[0]!.carrierKey === 'OWN')).toBe(true);
  });

  it('appends a Chưa chốt ngày group for containers the appointment groups do not cover', () => {
    const groups = buildInitialDayGroups(shipment({
      containerCount20: 2,
      containerCount40: 0,
      appointmentGroups: [
        { at: '2026-09-08T02:00:00.000Z', localDate: '2026-09-08', containerSummary: "1×20'", factoryName: 'Nhà máy A', factoryShortName: null, factoryFullName: null },
      ],
    }));

    expect(groups.map((g) => g.dateKey)).toEqual(['2026-09-08', '__UNSCHEDULED__']);
    expect(groups[1]!.dateLabel).toBe('Chưa chốt ngày đóng/trả');
    expect(groups[1]!.demand).toEqual({ count20: 1, count40: 0 });
    expect(groups[1]!.factoryName).toBeUndefined();
  });

  it('prefills carrier rows from the allocation summary when a single day covers the lot', () => {
    const groups = buildInitialDayGroups(shipment({
      containerCount20: 1,
      containerCount40: 2,
      appointmentGroups: [
        { at: '2026-09-08T02:00:00.000Z', localDate: '2026-09-08', containerSummary: "1×20' + 2×40HC", factoryName: null, factoryShortName: null, factoryFullName: null },
      ],
      carrierAllocationSummary: [
        { carrierType: 'EXTERNAL', externalCarrierId: 77, carrierLabel: 'HÀ AN', count20: 1, count40: 0 },
        { carrierType: 'OWN', externalCarrierId: null, carrierLabel: 'SilverSea', count20: 0, count40: 2 },
      ],
    }));

    expect(groups).toHaveLength(1);
    expect(groups[0]!.demand).toEqual({ count20: 1, count40: 2 });
    expect(groups[0]!.rows).toEqual([
      expect.objectContaining({ carrierKey: 'EXTERNAL:77', count20: '1', count40: '' }),
      expect.objectContaining({ carrierKey: 'OWN', count20: '', count40: '2' }),
    ]);
  });

  it('falls back to a single Toàn bộ lô hàng group when nothing is scheduled', () => {
    const groups = buildInitialDayGroups(shipment());

    expect(groups).toHaveLength(1);
    expect(groups[0]!.dateKey).toBe('__ALL__');
    expect(groups[0]!.dateLabel).toBe('Toàn bộ lô hàng');
    expect(groups[0]!.demand).toEqual({ count20: 2, count40: 2 });
  });

  it('labels the fallback group with the expected delivery date when present', () => {
    const groups = buildInitialDayGroups(shipment({ expectedDeliveryDate: '2026-09-10' }));

    expect(groups[0]!.dateKey).toBe('__ALL__');
    expect(groups[0]!.dateLabel).toBe('10/09/2026');
  });
});

describe('allocationDayHelpers — syncDayGroupsWithContainers', () => {
  it('buckets containers per business-zone local date with Chưa chốt ngày last', () => {
    const groups = syncDayGroupsWithContainers([
      containerLine({ customerAppointmentAt: '2026-09-08T02:00:00.000Z', containerTypeLabel: '20DC' }),
      containerLine({ customerAppointmentAt: '2026-09-09T02:00:00.000Z', containerTypeLabel: '40HC' }),
      containerLine({ customerAppointmentAt: null }),
    ]);

    expect(groups.map((g) => g.dateKey)).toEqual(['2026-09-08', '2026-09-09', '__UNSCHEDULED__']);
    expect(groups[0]!.demand).toEqual({ count20: 1, count40: 0 });
    expect(groups[1]!.demand).toEqual({ count20: 0, count40: 1 });
    // An unlabeled container still lands on a day, counted as a 40'.
    expect(groups[2]!.demand).toEqual({ count20: 0, count40: 1 });
    expect(groups[2]!.dateLabel).toBe('Chưa chốt ngày đóng/trả');
  });

  it('seeds one row per carrier already assigned on the day, with its container counts', () => {
    const groups = syncDayGroupsWithContainers([
      containerLine({
        customerAppointmentAt: '2026-09-08T02:00:00.000Z',
        containerTypeLabel: '20DC',
        carrierType: 'OWN',
      }),
      containerLine({
        customerAppointmentAt: '2026-09-08T02:00:00.000Z',
        containerTypeLabel: '40HC',
        carrierType: 'EXTERNAL',
        externalCarrierId: 77,
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.demand).toEqual({ count20: 1, count40: 1 });
    expect(groups[0]!.rows).toEqual([
      expect.objectContaining({ carrierKey: 'OWN', count20: '1', count40: '' }),
      expect.objectContaining({ carrierKey: 'EXTERNAL:77', count20: '', count40: '1' }),
    ]);
  });

  it('returns no groups when the lot has no container lines', () => {
    expect(syncDayGroupsWithContainers([])).toEqual([]);
  });
});

describe('allocationDayHelpers — validateDayGroups', () => {
  it('accepts exact fills and lets the same carrier serve different days without a duplicate error', () => {
    // TC-DV-DISPATCH-043 regression shape: one carrier may appear once per day.
    const result = validateDayGroups([
      day('2026-09-08', { count20: 1, count40: 0 }, [row('EXTERNAL:77', '1')]),
      day('2026-09-09', { count20: 0, count40: 2 }, [row('EXTERNAL:77', '', '2')]),
    ], { count20: 1, count40: 2 }, options);

    expect(result.hasErrors).toBe(false);
    expect(result.overallState).toBe('complete');
    expect(result.dayResults.map((d) => d.state)).toEqual(['complete', 'complete']);
    expect(result.totalAssigned20).toBe(1);
    expect(result.totalAssigned40).toBe(2);
    expect(result.totalRemaining20).toBe(0);
    expect(result.totalRemaining40).toBe(0);
    expect(result.allErrors).toEqual([]);
  });

  it('flags over-allocation on the offending day only, with the date-prefixed error', () => {
    const result = validateDayGroups([
      day('2026-09-08', { count20: 1, count40: 0 }, [row('EXTERNAL:77', '2')]),
      day('2026-09-09', { count20: 0, count40: 2 }, [row('EXTERNAL:77', '', '2')]),
    ], { count20: 1, count40: 2 }, options);

    expect(result.hasErrors).toBe(true);
    expect(result.overallState).toBe('error');
    expect(result.dayResults[0]!.state).toBe('error');
    expect(result.dayResults[0]!.isOver).toBe(true);
    expect(result.dayResults[0]!.remaining20).toBe(-1);
    expect(result.dayResults[0]!.errors).toEqual(["08/09/2026: Container 20' vượt số lượng: gán 2/1."]);
    expect(result.dayResults[0]!.rowIssues[0]!.count20).toBe("Tổng đang vượt 1 container 20'.");
    // The other day is untouched by its sibling's mistake.
    expect(result.dayResults[1]!.state).toBe('complete');
    expect(result.allErrors).toEqual(["08/09/2026: Container 20' vượt số lượng: gán 2/1."]);
  });

  it('marks under-allocated days partial and keeps the overall state partial', () => {
    const result = validateDayGroups([
      day('2026-09-08', { count20: 1, count40: 0 }, [row('EXTERNAL:77', '')]),
      day('2026-09-09', { count20: 0, count40: 2 }, [row('EXTERNAL:77', '', '2')]),
    ], { count20: 1, count40: 2 }, options);

    expect(result.hasErrors).toBe(false);
    expect(result.overallState).toBe('partial');
    expect(result.dayResults[0]!.state).toBe('partial');
    expect(result.dayResults[0]!.remaining20).toBe(1);
  });

  it('flags a carrier repeated within one day, wording adjusted per lot shape', () => {
    const multiDay = validateDayGroups([
      day('2026-09-08', { count20: 2, count40: 0 }, [
        row('EXTERNAL:77', '1'),
        row('EXTERNAL:77', '1'),
      ]),
      day('2026-09-09', { count20: 0, count40: 2 }, [row('EXTERNAL:77', '', '2')]),
    ], { count20: 2, count40: 2 }, options);

    expect(multiDay.hasErrors).toBe(true);
    expect(multiDay.dayResults[0]!.state).toBe('error');
    expect(multiDay.dayResults[0]!.rowIssues.every((issue) => issue.carrier === 'Nhà xe này đang bị lặp trong ngày này.')).toBe(true);
    expect(multiDay.allErrors).toEqual([
      '08/09/2026: Nhà xe "HÀ AN" đang bị lặp. Mỗi nhà xe chỉ được nhập một dòng trong một ngày.',
    ]);

    const singleDay = validateDayGroups([
      day('__ALL__', { count20: 2, count40: 0 }, [
        row('EXTERNAL:77', '1'),
        row('EXTERNAL:77', '1'),
      ]),
    ], { count20: 2, count40: 0 }, options);

    expect(singleDay.dayResults[0]!.rowIssues.every((issue) => issue.carrier === 'Nhà xe này đã có ở một dòng khác.')).toBe(true);
    expect(singleDay.allErrors).toEqual([
      'Nhà xe "HÀ AN" đang bị lặp. Mỗi nhà xe chỉ được nhập một dòng.',
    ]);
  });

  it('flags invalid counts, unknown carriers, and inactive carriers per row', () => {
    const result = validateDayGroups([
      day('2026-09-08', { count20: 1, count40: 1 }, [
        row('EXTERNAL:999', 'abc', ''),
        row('EXTERNAL:77', '1', '1'),
      ]),
      day('__INACTIVE_DAY__', { count20: 0, count40: 0 }, [row('EXTERNAL:88', '', '')]),
    ], { count20: 1, count40: 1 }, [
      haAn,
      option({ key: 'EXTERNAL:88', label: 'Nam Phong', externalCarrierId: 88, isActive: false }),
    ]);

    expect(result.dayResults[0]!.rowIssues[0]).toEqual({
      carrier: 'Chọn một nhà xe hợp lệ.',
      count20: 'Nhập số nguyên từ 0 trở lên.',
      count40: null,
    });
    expect(result.dayResults[1]!.rowIssues[0]!.carrier).toBe('Nhà xe này đang ngưng hoạt động.');
  });
});
