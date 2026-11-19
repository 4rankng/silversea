// SIL-814 — Tổng TC regression, pure law, no db (BE unit-only law).
// The crash shape QA hit on staging (build 09069560): a lot priced by
// freight-rate snapshots (or carrying a negotiated ops charge / known PS)
// but with NO trip_expense rows — `receivableDetermined` arms on any one
// side, so the unlocked rollup ran with `revenue` undefined and the
// ab50b4c9 dereference `revenue!.otherSell` threw TypeError, 500-ing the
// WHOLE GET /api/accounting/debit-merge board for every role. The law is
// shipment-debit-summary.service.ts's: missing revenue rows contribute 0.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { debitMergeTongTcUnlocked } from '../../services/debit-merge.service';

describe('debitMergeTongTcUnlocked — Tổng TC cho lô chưa khóa (SIL-814)', () => {
  it('REGRESSION: cước đã biết + KHÔNG dòng doanh thu chuyến → tổng = cước, KHÔNG ném TypeError', () => {
    // Staging repro shape: freight snapshot priced the lot, no trip_expenses.
    // (A throw here fails the test with the exact TypeError.)
    assert.equal(debitMergeTongTcUnlocked({
      revenue: undefined,
      freightAuto: 3952000,
      psKnownTotal: null,
      opsChargeKnownTotal: null,
    }), 3952000);
  });

  it('REGRESSION: chỉ phí ops đã biết (không doanh thu chuyến) → tổng = phí ops', () => {
    assert.equal(debitMergeTongTcUnlocked({
      revenue: undefined,
      freightAuto: null,
      psKnownTotal: null,
      opsChargeKnownTotal: 500000,
    }), 500000);
  });

  it('REGRESSION: chỉ PS đã biết (không doanh thu chuyến) → tổng = PS', () => {
    assert.equal(debitMergeTongTcUnlocked({
      revenue: undefined,
      freightAuto: null,
      psKnownTotal: 250000,
      opsChargeKnownTotal: null,
    }), 250000);
  });

  it('đủ các phía: doanh thu chuyến + cước + PS + phí ops cộng đúng', () => {
    assert.equal(debitMergeTongTcUnlocked({
      revenue: { otherSell: 300000, derived: 1200000 },
      freightAuto: 3952000,
      psKnownTotal: 250000,
      opsChargeKnownTotal: 500000,
    }), 6202000);
  });

  it('chỉ có doanh thu chuyến (cước/PS/ops chưa biết) → tổng = doanh thu', () => {
    assert.equal(debitMergeTongTcUnlocked({
      revenue: { otherSell: 300000, derived: 1200000 },
      freightAuto: null,
      psKnownTotal: null,
      opsChargeKnownTotal: null,
    }), 1500000);
  });

  it('không phía nào xác định → null (không bịa 0 — luật unknown)', () => {
    assert.equal(debitMergeTongTcUnlocked({
      revenue: undefined,
      freightAuto: null,
      psKnownTotal: null,
      opsChargeKnownTotal: null,
    }), null);
  });

  it('mỗi phía đã biết nhưng = 0 vẫn không bịa doanh thu khi không có gì xác định tổng khác', () => {
    // Zero-known sides arm nothing (receivableDetermined's ≠0 law): stays null.
    assert.equal(debitMergeTongTcUnlocked({
      revenue: undefined,
      freightAuto: null,
      psKnownTotal: 0,
      opsChargeKnownTotal: 0,
    }), null);
  });
});
