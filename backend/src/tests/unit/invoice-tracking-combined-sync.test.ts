// SIL-762 (id 883) — the combined-invoice auto-sync PLANNER (pure logic only,
// per the BE unit-only ruling). The tx wrapper (syncCombinedInvoiceTrackingInTx)
// has no BE unit coverage — it needs a live DB — and was verified at UI DRIVEN
// rung 3 on 2026-11-09: the real edit-save of a [Kết hợp] lot inserted rows
// 3/4 (sync_source='AUTO_COMBINED') on the dev DB, evidence in the qa/ driver
// log and the ticket comment (SIL-762 board id 883).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { missingCombinedTrackingRows } from '../../services/invoice-tracking.service';

const combinedLot = {
  id: 42,
  isCombined: true,
  cargoMode: 'FCL',
  deletedAt: null,
  expectedDeliveryDate: '2026-11-05',
};
const TODAY = '2026-11-09';

describe('missingCombinedTrackingRows — SIL-762 auto-sync planner', () => {
  it('plans one "Chưa lấy HĐ" row per container, dated by the lot transport day', () => {
    const plan = missingCombinedTrackingRows(
      combinedLot,
      [{ containerNumber: 'CSNU2510001' }, { containerNumber: 'CSNU4510002' }],
      [],
      TODAY,
    );
    assert.deepEqual(plan, [
      { containerNumber: 'CSNU2510001', expenseDate: '2026-11-05' },
      { containerNumber: 'CSNU4510002', expenseDate: '2026-11-05' },
    ]);
  });

  it('falls back to today when the lot has no transport date yet', () => {
    const plan = missingCombinedTrackingRows(
      { ...combinedLot, expectedDeliveryDate: null },
      [{ containerNumber: 'CSNU2510001' }],
      [],
      TODAY,
    );
    assert.deepEqual(plan, [{ containerNumber: 'CSNU2510001', expenseDate: TODAY }]);
  });

  it('never re-creates a container that already owns a live auto row (idempotent)', () => {
    const plan = missingCombinedTrackingRows(
      combinedLot,
      [{ containerNumber: 'CSNU2510001' }, { containerNumber: 'CSNU4510002' }],
      [{ containerNumber: 'CSNU2510001', deletedAt: null }],
      TODAY,
    );
    assert.deepEqual(plan, [{ containerNumber: 'CSNU4510002', expenseDate: '2026-11-05' }]);
  });

  it('re-creates a container whose auto row was soft-deleted (fresh working row)', () => {
    const plan = missingCombinedTrackingRows(
      combinedLot,
      [{ containerNumber: 'CSNU2510001' }],
      [{ containerNumber: 'CSNU2510001', deletedAt: new Date('2026-11-08T00:00:00Z') }],
      TODAY,
    );
    assert.deepEqual(plan, [{ containerNumber: 'CSNU2510001', expenseDate: '2026-11-05' }]);
  });

  it('skips container lines without a number and drops duplicate numbers', () => {
    const plan = missingCombinedTrackingRows(
      combinedLot,
      [{ containerNumber: null }, { containerNumber: '  ' }, { containerNumber: 'CSNU2510001' }, { containerNumber: 'CSNU2510001' }],
      [],
      TODAY,
    );
    assert.deepEqual(plan, [{ containerNumber: 'CSNU2510001', expenseDate: '2026-11-05' }]);
  });

  it('no-ops for non-combined, non-FCL or soft-deleted lots', () => {
    for (const shipment of [
      { ...combinedLot, isCombined: false },
      { ...combinedLot, cargoMode: 'LCL' },
      { ...combinedLot, deletedAt: new Date('2026-11-08T00:00:00Z') },
    ]) {
      assert.deepEqual(missingCombinedTrackingRows(shipment, [{ containerNumber: 'CSNU2510001' }], [], TODAY), []);
    }
  });
});
