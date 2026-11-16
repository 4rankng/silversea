// SIL-847 (id 976) — the L2 per-lot detail reads the SAME unpriced-freeze law
// as the L1 channel (quy tắc 24/10, Spec v5 §8.1.3): an unpriced dummy freeze
// (0 money + a zeroed engine trace id) is not a priced snapshot and must
// never materialize as a fake 0 on Cước thu / Cước hợp đồng / Phụ phí xăng
// dầu — the R3N-KR1/KR2 · R3N-J1 · R3M-J1/KR1/KR2 repro pairs (staging,
// customer Long Minh) rendered exactly that before this guard.
//
// Db-free unit tree: pickLatestFreightSnapshotByTrip is pure — the L2 reader
// (shipment-debit-detail.service.ts) feeds it its select rows.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isUnpricedFreezeSnapshot,
  pickLatestFreightSnapshotByTrip,
} from '../../services/revenue-override-read.service';

type Row = Parameters<typeof pickLatestFreightSnapshotByTrip>[0][number];

/** A priced snapshot row: full engine trace (every id real — D02). */
function priced(over: Partial<Row> & { id: number; tripId: number | null }): Row {
  return {
    freightAmount: '3952000',
    surchargeAmount: '0',
    totalAmount: '3952000',
    rateKey: 'STD',
    rateTermsId: 1,
    pricingTableId: 33,
    fuelNormId: 7,
    fuelPricePeriodId: 5,
    ...over,
  };
}

describe('isUnpricedFreezeSnapshot (SIL-731 + SIL-814, shared SIL-847)', () => {
  it('flags a zeroed-amount row with ANY zeroed trace id (the missing-norm / missing-fuel-period shapes keep the earlier ids)', () => {
    assert.equal(isUnpricedFreezeSnapshot({ totalAmount: '0', rateTermsId: 1, pricingTableId: 33, fuelNormId: 0, fuelPricePeriodId: 5 }), true);
    assert.equal(isUnpricedFreezeSnapshot({ totalAmount: '0', rateTermsId: 1, pricingTableId: 33, fuelNormId: 7, fuelPricePeriodId: 0 }), true);
    assert.equal(isUnpricedFreezeSnapshot({ totalAmount: '0', rateTermsId: 0, pricingTableId: 0, fuelNormId: 0, fuelPricePeriodId: 0 }), true);
  });

  it('keeps a genuinely-priced 0 (D02 — full trace) as a value', () => {
    assert.equal(isUnpricedFreezeSnapshot({ totalAmount: '0', rateTermsId: 1, pricingTableId: 33, fuelNormId: 7, fuelPricePeriodId: 5 }), false);
  });

  it('keeps any non-zero amount regardless of trace ids', () => {
    assert.equal(isUnpricedFreezeSnapshot({ totalAmount: '3952000', rateTermsId: 0, pricingTableId: 0, fuelNormId: 0, fuelPricePeriodId: 0 }), false);
  });

  it('coerces a NULL totalAmount to 0 like the debit summary (byte-for-byte)', () => {
    assert.equal(isUnpricedFreezeSnapshot({ totalAmount: null, rateTermsId: 1, pricingTableId: 33, fuelNormId: 0, fuelPricePeriodId: 5 }), true);
    assert.equal(isUnpricedFreezeSnapshot({ totalAmount: null, rateTermsId: 1, pricingTableId: 33, fuelNormId: 7, fuelPricePeriodId: 5 }), false);
  });
});

describe('pickLatestFreightSnapshotByTrip (L2 detail, SIL-847)', () => {
  it('an unpriced latest row suppresses the trip — no fake 0, no fallback to the earlier priced row (R3M-KR1 freeze-0/0 shape)', () => {
    const rows = [
      priced({ id: 703, tripId: 282, freightAmount: '0', surchargeAmount: '0', totalAmount: '0', rateKey: null, rateTermsId: 0, pricingTableId: 0, fuelNormId: 0, fuelPricePeriodId: 0 }),
    ];
    const map = pickLatestFreightSnapshotByTrip([
      priced({ id: 700, tripId: 282 }),
      ...rows,
    ]);
    assert.equal(map.has(282), false);
  });

  it('the missing-norm shape (real rate-terms + table, fuelNormId 0) with a later id also suppresses the trip (R3N-J2 / R3M-J2 shape)', () => {
    const map = pickLatestFreightSnapshotByTrip([
      priced({ id: 800, tripId: 292, freightAmount: '0', surchargeAmount: '0', totalAmount: '0', rateKey: null, rateTermsId: 1, pricingTableId: 33, fuelNormId: 0, fuelPricePeriodId: 0 }),
    ]);
    assert.equal(map.has(292), false);
  });

  it('a priced latest row wins over an earlier unpriced row', () => {
    const map = pickLatestFreightSnapshotByTrip([
      priced({ id: 1, tripId: 10, freightAmount: '0', surchargeAmount: '0', totalAmount: '0', rateKey: null, rateTermsId: 0, pricingTableId: 0, fuelNormId: 0, fuelPricePeriodId: 0 }),
      priced({ id: 2, tripId: 10, totalAmount: '3952000' }),
    ]);
    assert.deepEqual(map.get(10), { freight: '3952000', surcharge: '0', total: '3952000', rateKey: 'STD' });
  });

  it('a genuinely-priced 0 (D02, full trace) stays a value — 0 is a number, not a blank', () => {
    const map = pickLatestFreightSnapshotByTrip([
      priced({ id: 5, tripId: 11, freightAmount: '0', surchargeAmount: '0', totalAmount: '0' }),
    ]);
    assert.deepEqual(map.get(11), { freight: '0', surcharge: '0', total: '0', rateKey: 'STD' });
  });

  it('trip-NULL intake rows never enter the per-trip map; result is order-independent', () => {
    const intake = priced({ id: 9, tripId: null });
    const a = priced({ id: 1, tripId: 12 });
    const b = priced({ id: 2, tripId: 12, totalAmount: '500' });
    assert.equal(pickLatestFreightSnapshotByTrip([intake, a, b]).get(12)?.total, '500');
    assert.equal(pickLatestFreightSnapshotByTrip([b, intake, a]).get(12)?.total, '500');
    assert.equal(pickLatestFreightSnapshotByTrip([a, b, intake]).size, 1);
  });
});
