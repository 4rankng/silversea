// SIL-945 (KB Ch.3 §3.1.7 / Ch.10 §10.1.4) — pure-law tests for the Chi tiết
// lô hàng board's three freight column groups, no db. Covers the laws the
// board renders: (1) the two transport channels (snapshot → đầu ra,
// trip_carrier_info → đầu vào; a lot's saved manual sell price wins over the
// trace), (2) the OPS_REGULAR / OPS_INCIDENTAL làm hàng & phát sinh split
// (cost side = amount, customer side = negotiated charge, invoices ride
// correctly), (3) the group-4 chi hộ buckets (charge-else-paid, negative
// paid dropped, invoice dedupe), (4) the row scoping (chung-lô lands once —
// lot row first, else first container row; multi-cont entries visible on
// every named container), (5) the null-conserving totals (chưa xác định
// never renders as 0).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCusFreightGroups,
  type CusFreightChannel,
  type CusFreightOpsRow,
  type CusFreightRowInput,
} from '../../services/cus-container-freight-groups.service';

function channel(opsRows: CusFreightOpsRow[], snapshot?: Map<number, string | null>, carrier?: Map<number, string | null>): CusFreightChannel {
  return {
    snapshotFreightByTrip: snapshot ?? new Map(),
    carrierCostByTrip: carrier ?? new Map(),
    opsRows,
  };
}

function opsRow(over: Partial<CusFreightOpsRow>): CusFreightOpsRow {
  return {
    shipmentId: 1,
    containerId: null,
    containerIds: null,
    costGroup: 'OPS_REGULAR',
    category: null,
    amount: '100000',
    charge: null,
    invoiceNumber: null,
    ...over,
  };
}

describe('buildCusFreightGroups — hai kênh vận chuyển', () => {
  it('container row: snapshot freight → đầu ra, carrier cost → đầu vào; lot manual sell price wins over the trace', () => {
    const rows: CusFreightRowInput[] = [
      { shipmentId: 1, rowId: 11, tripId: 7, containerId: 11, isLotLevel: false },
      { shipmentId: 2, rowId: -2, tripId: 9, containerId: null, isLotLevel: true, revFreightManual: 1_600_000 },
    ];
    const result = buildCusFreightGroups(rows, channel([], new Map([[7, '3995000']]), new Map([[7, '2000000']])));

    assert.equal(result.get(11)?.outbound.transport.amount, '3995000');
    assert.equal(result.get(11)?.inbound.transport.amount, '2000000');
    // The lot row's saved manual price overrides the traced lane value; the
    // channel has no snapshot for trip 9, manual still renders.
    assert.equal(result.get(-2)?.outbound.transport.amount, '1600000');
    // Inbound reads the carrier channel; trip 9 has no row → chưa xác định.
    assert.equal(result.get(-2)?.inbound.transport.amount, null);
  });

  it('lot row without trip or manual price: transport stays null (never a fabricated 0)', () => {
    const result = buildCusFreightGroups(
      [{ shipmentId: 1, rowId: -1, tripId: null, containerId: null, isLotLevel: true }],
      channel([]),
    );
    assert.equal(result.get(-1)?.outbound.transport.amount, null);
    assert.equal(result.get(-1)?.outbound.total, null);
    assert.equal(result.get(-1)?.inbound.total, null);
  });
});

describe('buildCusFreightGroups — làm hàng / phát sinh (group 5 families)', () => {
  const containerRow: CusFreightRowInput = { shipmentId: 1, rowId: 5, tripId: null, containerId: 5, isLotLevel: false };

  it('cost side sums amounts, customer side sums negotiated charges, invoices ride the right cells', () => {
    const ops = [
      opsRow({ containerId: 5, amount: '200000', charge: '250000', invoiceNumber: 'HD-A' }),
      opsRow({ containerId: 5, costGroup: 'OPS_INCIDENTAL', amount: '50000', invoiceNumber: 'HD-B' }),
    ];
    const cell5 = buildCusFreightGroups([containerRow], channel(ops)).get(5)!;
    // Làm hàng: entry negotiated 250000 over a 200000 cost — both sides known.
    assert.equal(cell5.outbound.handling.amount, '250000');
    assert.deepEqual(cell5.outbound.handling.invoiceNumbers, ['HD-A']);
    assert.equal(cell5.inbound.handling.amount, '200000');
    assert.deepEqual(cell5.inbound.handling.invoiceNumbers, ['HD-A']);
    // Phát sinh: no charge → cost side only; the customer cell never invents 0
    // and an invoice-free cell omits the optional field entirely.
    assert.equal(cell5.outbound.incidental.amount, null);
    assert.equal('invoiceNumbers' in cell5.outbound.incidental, false);
    assert.equal(cell5.inbound.incidental.amount, '50000');
    assert.deepEqual(cell5.inbound.incidental.invoiceNumbers, ['HD-B']);
    // Tổng cước (outbound) sums the KNOWN components only: làm hàng 250000.
    assert.equal(cell5.outbound.total, '250000');
    assert.equal(cell5.inbound.total, '250000');
  });

  it('multiple entries accumulate; duplicate invoice numbers stay unique and in source order', () => {
    const ops = [
      opsRow({ containerId: 5, amount: '100000', charge: '120000', invoiceNumber: 'HD-A' }),
      opsRow({ containerId: 5, amount: '30000', charge: null, invoiceNumber: 'HD-A' }),
    ];
    const cell5 = buildCusFreightGroups([containerRow], channel(ops)).get(5)!;
    assert.equal(cell5.inbound.handling.amount, '130000');
    assert.equal(cell5.outbound.handling.amount, '120000');
    assert.deepEqual(cell5.outbound.handling.invoiceNumbers, ['HD-A']);
    assert.deepEqual(cell5.inbound.handling.invoiceNumbers, ['HD-A']);
  });
});

describe('buildCusFreightGroups — phí chi hộ (group 4, invoiced)', () => {
  const containerRow: CusFreightRowInput = { shipmentId: 1, rowId: 5, tripId: null, containerId: 5, isLotLevel: false };

  it('buckets by catalog category; amount = charge else paid; negative paid behaves as absent', () => {
    const ops = [
      opsRow({ containerId: 5, costGroup: 'INVOICED_OTHER', category: 'CSHT', amount: '300000', charge: '300000', invoiceNumber: 'HD-C1' }),
      opsRow({ containerId: 5, costGroup: 'INVOICED_LIFT', category: 'LIFT', amount: '200000', charge: null, invoiceNumber: 'HD-C2' }),
      opsRow({ containerId: 5, costGroup: 'INVOICED_DROP', category: 'DROP', amount: '-50000', charge: null, invoiceNumber: 'HD-C3' }),
      opsRow({ containerId: 5, costGroup: 'INVOICED_OTHER', category: null, amount: '70000', charge: '90000', invoiceNumber: 'HD-C4' }),
    ];
    const chiHo = buildCusFreightGroups([containerRow], channel(ops)).get(5)!.chiHo;
    assert.equal(chiHo.csht.amount, '300000');
    assert.deepEqual(chiHo.csht.invoiceNumbers, ['HD-C1']);
    // No negotiated charge → the paid amount IS the cell (chi bao nhiêu thu bấy nhiêu).
    assert.equal(chiHo.lift.amount, '200000');
    assert.deepEqual(chiHo.lift.invoiceNumbers, ['HD-C2']);
    // Negative paid drops out entirely — the cell stays chưa xác định.
    assert.equal(chiHo.drop.amount, null);
    assert.equal('invoiceNumbers' in chiHo.drop, false);
    assert.equal(chiHo.other.amount, '90000');
    assert.deepEqual(chiHo.other.invoiceNumbers, ['HD-C4']);
  });

  it('a negative paid chi hộ row never poisons an already-accumulated bucket amount', () => {
    const ops = [
      opsRow({ containerId: 5, costGroup: 'INVOICED_OTHER', category: 'CSHT', amount: '300000', charge: '300000', invoiceNumber: 'HD-C1' }),
      opsRow({ containerId: 5, costGroup: 'INVOICED_OTHER', category: 'CSHT', amount: '-300000', charge: null, invoiceNumber: 'HD-C1' }),
    ];
    const chiHo = buildCusFreightGroups([containerRow], channel(ops)).get(5)!.chiHo;
    assert.equal(chiHo.csht.amount, '300000');
    assert.deepEqual(chiHo.csht.invoiceNumbers, ['HD-C1']);
  });
});

describe('buildCusFreightGroups — scoping law across the rows of one lot', () => {
  it('chung-lô entries land on the lot-level row when one exists, never on container rows', () => {
    const rows: CusFreightRowInput[] = [
      { shipmentId: 1, rowId: -1, tripId: null, containerId: null, isLotLevel: true },
      { shipmentId: 1, rowId: 5, tripId: null, containerId: 5, isLotLevel: false },
    ];
    const ops = [opsRow({ amount: '400000', invoiceNumber: 'HD-COMMON' })];
    const result = buildCusFreightGroups(rows, channel(ops));
    assert.equal(result.get(-1)?.inbound.handling.amount, '400000');
    assert.deepEqual(result.get(-1)?.inbound.handling.invoiceNumbers, ['HD-COMMON']);
    assert.equal(result.get(5)?.inbound.handling.amount, null);
  });

  it('on a container-owning lot chung-lô entries land on the FIRST container row only', () => {
    const rows: CusFreightRowInput[] = [
      { shipmentId: 1, rowId: 5, tripId: null, containerId: 5, isLotLevel: false },
      { shipmentId: 1, rowId: 6, tripId: null, containerId: 6, isLotLevel: false },
    ];
    const ops = [opsRow({ amount: '400000' })];
    const result = buildCusFreightGroups(rows, channel(ops));
    assert.equal(result.get(5)?.inbound.handling.amount, '400000');
    assert.equal(result.get(6)?.inbound.handling.amount, null);
  });

  it('a container-named entry reaches its own row; a multi-cont (SIL-881) entry reaches every named container', () => {
    const rows: CusFreightRowInput[] = [
      { shipmentId: 1, rowId: 5, tripId: null, containerId: 5, isLotLevel: false },
      { shipmentId: 1, rowId: 6, tripId: null, containerId: 6, isLotLevel: false },
      { shipmentId: 1, rowId: 7, tripId: null, containerId: 7, isLotLevel: false },
    ];
    const ops = [
      opsRow({ containerId: 6, amount: '60000', invoiceNumber: 'HD-6' }),
      opsRow({ containerId: 5, containerIds: [5, 6], amount: '100000', invoiceNumber: 'HD-56' }),
    ];
    const result = buildCusFreightGroups(rows, channel(ops));
    // Container 6: both its own entry and the multi-cont entry.
    assert.equal(result.get(6)?.inbound.handling.amount, '160000');
    assert.deepEqual(result.get(6)?.inbound.handling.invoiceNumbers, ['HD-6', 'HD-56']);
    // Container 5: only the multi-cont entry.
    assert.equal(result.get(5)?.inbound.handling.amount, '100000');
    // Container 7: nothing.
    assert.equal(result.get(7)?.inbound.handling.amount, null);
  });
});

describe('buildCusFreightGroups — wire shape', () => {
  it('a cell with no invoices omits the optional invoiceNumbers field entirely', () => {
    const result = buildCusFreightGroups(
      [{ shipmentId: 1, rowId: 5, tripId: 7, containerId: 5, isLotLevel: false }],
      channel([], new Map([[7, '1000000']]), new Map([[7, '500000']])),
    );
    const groups = result.get(5)!;
    assert.equal('invoiceNumbers' in groups.outbound.transport, false);
    assert.equal(groups.outbound.total, '1000000');
  });
});
