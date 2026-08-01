import { describe, expect, it } from 'vitest';
import type { BillingDocumentLine } from '@tingting/shared';
import {
  filterAuthoritativeDebitNoteLines,
  normalizeFreightDescription,
  selectedTripIdsFromSearch,
} from './billing-document-builder-utils';

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

describe('selected Debit Note transport sources', () => {
  it('uses selectedTripIds and keeps only authoritative TRIP lines', () => {
    const tripIds = selectedTripIdsFromSearch('?selectedTripIds=27,31,27&tripIds=99');
    const otherTrip = { ...line('Chuyến khác'), sourceId: 31 };
    const expense = {
      ...line('Chi phí'),
      sourceType: 'EXPENSE' as const,
      sourceId: 88,
      renderData: { tripId: 27, sourceVersion: 'expense:1:checksum' },
    };

    expect(tripIds).toEqual([27, 31]);
    expect(filterAuthoritativeDebitNoteLines([line('Chuyến 27'), otherTrip, expense], tripIds))
      .toEqual({
        lines: [line('Chuyến 27'), otherTrip, expense],
        missingTripIds: [],
      });
  });

  it('reports selected IDs missing from the authoritative response so save can be blocked', () => {
    expect(filterAuthoritativeDebitNoteLines([line('Chuyến 27')], [27, 31]))
      .toEqual({ lines: [line('Chuyến 27')], missingTripIds: [31] });
  });
});
