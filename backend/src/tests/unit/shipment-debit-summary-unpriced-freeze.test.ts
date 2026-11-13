// SIL-814 (id 942, UAT 12/11) — the 24/10 rule (Spec v4 §8.1.3) on the
// Chi phí - Quyết toán board: a lot whose freight was NEVER priced must show
// BLANK (or auto-restore the intake price), never a fabricated 0₫, when it is
// not a lo phụ inside a merge group.
//
// Repro (staging, customer Long Minh): the six FCL lots R3N-KR1/KR2 ·
// R3N-J1 · R3M-J1/KR1/KR2 each froze ONE trip-leg snapshot row
// (total 0, pricing_table_id 0, rate_terms_id 1, formulaText NULL) — the
// SIL-676 in-engine MANUAL zero (dispatch priced with the terms found but the
// base-price row missing). The SIL-731 dummy guard demanded rate_terms_id 0
// too, so the row passed as a LIVE 0₫ leg: CƯỚC VẬN TẢI (AUTO) = 0 and
// TỔNG PHẢI THU = 0 on every one of them.
//
// The law here: pricing_table_id 0 + total 0 = unpriced dummy on EITHER
// channel shape (the read rule runs before the trip-leg/intake branch, so a
// dummy leg drops out, a real leg still sums, and a lot left with no real row
// falls back to its priced intake row — "tự động trả lại đơn giá gốc từ Bảng
// giá" — or to no channel at all = blank). A genuinely-priced 0 keeps a real
// table id and stays a value (D02).
//
// Db-free unit tree: the loader runs against a scripted executor (same style
// as expense-source-id-resolution.test.ts).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Executor } from '../../db';
import { loadFreightSnapshotChannelByLot } from '../../services/revenue-override-read.service';

interface GrainRow {
  shipmentId: number;
  tripId: number | null;
  totalAmount: number;
  pricingTableId: number;
  rateTermsId: number;
  formulaText: string | null;
}

function scriptedExecutor(rows: GrainRow[]) {
  return {
    select: () => ({
      from: () => ({
        leftJoin: () => ({
          where: () => rows,
        }),
      }),
    }),
  } as unknown as Executor;
}

const dummyTripLeg = (shipmentId: number): GrainRow => ({
  shipmentId,
  tripId: 282,
  totalAmount: 0,
  pricingTableId: 0,
  rateTermsId: 1,
  formulaText: null,
});

const pricedIntake = (shipmentId: number): GrainRow => ({
  shipmentId,
  tripId: null,
  totalAmount: 3_952_000,
  pricingTableId: 33,
  rateTermsId: 1,
  formulaText: '3800000 × (1 + 4.00%) = 3952000 — phụ phí dầu chờ xác nhận',
});

describe('loadFreightSnapshotChannelByLot — unpriced dummy freezes never read as a live 0₫ (SIL-814)', () => {
  it('QA 12/11 repro — FCL lot with only a dummy trip-leg freeze (table 0, terms 1) → NO channel (blank), not 0', async () => {
    const channel = await loadFreightSnapshotChannelByLot(scriptedExecutor([dummyTripLeg(775)]), [775]);
    assert.equal(channel.has(775), false, 'the unpriced freeze must not materialize as a 0₫ channel');
  });

  it('dummy dispatch freeze + priced intake row → the intake price is restored (tự tra lại từ Bảng giá)', async () => {
    // R3M-KR1 (staging id 772): the dispatch freeze is the unpriced dummy;
    // the intake freeze holds the real bảng giá price.
    const channel = await loadFreightSnapshotChannelByLot(
      scriptedExecutor([dummyTripLeg(772), pricedIntake(772)]),
      [772],
    );
    assert.deepEqual(channel.get(772), { total: 3_952_000, formulaNote: pricedIntake(772).formulaText });
  });

  it('legacy MANUAL_ZERO_RESULT (table 0, terms 0, total 0) stays skipped — SIL-731 law kept', async () => {
    const channel = await loadFreightSnapshotChannelByLot(
      scriptedExecutor([{ ...dummyTripLeg(1), rateTermsId: 0 }]),
      [1],
    );
    assert.equal(channel.has(1), false);
  });

  it('a genuinely-priced 0 (real table id) still counts as the live price (D02)', async () => {
    const channel = await loadFreightSnapshotChannelByLot(
      scriptedExecutor([{ ...dummyTripLeg(2), pricingTableId: 33 }]),
      [2],
    );
    assert.deepEqual(channel.get(2), { total: 0, formulaNote: null });
  });

  it('a dummy leg beside a real leg does not zero the additive trip sum', async () => {
    const channel = await loadFreightSnapshotChannelByLot(
      scriptedExecutor([
        dummyTripLeg(3),
        { ...dummyTripLeg(3), tripId: 293, totalAmount: 1_500_000, pricingTableId: 21 },
      ]),
      [3],
    );
    assert.deepEqual(channel.get(3), { total: 1_500_000, formulaNote: null });
  });

  it('an intake-only dummy (table 0, terms 1) is skipped too — the guard runs before the branch', async () => {
    const channel = await loadFreightSnapshotChannelByLot(
      scriptedExecutor([{ ...pricedIntake(4), totalAmount: 0, pricingTableId: 0 }]),
      [4],
    );
    assert.equal(channel.has(4), false);
  });
});
