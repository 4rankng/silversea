// Card 20260921_18 — invoice-tracking route + service contract.
// Worked example to the đồng: invoice 12.000.000 / trả 8.000.000 → difference
// 4.000.000; totals recompute over the filtered set. Mutations are
// office-only (CUS write → 403) while CUS reads the list (200).
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import { and, eq, gte, inArray, lte } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { Role } from '@tingting/shared';
import { config } from '../config';
import { initEnforcer } from '../casbin/enforcer';
import { authMiddleware } from '../middleware/auth';
import { casbinAuthz } from '../middleware/casbin';
import { disconnectRedis } from '../lib/redis';
import { globalErrorHandler } from '../middleware/errorHandler';
import accountingRoutes from '../routes/accounting';

const suffix = `inv-${Math.random().toString(36).slice(2, 8)}`;
const customerIds: number[] = [];
const routeIds: number[] = [];
const shipmentIds: number[] = [];
const tripIds: number[] = [];
const userIds: number[] = [];
const trackIds: number[] = [];
const expenseIds: number[] = [];
const containerIds: number[] = [];
const containerTypeIds: number[] = [];
let accountantToken = '';
let cusToken = '';
let server: http.Server;
let baseUrl = '';

function mkUser(role: Role, tag: string) {
  return db.insert(s.users).values({
    username: `${tag}-${suffix.slice(0, 10)}`,
    passwordHash: 'x',
    role,
    status: 'ACTIVE',
  }).returning();
}

function tokenFor(role: Role, id: number, username: string | null): string {
  return jwt.sign({
    userId: id, username: username ?? `u-${id}`, email: null, fullName: 'QA Test',
    role, customerId: null, customerIds: [],
  }, config.jwtSecret);
}

/** `tradeDirection` / the trip's container are what card 20261005_383 derives
 *  the "Xuất/Nhập" and "loại cont" cells from, so both are opt-in per lot. The
 *  defaults reproduce the pre-card fixture (EXPORT, no container). */
async function mkLot(tag: string, opts: {
  tradeDirection?: 'IMPORT' | 'EXPORT' | null;
  container?: { number: string; typeId: number | null } | null;
} = {}): Promise<{ shipmentId: number; tripId: number }> {
  const [customer] = await db.insert(s.customers).values({ name: `InvTrk ${suffix} ${tag}` }).returning();
  customerIds.push(customer.id);
  // The DB check (drizzle/0011) pairs the document ref with the direction:
  // an IMPORT lot carries the bill number, an EXPORT lot the booking ref.
  const direction = 'tradeDirection' in opts ? opts.tradeDirection ?? null : 'EXPORT';
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id,
    cargoMode: 'FCL',
    shipmentCode: `INV-${suffix}-${shipmentIds.length}`,
    bookingRef: direction === 'IMPORT' ? null : `BOOK-${suffix}-${shipmentIds.length}`,
    blNumber: direction === 'IMPORT' ? `BL-${suffix}-${shipmentIds.length}` : null,
    status: 'READY_FOR_DISPATCH',
    tradeDirection: direction,
  }).returning();
  shipmentIds.push(shipment.id);
  const [route] = await db.insert(s.routes).values({ name: `InvTrk route ${suffix} ${tag}` }).returning();
  routeIds.push(route.id);
  const [trip] = await db.insert(s.trips).values({
    shipmentId: shipment.id,
    customerId: customer.id,
    routeId: route.id,
    departureDate: '2026-09-01',
    status: 'COMPLETED',
  }).returning();
  tripIds.push(trip.id);
  if (opts.container) {
    const [container] = await db.insert(s.tripContainers).values({
      tripId: trip.id,
      containerNumber: opts.container.number,
      containerTypeId: opts.container.typeId,
    }).returning();
    containerIds.push(container.id);
  }
  return { shipmentId: shipment.id, tripId: trip.id };
}

async function api(token: string, method: string, path: string, body?: unknown) {
  const r = await fetch(`${baseUrl}/api/accounting${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'Idempotency-Key': `inv-${suffix}-${Math.random()}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data: data as Record<string, unknown> };
}

before(async () => {
  await initEnforcer();
  const acc = await mkUser(Role.ACCOUNTANT, 'acc');
  accountantToken = tokenFor(Role.ACCOUNTANT, acc[0].id, acc[0].username);
  const cus = await mkUser(Role.CUS, 'cus');
  cusToken = tokenFor(Role.CUS, cus[0].id, cus[0].username);
  const app = express();
  app.use(express.json());
  app.use(authMiddleware);
  app.use('/api/accounting', casbinAuthz('accounting'), accountingRoutes);
  app.use(globalErrorHandler);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // Sandbox: the totals asserts own an exclusive date window — clear any
  // leftovers from previous failed runs so the math is deterministic.
  await db.delete(s.invoiceTracking).where(and(
    gte(s.invoiceTracking.expenseDate, '2026-08-01'),
    lte(s.invoiceTracking.expenseDate, '2026-08-31'),
  ));
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  try {
    await db.delete(s.tripExpenses).where(inArray(s.tripExpenses.tripId, tripIds));
    await db.delete(s.invoiceTracking).where(inArray(s.invoiceTracking.id, trackIds));
    if (containerIds.length > 0) await db.delete(s.tripContainers).where(inArray(s.tripContainers.id, containerIds));
    if (containerTypeIds.length > 0) await db.delete(s.containerTypes).where(inArray(s.containerTypes.id, containerTypeIds));
    await db.delete(s.trips).where(inArray(s.trips.id, tripIds));
    await db.delete(s.shipments).where(inArray(s.shipments.id, shipmentIds));
    await db.delete(s.routes).where(inArray(s.routes.id, routeIds));
    await db.delete(s.customers).where(inArray(s.customers.id, customerIds));
    if (userIds.length > 0) await db.delete(s.users).where(inArray(s.users.id, userIds));
  } catch { /* best-effort cleanup */ }
  await disconnectRedis();
});

describe('invoice tracking (card 20260921_18)', () => {
  test('create mirrors an expense; difference and totals compute to the đồng', async () => {
    const lotA = await mkLot('A');
    const lotB = await mkLot('B');
    const mkRow = async (lot: { shipmentId: number; tripId: number }, invoice: number, paid: number, date: string) => {
      const res = await api(accountantToken, 'POST', '/invoice-tracking', {
        shipmentId: lot.shipmentId, tripId: lot.tripId,
        invoiceNumber: `HD-${invoice}`, invoiceAmount: invoice, supplierPayment: paid,
        progress: 'CHUA_GUI', expenseDate: date,
      });
      const body = res.data as { id?: number };
      if (body.id != null) trackIds.push(body.id);
      return res;
    };
    const a = await mkRow(lotA, 12_000_000, 8_000_000, '2026-08-01');
    assert.equal(a.status, 201, `create A ${a.status}`);
    const b = await mkRow(lotB, 5_500_000, 6_000_000, '2026-08-02');
    assert.equal(b.status, 201);
    const list = await api(accountantToken, 'GET', '/invoice-tracking?from=2026-08-01&to=2026-08-31');
    assert.equal(list.status, 200);
    const { rows, totals } = list.data as { rows: Array<{ id: number; difference: string; invoiceNumber: string; expenseId: number | null }>; totals: { invoice: number; paid: number; difference: number } };
    const byInvoice = new Map(rows.map((r) => [r.invoiceNumber, r]));
    const rowA = byInvoice.get('HD-12000000')!;
    const rowB = byInvoice.get('HD-5500000')!;
    assert.equal(rowA.difference, '4000000');
    assert.equal(rowB.difference, '-500000');
    // Card 2026-10-05_384: totals gained a 4th field (COM). These rows carry no
    // COM, so it is 0 — and `difference` is byte-for-byte the old expectation.
    assert.deepEqual(totals, { invoice: 17500000, paid: 14000000, difference: 3500000, com: 0 });
    const filtered = await api(accountantToken, 'GET', '/invoice-tracking?from=2026-08-01&to=2026-08-01');
    const ft = (filtered.data as { totals: { invoice: number } }).totals;
    assert.deepEqual(ft, { invoice: 12000000, paid: 8000000, difference: 4000000, com: 0 });
  });

  test('nonexistent calendar date in the range is a 400, never a 500', async () => {
    // 2026-09-31 does not exist; Postgres date casts throw and the route
    // must answer a business 400 naming the value, not leak a 500.
    const bad = await api(accountantToken, 'GET', '/invoice-tracking?from=2026-09-01&to=2026-09-31');
    assert.equal(bad.status, 400, `expected 400 for to=2026-09-31, got ${bad.status}`);
    const message = (bad.data as { error?: string }).error ?? '';
    assert.match(message, /2026-09-31/);
    const badFrom = await api(accountantToken, 'GET', '/invoice-tracking?from=2026-02-30&to=2026-09-30');
    assert.equal(badFrom.status, 400, `expected 400 for from=2026-02-30, got ${badFrom.status}`);
  });

  test('expense mirror stays in sync and CUS cannot write but can read', async () => {
    const lot = await mkLot('C');
    const create = await api(accountantToken, 'POST', '/invoice-tracking', {
      shipmentId: lot.shipmentId, tripId: lot.tripId,
      invoiceNumber: 'HD-SYNC-1', invoiceAmount: 9_000_000, supplierPayment: 2_000_000,
      progress: 'CO_HD', expenseDate: '2026-09-30',
    });
    assert.equal(create.status, 201);
    const created = create.data as { id: number; expenseId: number | null };
    trackIds.push(created.id);
    assert.ok(created.expenseId != null, 'the mirrored expense id rides the wire');
    expenseIds.push(created.expenseId!);

    let [expense] = await db.select().from(s.tripExpenses).where(eq(s.tripExpenses.id, created.expenseId!));
    assert.equal(expense.expenseType, 'OTHER');
    assert.equal(expense.feeName, 'Chi phí hóa đơn');
    assert.equal(Number(expense.buyAmount), 2_000_000);

    const patch = await api(accountantToken, 'PATCH', `/invoice-tracking/${created.id}`, { supplierPayment: 2_500_000 });
    assert.equal(patch.status, 200);
    [expense] = await db.select().from(s.tripExpenses).where(eq(s.tripExpenses.id, created.expenseId!));
    assert.equal(Number(expense.buyAmount), 2_500_000, 'the mirrored expense follows the payment edit');

    const cusWrite = await api(cusToken, 'POST', '/invoice-tracking', {
      shipmentId: lot.shipmentId, tripId: lot.tripId,
      invoiceNumber: 'HD-CUS-1', invoiceAmount: 1, supplierPayment: 1,
    });
    assert.equal(cusWrite.status, 403, 'CUS write must be role-gated 403');

    const cusRead = await api(cusToken, 'GET', '/invoice-tracking?from=2026-08-01&to=2026-08-31');
    assert.equal(cusRead.status, 200, 'CUS read rides the route-scoped bridge');
    const rows = (cusRead.data as { rows: unknown[] }).rows;
    assert.ok(Array.isArray(rows));

    // Q10 (card 20260922_78): the delete needs a mandatory reason and
    // soft-voids. This call predates the rule and was refused with 400.
    const del = await api(accountantToken, 'DELETE', `/invoice-tracking/${created.id}`, { reason: 'card 18 cleanup' });
    assert.equal(del.status, 200);
    [expense] = await db.select().from(s.tripExpenses).where(eq(s.tripExpenses.id, created.expenseId!));
    // Q10 (card 20260922_78) turned this hard delete into a soft void, so the
    // mirrored expense SURVIVES as VOIDED with the reason recorded. Asserting
    // `undefined` pinned the pre-Q10 behaviour and would have failed anyone who
    // tried to restore it.
    assert.equal(expense?.approvalStatus, 'VOIDED', 'the mirrored expense is voided with the row, not erased');
    assert.equal(expense?.deletionReason, 'card 18 cleanup', 'the mandatory reason is recorded on the void');
  });
});

// Card 20261005_383 — "loại cont" and "Xuất/Nhập" are DERIVED beside the
// existing container number: no new column, no migration, no form field. The
// container type comes from the container-types catalog through the SAME
// first container that already governed the displayed number; the direction is
// `shipments.tradeDirection` verbatim.
describe('invoice tracking derived container facts (card 20261005_383)', () => {
  type DerivedRow = {
    id: number;
    invoiceNumber: string | null;
    containerNumber: string | null;
    containerType: string | null;
    tradeDirection: 'IMPORT' | 'EXPORT' | null;
  };

  /** A whole-year window plus an invoice-number lookup: leftovers from an
   *  earlier failed run can never make this block's assertions ambiguous. */
  async function rowFor(invoiceNumber: string): Promise<DerivedRow | undefined> {
    const list = await api(accountantToken, 'GET', '/invoice-tracking?from=2026-01-01&to=2026-12-31');
    assert.equal(list.status, 200, `list returned ${list.status}`);
    const { rows } = list.data as { rows: DerivedRow[] };
    return rows.find((r) => r.invoiceNumber === invoiceNumber);
  }

  async function track(lot: { shipmentId: number; tripId: number }, invoiceNumber: string) {
    const res = await api(accountantToken, 'POST', '/invoice-tracking', {
      shipmentId: lot.shipmentId, tripId: lot.tripId,
      invoiceNumber, invoiceAmount: 1_000_000, supplierPayment: 1_000_000,
      progress: 'CHUA_GUI', expenseDate: '2026-09-30',
    });
    assert.equal(res.status, 201, `create ${invoiceNumber} → ${res.status}`);
    const id = (res.data as { id?: number }).id;
    if (id != null) trackIds.push(id);
  }

  test('derives the type of the winning container and the raw trade direction', async () => {
    const [type] = await db.insert(s.containerTypes)
      .values({ code: `C383-${suffix}`.slice(0, 20), name: `40'HC ${suffix}`.slice(0, 50) })
      .returning();
    containerTypeIds.push(type.id);
    const lot = await mkLot('TYPE', { tradeDirection: 'IMPORT', container: { number: `CONT383A${suffix}`, typeId: type.id } });
    await track(lot, `HD-383-DERIVED-${suffix}`);

    const row = await rowFor(`HD-383-DERIVED-${suffix}`);
    assert.ok(row, 'the tracked row must be on the list');
    assert.equal(row.containerNumber, `CONT383A${suffix}`);
    assert.equal(row.containerType, type.name, 'the type is the catalog NAME, resolved through the first container');
    assert.equal(row.tradeDirection, 'IMPORT', 'the raw enum rides the wire; the client paints the label');
  });

  test('the type rides the FIRST container, exactly as the container number does', async () => {
    const [firstType] = await db.insert(s.containerTypes)
      .values({ code: `C383A-${suffix}`.slice(0, 20), name: `20'DC ${suffix}`.slice(0, 50) }).returning();
    const [secondType] = await db.insert(s.containerTypes)
      .values({ code: `C383B-${suffix}`.slice(0, 20), name: `40'OT ${suffix}`.slice(0, 50) }).returning();
    containerTypeIds.push(firstType.id, secondType.id);
    const lot = await mkLot('MULTI', { tradeDirection: 'EXPORT', container: { number: `CONT383B${suffix}`, typeId: secondType.id } });
    // A second container inserted after the first must not steal the display.
    const [later] = await db.insert(s.tripContainers).values({
      tripId: lot.tripId,
      containerNumber: `CONT383C${suffix}`,
      containerTypeId: firstType.id,
    }).returning();
    containerIds.push(later.id);
    await track(lot, `HD-383-FIRSTWINS-${suffix}`);

    const row = await rowFor(`HD-383-FIRSTWINS-${suffix}`);
    assert.ok(row, 'the tracked row must be on the list');
    assert.equal(row.containerNumber, `CONT383B${suffix}`, 'the first container still owns the number');
    assert.equal(row.containerType, secondType.name, 'and the type is read off that same first container');
    assert.equal(row.tradeDirection, 'EXPORT');
  });

  test('missing container, missing type and null direction derive null — the row survives', async () => {
    // (a) no container at all, (b) a container with no type, both with a null
    // tradeDirection. The board paints each part as "—"; nothing throws.
    const bare = await mkLot('BARE', { tradeDirection: null, container: null });
    const untyped = await mkLot('UNTYPED', { tradeDirection: null, container: { number: `CONT383D${suffix}`, typeId: null } });
    await track(bare, `HD-383-BARE-${suffix}`);
    await track(untyped, `HD-383-UNTYPED-${suffix}`);

    const bareRow = await rowFor(`HD-383-BARE-${suffix}`);
    assert.ok(bareRow, 'a trip with no container still renders its row');
    assert.equal(bareRow.containerNumber, null);
    assert.equal(bareRow.containerType, null);
    assert.equal(bareRow.tradeDirection, null);

    const untypedRow = await rowFor(`HD-383-UNTYPED-${suffix}`);
    assert.ok(untypedRow, 'a container without a type still renders its row');
    assert.equal(untypedRow.containerNumber, `CONT383D${suffix}`);
    assert.equal(untypedRow.containerType, null, 'a container with no type yields a null type, never an error');
    assert.equal(untypedRow.tradeDirection, null);
  });
});

/** Card 2026-10-05_384 (REQ-5.10-08) — COM is the amount deducted from the
 *  CUSTOMER, so it gets its own amount field and its own box in the totals strip.
 *
 *  Two decisions have to stay true together, and both are pinned here:
 *   1. COM is DISPLAY-ONLY. `Chênh lệch` keeps reconciling invoice vs supplier
 *      payment and must not absorb a customer-side deduction — otherwise every
 *      report quoting that number silently changes meaning; and
 *   2. a legacy row carrying only the free-text `comNote` still reads back
 *      cleanly, because that text is real data on rows that already exist. */
describe('card 2026-10-05_384 — COM as money, totals strip grows a 4th box', () => {
  test('totals.com sums the COM amounts while Chênh lệch stays invoice − supplier payment', async () => {
    const lot = await mkLot('COM');
    const mk = async (invoice: number, paid: number, com: number | null, note: string | null) => {
      const res = await api(accountantToken, 'POST', '/invoice-tracking', {
        shipmentId: lot.shipmentId, tripId: lot.tripId,
        invoiceNumber: `HD-COM-${suffix}-${invoice}-${com ?? 'note'}`,
        invoiceAmount: invoice, supplierPayment: paid,
        comAmount: com, comNote: note, expenseDate: '2026-07-05',
      });
      assert.equal(res.status, 201, `create com=${com} note=${note} → ${res.status}`);
      const body = res.data as { id: number; expenseId: number | null };
      trackIds.push(body.id);
      if (body.expenseId != null) expenseIds.push(body.expenseId);
      return body;
    };
    await mk(10_000_000, 6_000_000, 1_500_000, null);
    await mk(4_000_000, 4_000_000, 250_000, null);
    // Legacy shape: text note only, no amount. Must survive untouched.
    await mk(2_000_000, 1_000_000, null, 'Trừ khách 500000');

    const list = await api(accountantToken, 'GET', '/invoice-tracking?from=2026-07-01&to=2026-07-31');
    assert.equal(list.status, 200);
    const { rows, totals: serverTotals } = list.data as {
      rows: Array<{ id: number; invoiceNumber: string; comAmount: number | null; comNote: string | null; difference: string; invoiceAmount: string; supplierPayment: string }>;
      totals: { invoice: number; paid: number; difference: number; com: number };
    };
    // Scope to THIS run's invoices. The month window is shared with other rows,
    // so a blanket total over the window would assert on someone else's money.
    const mine = rows.filter((r) => r.invoiceNumber.includes(suffix));

    const withAmount = mine.filter((r) => r.comAmount != null);
    assert.equal(withAmount.length, 2, 'both amount-carrying rows come back');
    // The window may hold rows from other specs, so assert COM landed on OUR
    // rows rather than on a window-wide sum.
    assert.deepEqual(withAmount.map((r) => r.comAmount).sort(), ['1500000', '250000']);

    // THE decision under test — two independent pins, both reading SERVER output
    // and both immune to whatever else lives in the period window.
    //
    // (1) Row level: a row carrying COM must still report Chênh lệch as
    //     invoice − trả NCC. Subtracting COM here would fail every such row.
    for (const r of withAmount) {
      assert.equal(r.difference, String(Number(r.invoiceAmount) - Number(r.supplierPayment)),
        `row ${r.invoiceNumber} carries COM ${r.comAmount} yet Chênh lệch must stay invoice − trả NCC`);
    }
    // (2) Window level: the identity holds over whatever rows are present, and
    //     fails the moment anyone folds COM in. Verified by mutation: editing
    //     the backend to subtract comAmount turns this suite red.
    assert.ok(serverTotals.com >= 1_750_000, 'the server sums COM into totals.com');
    assert.equal(serverTotals.difference, serverTotals.invoice - serverTotals.paid,
      'COM is deliberately NOT subtracted: Chênh lệch and a customer deduction are different questions');
    const byNote = mine.find((r) => r.comNote === 'Trừ khách 500000');
    assert.ok(byNote, 'the legacy text-only row still comes back');
    assert.equal(byNote.comAmount, null, 'a legacy row has no amount, and that is not an error');
    assert.equal(byNote.difference, '1000000', 'and its Chênh lệch is untouched too');
  });

  test('a negative or fractional COM amount is rejected — COM is whole dong like the other money fields', async () => {
    const lot = await mkLot('COMNEG');
    const res = await api(accountantToken, 'POST', '/invoice-tracking', {
      shipmentId: lot.shipmentId, tripId: lot.tripId,
      invoiceNumber: `HD-COMNEG-${suffix}`, invoiceAmount: 1_000_000, supplierPayment: 0,
      comAmount: -1, expenseDate: '2026-07-06',
    });
    assert.equal(res.status, 400, `expected 400 for a negative COM amount, got ${res.status}`);
    // numeric(15,0) + the sibling fields' `.int()`: COM is whole dong too.
    const frac = await api(accountantToken, 'POST', '/invoice-tracking', {
      shipmentId: lot.shipmentId, tripId: lot.tripId,
      invoiceNumber: `HD-COMFRAC-${suffix}`, invoiceAmount: 1_000_000, supplierPayment: 0,
      comAmount: 250_000.4, expenseDate: '2026-07-06',
    });
    assert.equal(frac.status, 400, `expected 400 for a fractional COM amount, got ${frac.status}`);
  });
});
