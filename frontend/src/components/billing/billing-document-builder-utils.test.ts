import { describe, expect, it } from 'vitest';
import type { BillingDocumentLine } from '@tingting/shared';
import { normalizeFreightDescription } from './billing-document-builder-utils';

const line = (description: string): BillingDocumentLine => ({
  sourceType: 'TRIP',
  sourceId: 27,
  lineType: 'FREIGHT',
  typeLabel: 'Cước vận chuyển',
  unit: 'chuyến',
  description,
  routeName: 'Hải Phòng — KCN Quế Võ, Bắc Ninh',
  baseAmount: 7_538_400,
  sortOrder: 0,
});

describe('normalizeFreightDescription', () => {
  it('migrates a legacy generated trip-code description to the route', () => {
    expect(normalizeFreightDescription(line('Cước vận chuyển (TRP-202606-0027)')).description)
      .toBe('Cước vận chuyển — Hải Phòng — KCN Quế Võ, Bắc Ninh');
  });

  it('keeps an accountant-authored description unchanged', () => {
    expect(normalizeFreightDescription(line('Cước vận chuyển theo báo giá riêng')).description)
      .toBe('Cước vận chuyển theo báo giá riêng');
  });
});
