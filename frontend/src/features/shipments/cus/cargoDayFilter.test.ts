// Customer feedback L2 (24/08/2026) — per-day cont aggregation
import { describe, it, expect } from 'vitest';
import {
  filterAppointmentGroupsByDate,
  aggregateContainerSummary,
} from './cargoDayFilter';

describe('filterAppointmentGroupsByDate', () => {
  const groups = [
    { at: '2026-08-20T08:00:00.000Z', localDate: '2026-08-20', containerSummary: '1x40HC' },
    { at: '2026-08-21T08:00:00.000Z', localDate: '2026-08-21', containerSummary: '1x20DC' },
    { at: '2026-08-22T08:00:00.000Z', localDate: '2026-08-22', containerSummary: '2x40HC' },
  ];

  it('returns all groups when no date filter is set', () => {
    expect(filterAppointmentGroupsByDate(groups, '', '')).toEqual(groups);
  });

  it('returns all groups when both bounds are empty strings', () => {
    expect(filterAppointmentGroupsByDate(groups, '', '').length).toBe(3);
  });

  it('filters to a single day when fromDate === toDate', () => {
    const out = filterAppointmentGroupsByDate(groups, '2026-08-21', '2026-08-21');
    expect(out).toHaveLength(1);
    expect(out[0].localDate).toBe('2026-08-21');
  });

  it('filters to a date range when fromDate < toDate', () => {
    const out = filterAppointmentGroupsByDate(groups, '2026-08-21', '2026-08-22');
    expect(out).toHaveLength(2);
    expect(out.map((g) => g.localDate)).toEqual(['2026-08-21', '2026-08-22']);
  });

  it('returns empty array for empty input', () => {
    expect(filterAppointmentGroupsByDate([], '2026-08-21', '2026-08-21')).toEqual([]);
    expect(filterAppointmentGroupsByDate(undefined, '2026-08-21', '2026-08-21')).toEqual([]);
  });
});

describe('aggregateContainerSummary', () => {
  it('aggregates same-type conts across multiple appointment groups on the same day', () => {
    const groups = [
      { at: '2026-08-21T08:00:00.000Z', localDate: '2026-08-21', containerSummary: '1x20DC' },
      { at: '2026-08-21T14:00:00.000Z', localDate: '2026-08-21', containerSummary: '1x20DC + 1x40HC' },
    ];
    const out = aggregateContainerSummary(groups);
    expect(out).toBe('2x20DC + 1x40HC');
  });

  it('keeps mixed types as separate entries', () => {
    const groups = [
      { at: '2026-08-21T08:00:00.000Z', localDate: '2026-08-21', containerSummary: '1x40HC + 1x20DC' },
    ];
    const out = aggregateContainerSummary(groups);
    expect(out).toBe('1x40HC + 1x20DC');
  });

  it('returns empty string for empty input', () => {
    expect(aggregateContainerSummary([])).toBe('');
  });

  it('skips empty / unusable summary parts', () => {
    const groups = [
      { at: '2026-08-21T08:00:00.000Z', localDate: '2026-08-21', containerSummary: '1x40HC + ' },
      { at: '2026-08-21T14:00:00.000Z', localDate: '2026-08-21', containerSummary: '' },
    ];
    expect(aggregateContainerSummary(groups)).toBe('1x40HC');
  });

  it('accepts * or × separators (rolling-deployment tolerance)', () => {
    const groups = [
      { at: '2026-08-21T08:00:00.000Z', localDate: '2026-08-21', containerSummary: '2*40HC' },
      { at: '2026-08-21T14:00:00.000Z', localDate: '2026-08-21', containerSummary: '1×20DC' },
    ];
    expect(aggregateContainerSummary(groups)).toBe('2x40HC + 1x20DC');
  });
});
