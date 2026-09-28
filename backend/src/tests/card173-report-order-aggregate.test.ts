/** Card 20260928_173 — criteria 2 and 3 of the two monthly phơi phiếu summary
 *  reports, ruled by the PM on 2026-09-28 (docs/adr/2026-09-28-kanban-pm-open-questions-rulings).
 *
 *  AC2 "Ưu tiên thứ tự, với những khách xhd nhiều lần 1 tháng, được ưu tiên xếp
 *  nối tiếp" — order the subjects by how many times they transacted in the
 *  period, so the repeat customers sit next to each other, and break a tie on
 *  the subject name so two renders of the same data can never disagree.
 *
 *  AC3 "Với khách hàng có phát sinh cả thu / trả 1 tháng … Ưu tiên hiển thị
 *  tổng hợp trên cùng 1 dòng: cả cước phải thu / phải trả, số lượng" — a subject
 *  that moves on BOTH sides of the ledger inside the filtered period shows ONE
 *  row carrying both sides' money and the movement count, not a receivable row
 *  plus a separate payable row.
 *
 *  Direction convention (code + tests are authoritative): the board's
 *  `chiHoTra` is Σ `amount` — the payable leg, matched against cash OUT — and
 *  `chiHoThu` is Σ `customerChargeAmount` — the receivable leg, matched against
 *  cash IN (phoi-phieu-control.service.ts:270-271, the voucher eligibility set).
 *  The report therefore calls the two sides `phaiTra` / `phaiThu`.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { Role } from '@tingting/shared';
import { disconnectRedis } from '../lib/redis';
import { getPhoiPhieuReport } from '../services/phoi-phieu-control.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const cleanup: Array<{ table: any; id: number }> = [];
function track(table: any, id: number) {
  cleanup.unshift({ table, id });
}

// 2033 is reserved for this file: the monthly report takes no `search`
// parameter, so a date window nobody else writes to is the only way to make
// "this subject's rows" mean exactly this fixture's rows.
const day = '2033-02-14';
const routeName = `C173 route ${suffix}`;
// A file-global counter keeps the run-unique-but-DB-GLOBAL keys (trip code,
// container number) distinct across the several subjects one test builds —
// both carry unique indexes that know nothing about our `suffix`.
let ordinal = 0;

// One real accountant owns every fixture row — the OPS entry's payer, the
// treasury movement's author and the cash voucher's counterparty all FK a
// user, so the file creates one instead of borrowing an id from another lane.
// Memoised rather than awaited at module scope: node:test collects the tests
// while the module's own top-level await is still in flight, so a top-level
// insert can hand a half-bound row to the first fixture.
let actorRow: Promise<{ id: number }> | null = null;
function actor() {
  actorRow ??= db.insert(s.users).values({
    username: `c173-${suffix}`, passwordHash: 't', role: Role.ACCOUNTANT, status: 'ACTIVE',
  }).returning({ id: s.users.id }).then(([row]) => {
    track(s.users, row.id);
    return row;
  });
  return actorRow;
}

/** One subject (customer) with `trips` transactions in the reserved window. */
async function mkSubject(name: string, trips: Array<{ amount: number; charge: number }>) {
  const me = await actor();
  const [customer] = await db.insert(s.customers).values({ name }).returning({ id: s.customers.id });
  track(s.customers, customer.id);
  const [route] = await db.insert(s.routes).values({ name: routeName }).returning({ id: s.routes.id });
  track(s.routes, route.id);
  const out: Array<{ sourceId: number; amount: number; tripId: number }> = [];
  for (const spec of trips) {
    const key = ordinal++;
    const [shipment] = await db.insert(s.shipments).values({
      customerId: customer.id, routeId: route.id, cargoMode: 'FCL', status: 'DISPATCHED',
    }).returning({ id: s.shipments.id });
    track(s.shipments, shipment.id);
    const [container] = await db.insert(s.shipmentContainers).values({
      shipmentId: shipment.id, containerNumber: `CSC17${String(key).padStart(6, '0')}`,
    }).returning({ id: s.shipmentContainers.id });
    track(s.shipmentContainers, container.id);
    const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
      shipmentId: shipment.id, shipmentContainerId: container.id,
      fulfillmentType: 'FCL_CONTAINER', cargoMode: 'FCL', sourceShipmentVersion: 1,
    }).returning({ id: s.shipmentFulfillments.id });
    track(s.shipmentFulfillments, fulfillment.id);
    const [trip] = await db.insert(s.trips).values({
      fulfillmentId: fulfillment.id, shipmentId: shipment.id, customerId: customer.id, routeId: route.id,
      tripCode: `TRP-C173-${suffix}-${key}`, departureDate: day, status: 'IN_TRANSIT',
    }).returning({ id: s.trips.id });
    track(s.trips, trip.id);
    const [entry] = await db.insert(s.opsExpenseEntries).values({
      shipmentId: shipment.id, shipmentContainerId: container.id, expenseTypeCode: 'OTHER',
      amount: String(spec.amount), customerChargeAmount: String(spec.charge),
      costGroup: 'OPS_INCIDENTAL', payerKind: 'USER', paidById: me.id, paidAt: day,
    }).returning({ id: s.opsExpenseEntries.id });
    track(s.opsExpenseEntries, entry.id);
    const [source] = await db.insert(s.expenseAccountingSources).values({
      sourceKind: 'OPS', sourceId: entry.id, shipmentId: shipment.id, tripId: trip.id,
      confirmedAt: new Date(), version: 1,
    }).returning({ id: s.expenseAccountingSources.id });
    track(s.expenseAccountingSources, source.id);
    out.push({ sourceId: source.id, amount: spec.amount, tripId: trip.id });
  }
  return { customerId: customer.id, sources: out };
}

/** The TRA table keys the row by the trip's EXTERNAL carrier, so a subject has
 *  to carry one for the payable report to name it. `trip_carrier_info` is what
 *  the report joins (:770-771) — a customers row is what it resolves to. */
async function attachCarrier(tripId: number, name: string) {
  const [carrier] = await db.insert(s.customers).values({ name }).returning({ id: s.customers.id });
  track(s.customers, carrier.id);
  await db.insert(s.tripCarrierInfo).values({
    tripId, carrierType: 'EXTERNAL', externalEntityId: carrier.id, externalEntityType: 'CUSTOMER',
  });
}

/** Post cash against a source exactly as the phơi phiếu voucher chain does:
 *  a treasury movement + a RECORDED voucher + the allocation. */
async function postCash(sourceId: number, direction: 'IN' | 'OUT', amount: number, tag: string) {
  const me = await actor();
  const [account] = await db.insert(s.treasuryAccounts).values({
    code: `C173-${tag}-${suffix}`, name: `C173 quỹ ${tag}`, type: 'CASH', createdBy: me.id, updatedBy: me.id,
  }).returning({ id: s.treasuryAccounts.id });
  track(s.treasuryAccounts, account.id);
  const [movement] = await db.insert(s.treasuryMovements).values({
    treasuryAccountId: account.id, direction, amount: String(amount), valueDate: day,
    physicalReference: `C173-REF-${tag}-${suffix}`, sourceVersion: 1, paymentContractVersion: 1,
    createdBy: me.id,
  }).returning({ id: s.treasuryMovements.id });
  track(s.treasuryMovements, movement.id);
  const [voucher] = await db.insert(s.expenseCashVouchers).values({
    code: `C173-VC-${tag}-${suffix}`, counterpartyType: 'USER', counterpartyId: me.id,
    treasuryMovementId: movement.id, status: 'RECORDED', createdById: me.id,
  }).returning({ id: s.expenseCashVouchers.id });
  track(s.expenseCashVouchers, voucher.id);
  await db.insert(s.expenseCashAllocations).values({
    voucherId: voucher.id, expenseAccountingSourceId: sourceId, sourceVersion: 1, amount: String(amount),
  });
}

async function report() {
  return getPhoiPhieuReport({ kind: 'THU', dateFrom: day, dateTo: day });
}

/** This file's own rows, in the order the report returned them. */
function mine(name: string, rows: Awaited<ReturnType<typeof report>>['rows']) {
  return rows.filter((row) => row.party.startsWith(name));
}

describe('card 20260928_173 AC2 — the subjects that transacted most come first', () => {
  test('frequency outranks money, and an equal count is broken by the subject name', async () => {
    // A transacted 3×, B and C 2× each — but C carries the most money and A the
    // least. A money-ordered report would read C, B, A; the PM's rule reads
    // A (three transactions) then B before C (two each, name asc). The fixture
    // is built so the two rules disagree on all three rows.
    const a = await mkSubject(`C173 ord A ${suffix}`, [
      { amount: 10000, charge: 10000 }, { amount: 10000, charge: 10000 }, { amount: 10000, charge: 10000 },
    ]);
    const b = await mkSubject(`C173 ord B ${suffix}`, [
      { amount: 20000, charge: 20000 }, { amount: 20000, charge: 20000 },
    ]);
    const c = await mkSubject(`C173 ord C ${suffix}`, [
      { amount: 90000, charge: 90000 }, { amount: 90000, charge: 90000 },
    ]);
    void a; void b; void c;

    const first = await report();
    const rowA = mine('C173 ord A', first.rows)[0];
    const rowB = mine('C173 ord B', first.rows)[0];
    const rowC = mine('C173 ord C', first.rows)[0];
    assert.ok(rowA && rowB && rowC, `fixture sanity: all three subjects report (got ${first.rows.map((r) => r.party).join(' | ')})`);
    assert.equal(rowA!.soLuong, 3, 'A transacted three times in the window');
    assert.equal(rowB!.soLuong, 2, 'B transacted twice');
    assert.equal(rowC!.soLuong, 2, 'C transacted twice');

    const order = first.rows.map((row) => row.party);
    assert.ok(
      order.indexOf(rowA!.party) < order.indexOf(rowB!.party)
      && order.indexOf(rowB!.party) < order.indexOf(rowC!.party),
      `repeat customers must lead and stay adjacent — got ${order.join(' | ')}`,
    );

    // The tiebreaker has to be a rule, not luck: the same data read twice must
    // come back in the same order, and the equal-count pair must be ordered by
    // NAME even though C is the richer of the two.
    const second = await report();
    assert.deepEqual(
      second.rows.map((row) => row.party), first.rows.map((row) => row.party),
      'two reads of one period must not disagree on the order',
    );
    const secondB = mine('C173 ord B', second.rows)[0];
    const secondC = mine('C173 ord C', second.rows)[0];
    assert.ok(
      second.rows.map((row) => row.party).indexOf(secondB!.party)
      < second.rows.map((row) => row.party).indexOf(secondC!.party),
      'equal counts must break on the subject name, so the pair is stable on every render',
    );
  });
});

describe('card 20260928_173 AC3 — a subject moving on both sides shows ONE row', () => {
  test('both legs and the count ride the single subject row', async () => {
    const both = await mkSubject(`C173 cả hai ${suffix}`, [
      { amount: 40000, charge: 40000 }, { amount: 25000, charge: 25000 },
    ]);
    await postCash(both.sources[0]!.sourceId, 'IN', 30000, 'in');
    await postCash(both.sources[1]!.sourceId, 'OUT', 12000, 'out');
    const one = await mkSubject(`C173 một chiều ${suffix}`, [{ amount: 70000, charge: 70000 }]);
    await postCash(one.sources[0]!.sourceId, 'IN', 50000, 'in1');

    const rows = (await report()).rows;
    const bothRows = mine('C173 cả hai', rows);
    assert.equal(bothRows.length, 1, 'a subject moving on both sides stays ONE row, never a receivable row plus a payable row');
    const row = bothRows[0]!;
    assert.equal(row.phaiThu, 30000, 'the receivable leg (cash IN) of that subject is on its row');
    assert.equal(row.phaiTra, 12000, 'the payable leg (cash OUT) of that subject is on the SAME row');
    assert.equal(row.soLuong, 2, 'the row also carries the movement count');
    assert.equal(row.tongPhaiThuTra, 65000, 'the charge columns are unchanged by the widening');
    assert.equal(row.daThuTra, 30000, 'the THU table still reports the IN side in Đã thu');
    assert.equal(row.conLai, 35000, 'Còn lại keeps its own meaning');

    const oneRows = mine('C173 một chiều', rows);
    assert.equal(oneRows.length, 1);
    assert.equal(oneRows[0]!.phaiTra, 0, 'a subject that moves on one side only has nothing on the other');
    assert.equal(oneRows[0]!.soLuong, 1, 'one transaction, one movement');
  });

  test('the TRA table reads the payable leg as Đã trả and keeps the other leg visible', async () => {
    const subject = await mkSubject(`C173 tra ${suffix}`, [{ amount: 31000, charge: 31000 }]);
    await attachCarrier(subject.sources[0]!.tripId, `C173 nhà xe ${suffix}`);
    await postCash(subject.sources[0]!.sourceId, 'OUT', 21000, 'out-tra');
    await postCash(subject.sources[0]!.sourceId, 'IN', 8000, 'in-tra');
    const rows = (await getPhoiPhieuReport({ kind: 'TRA', dateFrom: day, dateTo: day })).rows;
    const mineRows = rows.filter((candidate) => candidate.party.startsWith('C173 nhà xe'));
    assert.equal(mineRows.length, 1, 'the carrier is one row however many ledger sides it moved on');
    assert.equal(mineRows[0]!.tongPhaiThuTra, 31000, 'the charge columns are unchanged by the widening');
    assert.equal(mineRows[0]!.daThuTra, 21000, 'the TRA table still reports the OUT side in Đã trả');
    assert.equal(mineRows[0]!.phaiTra, 21000, 'the payable leg sits beside Đã trả');
    assert.equal(mineRows[0]!.phaiThu, 8000, 'the IN leg of the same subject is on the same row, not a second row');
    assert.equal(mineRows[0]!.soLuong, 1, 'one trip, one movement');
  });
});

after(async () => {
  for (const { table, id } of cleanup) {
    try {
      await db.delete(table).where(eq(table.id, id));
    } catch {
      /* best-effort: a referenced row must not fail this file's teardown */
    }
  }
  try { await disconnectRedis(); } catch { /* already closed */ }
  process.exit(0);
});