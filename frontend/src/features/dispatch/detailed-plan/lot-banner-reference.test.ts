import { describe, expect, it } from 'vitest';
import { lotBannerReference } from './useDispatchDetailPlan';
import type { DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';

/**
 * QA 28/11 finding 04 — the dispatch save banner names the lot the way the
 * dispatcher searched for it. The internal SHP code may only appear when the
 * row carries no business reference at all.
 */
function rowWith(docs: Partial<DispatchDetailPlanRow['docs']>, overrides: Partial<DispatchDetailPlanRow> = {}): DispatchDetailPlanRow {
  return {
    shipmentId: 901,
    shipmentCode: 'SHP-2611-00901',
    docs: { billNumber: null, tradeDirection: 'EXPORT', declarationNumbers: [], ...docs },
    ...overrides,
  } as DispatchDetailPlanRow;
}

describe('lotBannerReference (QA 28/11 finding 04)', () => {
  it('prefers the bill number', () => {
    expect(lotBannerReference(rowWith({ billNumber: 'QA-E2E-1128-28265' }))).toBe('QA-E2E-1128-28265');
  });

  it('falls back to the booking for booking-only EXPORT lots — never the SHP code', () => {
    expect(lotBannerReference(rowWith({ bookingRef: 'QABK-1128-M' }))).toBe('QABK-1128-M');
  });

  it('shows the shared placeholder when the row carries no business reference — never the SHP code', () => {
    expect(lotBannerReference(rowWith({}))).toBe('Chưa có số Bill/Booking');
  });
});
