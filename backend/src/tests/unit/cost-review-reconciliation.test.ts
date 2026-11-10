import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  costReviewClusterCounts,
  costReviewDuplicateKey,
  costReviewProgressOf,
  costReviewTotals,
} from '../../services/cost-review.service';
import type { CostReviewRow } from '@tingting/shared';

/**
 * SIL-779 — bảng đối soát chi phí tập trung: the pure review-layer laws the
 * accountant's chống-trùng-lặp sweep relies on (progress classification,
 * duplicate clusters, header totals), pinned without a database. The read
 * path itself is the existing expense-accounting list (no second read path).
 */
describe('cost-review reconciliation helpers (SIL-779)', () => {
  describe('costReviewProgressOf', () => {
    it('unconfirmed rows stay CHUA_XAC_NHAN regardless of lot linkage', () => {
      assert.equal(costReviewProgressOf({ confirmedAt: null, reconciliationId: null }), 'CHUA_XAC_NHAN');
    });
    it('confirmed without a lot is DA_XAC_NHAN; lot linkage wins as DA_LAP_PHIEU', () => {
      assert.equal(costReviewProgressOf({ confirmedAt: '2026-11-10T00:00:00Z', reconciliationId: null }), 'DA_XAC_NHAN');
      assert.equal(costReviewProgressOf({ confirmedAt: '2026-11-10T00:00:00Z', reconciliationId: 7 }), 'DA_LAP_PHIEU');
    });
  });

  describe('duplicate clusters', () => {
    it('normalizes fee names per lot: case and surrounding spaces do not hide a duplicate', () => {
      assert.equal(
        costReviewDuplicateKey({ shipmentId: 1, feeName: ' Phí nâng ', amount: 500_000 }),
        costReviewDuplicateKey({ shipmentId: 1, feeName: 'PHÍ NÂNG', amount: 500_000 }),
      );
    });
    it('the same fee name on a different lot is not a duplicate', () => {
      assert.notEqual(
        costReviewDuplicateKey({ shipmentId: 1, feeName: 'Phí nâng', amount: 500_000 }),
        costReviewDuplicateKey({ shipmentId: 2, feeName: 'Phí nâng', amount: 500_000 }),
      );
    });
    it('same name, different amount, is not a duplicate', () => {
      assert.notEqual(
        costReviewDuplicateKey({ shipmentId: 1, feeName: 'Phí nâng', amount: 500_000 }),
        costReviewDuplicateKey({ shipmentId: 1, feeName: 'Phí nâng', amount: 700_000 }),
      );
    });
    it('counts every row of a cluster so the badge can say how many rows collide', () => {
      const counts = costReviewClusterCounts([
        { shipmentId: 1, feeName: 'Phí nâng', amount: 500_000 },
        { shipmentId: 1, feeName: 'phí nâng', amount: 500_000 },
        { shipmentId: 1, feeName: 'Phí hạ', amount: 400_000 },
        { shipmentId: 1, feeName: 'Phí nâng', amount: 500_000 },
      ]);
      assert.equal(counts.get(costReviewDuplicateKey({ shipmentId: 1, feeName: 'Phí nâng', amount: 500_000 })), 3);
      assert.equal(counts.get(costReviewDuplicateKey({ shipmentId: 1, feeName: 'Phí hạ', amount: 400_000 })), 1);
    });
  });

  describe('costReviewTotals', () => {
    const row = (over: Partial<CostReviewRow>): CostReviewRow => ({
      id: 1, sourceKind: 'OPS', sourceId: 1, version: 1, shipmentId: 1, shipmentContainerId: null,
      tripId: null, truckId: null, customerId: 1, shipmentCode: 'SS1', tripCode: null, truckPlate: null,
      customerName: 'KH', containerNumber: null, costGroup: 'OPS_REGULAR', expenseTypeCode: 'FEE',
      feeName: 'Phí', amount: 100_000, customerChargeAmount: null, invoiceNumber: null, invoiceDate: null,
      expenseDate: '2026-11-10', payerKind: 'USER', payerUserId: 5, payerName: null, recordedById: null,
      confirmedById: null, confirmedAt: null, confirmedByName: null, note: null, recoveryNote: null,
      photoStorageKeys: [], receivedAmount: null, paidAmount: null, outstandingReceivable: null,
      outstandingPayable: null, payableEntityType: null, payableEntityId: null, linkedTripExpenseId: null,
      accountantId: null, status: 'RECORDED', evidenceMissing: false, locked: false, reconciliationId: null,
      driverName: null, routeName: null, carrierName: null, carrierCode: null,
      progress: 'CHUA_XAC_NHAN', confirmRef: { sourceKind: 'OPS', sourceId: 1, expectedVersion: 1 },
      duplicateCount: 1, ...over,
    } as CostReviewRow);

    it('splits money by confirmation and counts only clustered rows as duplicates', () => {
      const totals = costReviewTotals([
        row({ amount: 100_000 }),
        row({ id: 2, sourceId: 2, amount: 250_000, confirmedAt: '2026-11-01T00:00:00Z', progress: 'DA_XAC_NHAN' }),
        row({ id: 3, sourceId: 3, amount: 100_000, duplicateCount: 2 }),
      ]);
      assert.equal(totals.unconfirmedAmount, 200_000);
      assert.equal(totals.confirmedAmount, 250_000);
      assert.equal(totals.unconfirmedCount, 2);
      assert.equal(totals.duplicateRows, 1);
    });
  });
});
