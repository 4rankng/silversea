import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Supplier, Tire, TirePosition } from '@tingting/shared';
import {
  buildPositionLabels,
  patchFromDraft,
  positionPayloadFromLabel,
  supplierIdFromText,
  textMatches,
  daysBetween,
  todayISO,
} from './tireUtils';

describe('tireUtils', () => {
  afterEach(() => vi.useRealTimers());

  it('uses Vietnam calendar days around midnight regardless of browser timezone', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-14T16:59:59Z'));
    expect(todayISO()).toBe('2026-09-14');
    expect(daysBetween('2026-09-14')).toBe(0);
    vi.setSystemTime(new Date('2026-09-14T17:00:00Z'));
    expect(todayISO()).toBe('2026-09-15');
    expect(daysBetween('2026-09-14')).toBe(1);
    expect(daysBetween('2026-09-15', '2026-09-15')).toBe(0);
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2);
    expect(daysBetween('bad-date')).toBeNull();
  });
  it('matches Vietnamese text regardless of case and accents', () => {
    expect(textMatches('Trước trái', 'truoc')).toBe(true);
    expect(textMatches('Đuôi phải', 'duoi')).toBe(true);
    expect(textMatches('Trục nâng giữa', 'NANG GIUA')).toBe(true);
  });

  it('cleans blank and spaced position labels for payloads', () => {
    expect(positionPayloadFromLabel('  Trước   trái  ')).toEqual({ position: 'Trước trái' });
    expect(positionPayloadFromLabel('   ')).toEqual({ position: null });
  });

  it('combines catalog and used tire positions with sorting and dedupe', () => {
    const tirePositions = [
      { id: 2, name: 'Sau phải', sortOrder: 20 },
      { id: 1, name: 'Trước trái', sortOrder: 10 },
    ] as TirePosition[];
    const tires = [
      { position: 'Sau phải' },
      { position: '  Trục nâng  ' },
    ] as Tire[];

    expect(buildPositionLabels(tires, tirePositions)).toEqual(['Trước trái', 'Sau phải', 'Trục nâng']);
    expect(tirePositions.map(position => position.id)).toEqual([2, 1]);
  });

  it('resolves suppliers by trimmed case-insensitive label and builds draft patches', () => {
    const suppliers = [
      { id: 7, name: 'Lốp Miền Nam' },
      { id: 9, name: 'Nhà cung cấp khác' },
    ] as Supplier[];

    expect(supplierIdFromText(suppliers, '  lốp miền nam ')).toBe(7);
    expect(supplierIdFromText(suppliers, '')).toBeNull();
    expect(patchFromDraft({
      serial: ' ABC123 ',
      position: '  Trước trái ',
      size: ' 11R22.5 ',
      installedAt: '',
      supplierText: 'Lốp Miền Nam',
      purchasedAt: '',
    }, suppliers)).toEqual({
      serial: 'ABC123',
      position: 'Trước trái',
      size: '11R22.5',
      installedAt: null,
      supplierId: 7,
      purchasedAt: null,
    });
  });
});
