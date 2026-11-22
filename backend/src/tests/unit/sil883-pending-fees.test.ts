// SIL-883 (3.1/3.2) — the pending-fee laws: (A) the pure builders carry the
// duyệt axis (pending line flags; a family side reads pending when ANY
// contributing entry awaits Kế toán duyệt), (B) the block sentence format,
// (C) the wiring pins: the hard block rides ALL THREE money actions and the
// board emits the per-lot count + drops REJECTED fee rows. Unit-only tree —
// the db-bound guard itself cannot run here (the enforcement-test pattern).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDebitMergeChiHo,
  buildDebitMergeNoInvoice,
} from '../../services/debit-merge.service';
import {
  pendingFeeBlockMessage,
  // eslint-disable-next-line import/order
} from '../../services/shipment-pending-fees.service';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), 'utf8');

describe('SIL-883 — group-4 chi-hộ builder carries the duyệt axis', () => {
  it('a pending fee line keeps pending; an approved line omits the key', () => {
    const chiHo = buildDebitMergeChiHo([
      { category: 'CSHT', charge: '1000000', paid: null, feeName: null, invoiceNumber: '360402', pending: true },
      { category: 'LIFT', charge: null, paid: '500000', feeName: null, invoiceNumber: null, pending: false },
    ]);
    assert.deepEqual(chiHo.csht, [{ invoiceNumber: '360402', amount: '1000000', pending: true }]);
    assert.equal(chiHo.lift.length, 1);
    assert.equal('pending' in chiHo.lift[0]!, false, 'approved line carries no pending key (black on the grid)');
  });
});

describe('SIL-883 — group-5 no-invoice builder carries the duyệt axis', () => {
  it('a family side reads pending when ANY contributing entry awaits duyệt; fees flag per line', () => {
    const result = buildDebitMergeNoInvoice([
      { costGroup: 'OPS_REGULAR', charge: null, paid: '200000', feeName: 'Quét container', pending: true },
      { costGroup: 'OPS_REGULAR', charge: null, paid: '300000', feeName: 'Cẩu bãi', pending: false },
      { costGroup: 'OPS_INCIDENTAL', charge: '0', paid: '100000', feeName: 'Khác', pending: false },
    ]);
    assert.equal(result.gnFee, 500000);
    assert.equal(result.gnFeePending, true, 'one pending entry turns the side red');
    assert.equal(result.gnPaidPending, false, 'no negotiated charge rows → the side is not pending');
    assert.equal(result.psFeePending, false);
    assert.deepEqual(result.fees[0], { name: 'Quét container', amount: 200000, pending: true });
    assert.deepEqual(result.fees[2], { name: 'Khác', amount: 100000 }, 'approved fee omits pending (black)');
  });
});

describe('SIL-883 — the block sentence', () => {
  it('names the action, the Số Bill and the count exactly as the ticket', () => {
    assert.equal(
      pendingFeeBlockMessage('khóa lô', 'BL-9987', 2),
      'Không thể khóa lô: Lô BL-9987 còn 2 khoản chi phí chưa được Kế toán duyệt.',
    );
  });
});

describe('SIL-883 — wiring pins: the hard block rides all three money actions', () => {
  const lockService = read('../../services/shipment-cost-lock.service.ts');
  const rounds = read('../../services/debit-settlement-rounds.service.ts');
  const merge = read('../../services/debit-merge.service.ts');

  it('Khóa lô guards before the snapshot builds (409 leaves nothing behind)', () => {
    const body = lockService.slice(lockService.indexOf('export async function lockShipmentCost'));
    const guardAt = body.indexOf("assertNoPendingApprovalFees(tx, [input.shipmentId], 'khóa lô')");
    const snapshotAt = body.indexOf('buildCostSnapshot');
    assert.ok(guardAt > 0, 'lockShipmentCost runs the pending guard');
    assert.ok(snapshotAt > guardAt, 'the guard runs BEFORE the snapshot (a blocked lock freezes nothing)');
  });

  it('single-lot Xuất Debit Note guards inside the issuance tx', () => {
    const body = lockService.slice(lockService.indexOf('export async function createDebitNoteFromCostLock'));
    assert.match(body, /assertNoPendingApprovalFees\(tx, \[input\.shipmentId\], 'xuất Debit Note'\)/);
  });

  it('consolidated Xuất Debit Note guards every selected lot', () => {
    const body = lockService.slice(lockService.indexOf('export async function createConsolidatedDebitNote'));
    assert.match(body, /assertNoPendingApprovalFees\(db, shipmentIds, 'xuất Debit Note'\)/);
  });

  it('Chọn Debit (settlement round) guards after the lots resolve', () => {
    assert.match(rounds, /assertNoPendingApprovalFees\(tx, shipmentIds, 'chọn Debit'\)/);
  });

  it('the board emits control.pendingFeeCount and drops REJECTED fee rows from the buckets', () => {
    assert.match(merge, /pendingFeeCount: pendingFeeCountByLot\.get\(lot\.id\) \?\? 0/);
    const loop = merge.slice(merge.indexOf('for (const row of opsRows)'), merge.indexOf('const chiHoByLot'));
    assert.match(loop, /const rejected = row\.approvalStatus === 'REJECTED'/);
    assert.match(loop, /!rejected && row\.costGroup != null/);
    assert.match(loop, /\} else if \(!rejected\) \{/);
    assert.match(merge, /leftJoin\(s\.expenseAccountingSources, and\(/);
    assert.match(merge, /isNull\(s\.expenseAccountingSources\.confirmedAt\)|row\.confirmedAt == null/);
  });

  it('the shared wire contract carries the pending fields', () => {
    const schema = read('../../../../shared/src/schemas/debit-merge.ts');
    assert.match(schema, /pending: z\.boolean\(\)\.optional\(\)/);
    assert.match(schema, /pendingFeeCount: z\.number\(\)\.int\(\)\.nonnegative\(\)\.optional\(\)/);
  });
});
