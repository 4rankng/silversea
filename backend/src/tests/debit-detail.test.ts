import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { eq, inArray } from 'drizzle-orm';
import { Role, shipmentDebitDetailSchema } from '@tingting/shared';

import { db } from '../db';
import * as s from '../db/schema';
import { disconnectRedis } from '../lib/redis';
import { initEnforcer } from '../casbin/enforcer';
import { casbinAuthz } from '../middleware/casbin';
import { globalErrorHandler } from '../middleware/errorHandler';
import { lockShipmentCost, SHIPMENT_COST_LOCKED_MESSAGE } from '../services/shipment-cost-lock.service';
import { getShipmentDebitSummary } from '../services/shipment-debit-summary.service';
import shipmentRoutes from '../routes/shipments';

// Debit-wave detail endpoints (FE _18 contract, BE1 lane): pins for
// GET /api/shipments/:id/debit-detail and PUT /api/shipments/:id/debit-edits.
// Money is nullable everywhere — null = "chưa xác định", never a silent 0.

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const actor: never = null as never;
void actor;
const createdShipmentIds: number[] = [];
const createdExpenseIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdFulfillmentIds: number[] = [];
const createdTripIds: number[] = [];
const createdContainerTypeIds: number[] = [];
const userIds: number[] = [];
let adminId = 0;
let accountantId = 0;
let server: http.Server;
let baseUrl = '';

async function api(method: string, path: string, actorId: number, body?: Record<string, unknown>, idempotencyKey?: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey ?? `dd-${suffix}-${method}-${Math.random()}`,
      'X-Test-User-Id': String(actorId),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = text ? JSON.parse(text) as Record<string, unknown> : {};
  } catch {
    parsed = { raw: text.slice(0, 160) };
  }
  return { status: response.status, body: parsed };
}

async function mkUser(role: Role) {
  const [user] = await db.insert(s.users).values({
    username: `dd-${role.toLowerCase()}-${suffix}-${userIds.length}`,
    passwordHash: 'test-only',
    role,
    status: 'ACTIVE',
  }).returning({ id: s.users.id });
  userIds.push(user.id);
  return user.id;
}

async function mkShipmentWithTrip(opts?: { linkTripToShipment?: boolean }) {
  const [customer] = await db.insert(s.customers)
    .values({ name: `DD customer ${suffix}-${createdCustomerIds.length}` }).returning();
  createdCustomerIds.push(customer.id);
  const [route] = await db.insert(s.routes)
    .values({ name: `DD route ${suffix}-${createdRouteIds.length}` }).returning();
  createdRouteIds.push(route.id);
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id,
    routeId: route.id,
  }).returning({ id: s.shipments.id });
  createdShipmentIds.push(shipment.id);
  const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
    shipmentId: shipment.id,
    fulfillmentType: 'FCL_CONTAINER',
    cargoMode: 'FCL',
    sourceShipmentVersion: 1,
  }).returning({ id: s.shipmentFulfillments.id });
  createdFulfillmentIds.push(fulfillment.id);
  const [trip] = await db.insert(s.trips).values({
    fulfillmentId: fulfillment.id,
    // Card _16 parity fixture: real trips carry shipmentId — summary L1
    // joins trips.shipmentId while the detail side resolves via the
    // fulfillment join. Opt-in so every existing caller keeps its shape.
    shipmentId: opts?.linkTripToShipment ? shipment.id : null,
    customerId: customer.id,
    routeId: route.id,
    departureDate: '2026-01-01',
    status: 'COMPLETED',
  }).returning({ id: s.trips.id });
  createdTripIds.push(trip.id);
  return { customer, route, shipment, fulfillment, trip };
}

async function mkExpense(tripId: number, fields: {
  expenseType?: string;
  feeName?: string;
  buyAmount?: string;
  sellAmount?: string;
  note?: string;
  invoiceNumber?: string;
}) {
  const [row] = await db.insert(s.tripExpenses).values({
    tripId,
    expenseType: fields.expenseType ?? 'CUSTOMS',
    feeName: fields.feeName ?? 'Phí làm tờ khai',
    buyAmount: fields.buyAmount ?? '500000',
    sellAmount: fields.sellAmount ?? '0',
    recoveryNote: fields.note ?? null,
    invoiceNumber: fields.invoiceNumber ?? null,
  }).returning({ id: s.tripExpenses.id });
  createdExpenseIds.push(row.id);
  return row.id;
}

async function seedAccountantActor() {
  accountantId = await mkUser(Role.ACCOUNTANT);
}

before(async () => {
  await initEnforcer();
  adminId = await mkUser(Role.ADMIN);
  await seedAccountantActor();

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const header = req.header('X-Test-User-Id');
    if (header) (req as express.Request & { user?: unknown }).user = {
      userId: Number(header),
      username: 'test', email: 'test@x', fullName: 'test', role: adminId === Number(header) ? Role.ADMIN : Role.ACCOUNTANT,
    };
    next();
  });
  app.use('/api/shipments', casbinAuthz('shipments'), shipmentRoutes);
  app.use(globalErrorHandler);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  try {
    for (const expenseId of createdExpenseIds) {
      await db.delete(s.tripExpenses).where(eq(s.tripExpenses.id, expenseId));
    }
    for (const tripId of createdTripIds) {
      await db.delete(s.trips).where(eq(s.trips.id, tripId));
    }
    for (const fulfillmentId of createdFulfillmentIds) {
      await db.delete(s.shipmentFulfillments).where(eq(s.shipmentFulfillments.id, fulfillmentId));
    }
    for (const shipmentId of createdShipmentIds) {
      await db.delete(s.shipments).where(eq(s.shipments.id, shipmentId));
    }
    for (const routeId of createdRouteIds) {
      await db.delete(s.routes).where(eq(s.routes.id, routeId));
    }
    for (const typeId of createdContainerTypeIds) {
      await db.delete(s.containerTypes).where(eq(s.containerTypes.id, typeId));
    }
    for (const customerId of createdCustomerIds) {
      await db.delete(s.customers).where(eq(s.customers.id, customerId));
    }
    if (userIds.length > 0) {
      await db.delete(s.notifications).where(inArray(s.notifications.userId, userIds));
      await db.delete(s.users).where(inArray(s.users.id, userIds));
    }
  } catch {
    // red-phase tolerance
  }
  await disconnectRedis();
});

describe('20260919 Bảng 2.2 — invoice numbers on chi hộ items', () => {
  test('HD numbers ride the chi hộ items wire; invoice-less rows stay null', async () => {
    const lot = await mkShipmentWithTrip();
    await mkExpense(lot.trip.id, { expenseType: 'CUSTOMS', feeName: 'Phí nâng', buyAmount: '1250000', invoiceNumber: '00123' });
    await mkExpense(lot.trip.id, { expenseType: 'CUSTOMS', feeName: 'Phí hạ', buyAmount: '1250000', invoiceNumber: '00124' });
    await mkExpense(lot.trip.id, { expenseType: 'OTHER', feeName: 'Phí khác (không hđ)' });
    const result = await api('GET', `/api/shipments/${lot.shipment.id}/debit-detail`, accountantId);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    const rows = result.body.chiHoRows as Array<Record<string, unknown>>;
    const items = rows.flatMap((row) => row.items as Array<Record<string, unknown>>);
    const lift = items.find((item) => item.feeName === 'Phí nâng');
    const lower = items.find((item) => item.feeName === 'Phí hạ');
    assert.equal(lift!.invoiceNumber, '00123', 'the invoice number reaches the wire');
    assert.equal(lower!.invoiceNumber, '00124', 'each fee carries its own invoice number');
    assert.ok(!items.some((item) => item.expenseType === 'OTHER'), 'Phí khác rows ride otherFees, not items');
    const others = rows.flatMap((row) => row.otherFees as Array<Record<string, unknown>>);
    assert.ok(others.some((fee) => fee.name === 'Phí khác (không hđ)'), 'the invoice-less fee stays in the no-invoice bucket');
  });
});

describe('20260918 debit-detail GET (red-first)', () => {
  test('404 unknown shipment with the dedicated message', async () => {
    const result = await api('GET', '/api/shipments/999999999/debit-detail', accountantId);
    assert.equal(result.status, 404);
    assert.match(String(result.body.error), /không tồn tại|Không tìm thấy/i);
  });

  test('contract shape: freightRows, chiHoRows with otherFees+opsDocsStatus, payables, thuKhachTotal', async () => {
    const lot = await mkShipmentWithTrip();
    await mkExpense(lot.trip.id, { expenseType: 'CUSTOMS', buyAmount: '700000', sellAmount: '800000' });
    await mkExpense(lot.trip.id, { expenseType: 'OTHER', feeName: 'Phí rửa cont', buyAmount: '300000' });
    const result = await api('GET', `/api/shipments/${lot.shipment.id}/debit-detail`, accountantId);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    for (const key of ['freightRows', 'chiHoRows', 'payables', 'thuKhachTotal']) {
      assert.ok(key in result.body, `missing ${key}`);
    }
    const rows = result.body.chiHoRows as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(rows) && rows.length >= 1);
    for (const row of rows) {
      assert.ok(Array.isArray(row.otherFees), 'chi hộ row must carry an otherFees array');
      assert.ok(['READY', 'PENDING'].includes(String(row.opsDocsStatus)), 'opsDocsStatus must be READY or PENDING');
    }
  });

  test('fresh lot with no data → nulls, never silent zeros', async () => {
    const lot = await mkShipmentWithTrip();
    const result = await api('GET', `/api/shipments/${lot.shipment.id}/debit-detail`, accountantId);
    assert.equal(result.status, 200);
    assert.equal(result.body.thuKhachTotal, null);
    assert.deepEqual(result.body.chiHoRows, []);
    assert.deepEqual(result.body.freightRows, []);
  });

  test('REWORK B: containers with no trips/expenses render N null-money rows (lot 157 case)', async () => {
    const lot = await mkShipmentWithTrip();
    const [containerType] = await db.insert(s.containerTypes)
      .values({ code: `CTR${suffix}`.slice(0, 20).replace(/-/g, ''), name: `40'HC rework` }).returning();
    createdContainerTypeIds.push(containerType.id);
    const containerRows = await db.insert(s.shipmentContainers).values([
      { shipmentId: lot.shipment.id, containerNumber: 'TSTU0000001', containerTypeId: containerType.id },
      { shipmentId: lot.shipment.id, containerNumber: 'TSTU0000002', containerTypeId: containerType.id },
      { shipmentId: lot.shipment.id, containerNumber: 'TSTU0000003', containerTypeId: containerType.id },
    ]).returning({ id: s.shipmentContainers.id, number: s.shipmentContainers.containerNumber });
    const result = await api('GET', `/api/shipments/${lot.shipment.id}/debit-detail`, accountantId);
    assert.equal(result.status, 200);
    assert.equal((result.body.freightRows as unknown[]).length, 3, 'one freight row per container');
    assert.equal((result.body.chiHoRows as unknown[]).length, 3, 'one chi-ho row per container');
    for (const row of result.body.chiHoRows as Array<Record<string, unknown>>) {
      assert.ok(containerRows.some((c) => c.number === row.containerNumber), 'row keyed on the container');
      assert.equal(row.tripId, null, 'no trip yet');
      assert.equal(row.opsDocsStatus, 'PENDING');
      assert.deepEqual(row.items, []);
      assert.deepEqual(row.otherFees, []);
    }
    for (const row of result.body.freightRows as Array<Record<string, unknown>>) {
      assert.equal(row.freightCharge, null);
      assert.equal(row.contractFreightTotal, null);
      assert.equal(row.containerTypeLabel, `40'HC rework`);
    }
    assert.equal(result.body.thuKhachTotal, null, 'no data — null, not 0');
  });
});

describe('20260918 debit-edits PUT (red-first)', () => {
  test('missing Idempotency-Key → 400 with the global message', async () => {
    const lot = await mkShipmentWithTrip();
    const expenseId = await mkExpense(lot.trip.id, {});
    void expenseId;
    const response = await fetch(`${baseUrl}/api/shipments/${lot.shipment.id}/debit-edits`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Test-User-Id': String(accountantId) },
      body: JSON.stringify({ edits: [] }),
    });
    assert.equal(response.status, 400);
    const text = await response.text();
    assert.match(text, /Idempotency-Key/i);
  });

  test('edits the editable fields: buy/note on any row, thu khách (sell) only on Phí khác', async () => {
    const lot = await mkShipmentWithTrip();
    const customsExpenseId = await mkExpense(lot.trip.id, { buyAmount: '500000', sellAmount: '0' });
    const otherExpenseId = await mkExpense(lot.trip.id, { expenseType: 'OTHER', buyAmount: '200000', sellAmount: '0' });
    const buyNoteEdit = await api('PUT', `/api/shipments/${lot.shipment.id}/debit-edits`, accountantId, {
      edits: [{ expenseId: customsExpenseId, buyAmount: '650000', note: 'Điều chỉnh thực tế' }],
    });
    assert.equal(buyNoteEdit.status, 200, JSON.stringify(buyNoteEdit.body));
    const [customsRow] = await db.select().from(s.tripExpenses).where(eq(s.tripExpenses.id, customsExpenseId));
    assert.equal(customsRow.buyAmount, '650000');
    assert.equal(Number(customsRow.sellAmount), 0, 'the pass-through sell figure is system-derived — CUS cannot type it');
    assert.equal(customsRow.recoveryNote, 'Điều chỉnh thực tế');
    const sellEdit = await api('PUT', `/api/shipments/${lot.shipment.id}/debit-edits`, accountantId, {
      edits: [{ expenseId: otherExpenseId, sellAmount: '750000' }],
    });
    assert.equal(sellEdit.status, 200, JSON.stringify(sellEdit.body));
    const [otherRow] = await db.select().from(s.tripExpenses).where(eq(s.tripExpenses.id, otherExpenseId));
    assert.equal(Number(otherRow.sellAmount), 750000, 'the Phí khác customer figure is CUS-typed');
  });

  test('add and remove a Phí khác (OTHER) row', async () => {
    const lot = await mkShipmentWithTrip();
    const add = await api('PUT', `/api/shipments/${lot.shipment.id}/debit-edits`, accountantId, {
      addOtherFees: [{ tripId: lot.trip.id, name: 'Phí nâng hạ phát sinh', amount: 250000 }],
    });
    assert.equal(add.status, 200, JSON.stringify(add.body));
    const [added] = await db.select().from(s.tripExpenses)
      .where(eq(s.tripExpenses.tripId, lot.trip.id));
    assert.ok(added, 'the OTHER fee row must exist');
    assert.equal(added.expenseType, 'OTHER');
    // Q10 (card 20260922_78): a removal batch MUST carry a free-text reason.
    const remove = await api('PUT', `/api/shipments/${lot.shipment.id}/debit-edits`, accountantId, {
      removeExpenseIds: [added.id],
      removalReason: 'Phí nâng hạ phát sinh bị gõ nhầm',
    });
    assert.equal(remove.status, 200, JSON.stringify(remove.body));
    // Save → reload: the fee leaves the ACTIVE list (the row itself survives
    // as a governed soft-void — pinned in q10-soft-delete.test.ts).
    const detail = await api('GET', `/api/shipments/${lot.shipment.id}/debit-detail`, accountantId);
    assert.equal(detail.status, 200, JSON.stringify(detail.body));
    const activeFeeIds = (detail.body.chiHoRows as Array<{ otherFees: Array<{ id: number }> }>)
      .flatMap((row) => row.otherFees.map((fee) => fee.id));
    assert.ok(!activeFeeIds.includes(added.id), 'the removed fee must be gone from the active list');
  });

  test('Q10 guard: removeExpenseIds without a non-blank removalReason → 400, nothing written', async () => {
    const lot = await mkShipmentWithTrip();
    const add = await api('PUT', `/api/shipments/${lot.shipment.id}/debit-edits`, accountantId, {
      addOtherFees: [{ tripId: lot.trip.id, name: 'Phí kiểm tra lý do xóa', amount: 123000 }],
    });
    assert.equal(add.status, 200, JSON.stringify(add.body));
    const [fee] = await db.select().from(s.tripExpenses)
      .where(eq(s.tripExpenses.tripId, lot.trip.id));
    assert.ok(fee, 'the OTHER fee row must exist');

    for (const body of [
      { removeExpenseIds: [fee.id] },
      { removeExpenseIds: [fee.id], removalReason: '   ' },
    ]) {
      const rejected = await api('PUT', `/api/shipments/${lot.shipment.id}/debit-edits`, accountantId, body);
      assert.equal(rejected.status, 400, JSON.stringify(rejected.body));
      assert.match(String(rejected.body.error), /Lý do xóa là bắt buộc khi có dòng phí bị bỏ/);
    }
    // The guard rejects before any write — the fee is still active.
    const detail = await api('GET', `/api/shipments/${lot.shipment.id}/debit-detail`, accountantId);
    assert.equal(detail.status, 200, JSON.stringify(detail.body));
    const activeFeeIds = (detail.body.chiHoRows as Array<{ otherFees: Array<{ id: number }> }>)
      .flatMap((row) => row.otherFees.map((fee2) => fee2.id));
    assert.ok(activeFeeIds.includes(fee.id), 'a rejected removal must leave the fee active');
  });

  test('idempotency replay applies once — no duplicate rows', async () => {
    const lot = await mkShipmentWithTrip();
    const key = `dd-replay-${suffix}-${lot.shipment.id}`;
    const first = await api('PUT', `/api/shipments/${lot.shipment.id}/debit-edits`, accountantId, {
      addOtherFees: [{ tripId: lot.trip.id, name: 'Phí test replay', amount: 1000 }],
    }, key);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const countBefore = (await db.select().from(s.tripExpenses).where(eq(s.tripExpenses.tripId, lot.trip.id))).length;
    const replay = await api('PUT', `/api/shipments/${lot.shipment.id}/debit-edits`, accountantId, {
      addOtherFees: [{ tripId: lot.trip.id, name: 'Phí test replay', amount: 1000 }],
    }, key);
    assert.equal(replay.status, 200, JSON.stringify(replay.body));
    const rows = await db.select().from(s.tripExpenses).where(eq(s.tripExpenses.tripId, lot.trip.id));
    assert.equal(rows.length, countBefore, 'replay must not add rows');
  });

  test('REWORK: freight-side PS thực tế saves per container and returns on the row', async () => {
    const lot = await mkShipmentWithTrip();
    const [containerType] = await db.insert(s.containerTypes)
      .values({ code: `CTP${suffix}`.slice(0, 20).replace(/-/g, ''), name: `20'DC ps` }).returning();
    createdContainerTypeIds.push(containerType.id);
    await db.insert(s.shipmentContainers).values({
      shipmentId: lot.shipment.id,
      containerNumber: 'TSTU0000042',
      containerTypeId: containerType.id,
    });
    const edit = await api('PUT', `/api/shipments/${lot.shipment.id}/debit-edits`, accountantId, {
      freightEdits: [{ containerNumber: 'TSTU0000042', psActual: 1250000, note: 'PS thực tế theo cầu cảng' }],
    });
    assert.equal(edit.status, 200, JSON.stringify(edit.body));
    const detail = await api('GET', `/api/shipments/${lot.shipment.id}/debit-detail`, accountantId);
    assert.equal(detail.status, 200);
    const freightRow = (detail.body.freightRows as Array<Record<string, unknown>>)
      .find((row) => row.containerNumber === 'TSTU0000042');
    assert.ok(freightRow, 'the freight row for the container must exist');
    assert.equal(freightRow.psActual, 1250000);
    assert.equal(freightRow.psActualNote, 'PS thực tế theo cầu cảng');
  });

  test('unknown payload keys are rejected (read-only stays read-only)', async () => {
    const lot = await mkShipmentWithTrip();
    await mkExpense(lot.trip.id, {});
    const result = await api('PUT', `/api/shipments/${lot.shipment.id}/debit-edits`, accountantId, {
      freightRows: [{ freight: 123 }],
    });
    assert.equal(result.status, 400);
    assert.match(String(result.body.error), /không được sửa|chỉ chấp nhận|read-only|không hợp lệ/i);
  });

  test('409 with the dedicated message when the lot is debit-locked', async () => {
    const lot = await mkShipmentWithTrip();
    const expenseId = await mkExpense(lot.trip.id, {});
    void expenseId;
    await lockShipmentCost({
      shipmentId: lot.shipment.id,
      actor: { userId: adminId, role: Role.ADMIN } as never,
      idempotencyKey: `dd-lock-${suffix}-${lot.shipment.id}`,
    });
    const result = await api('PUT', `/api/shipments/${lot.shipment.id}/debit-edits`, accountantId, {
      edits: [{ expenseId, buyAmount: '1' }],
    });
    assert.equal(result.status, 409);
    assert.match(String(result.body.error), /đã khóa chi phí/i);
  });
});

describe('20260919 card _7 acceptance — producer output parses against the shared contract', () => {
  test('schema.parse on the real producer output — legacy and place-named keys absent', async () => {
    const { shipment, trip } = await mkShipmentWithTrip();
    const [container] = await db.insert(s.shipmentContainers).values({
      shipmentId: shipment.id,
      containerNumber: `ACC-${suffix}`,
    }).returning({ id: s.shipmentContainers.id, containerNumber: s.shipmentContainers.containerNumber });
    const [snapshot] = await db.insert(s.freightRateSnapshots).values({
      shipmentId: shipment.id,
      tripId: trip.id,
      freightAmount: '2500000',
      surchargeAmount: '300000',
      totalAmount: '2800000',
      rateTermsId: 1, pricingTableId: 1, fuelNormId: 1, fuelPricePeriodId: 1,
      billedKm: '10', liters: '0', fuelDelta: '0', sharePct: '0',
    }).returning({ id: s.freightRateSnapshots.id });
    const [hqgsType] = await db.insert(s.forwarderExpenseTypes).values({
      code: `ACC-HQGS-${suffix}`,
      name: 'Phí hải quan ACC',
      category: 'HQGS',
    }).returning({ id: s.forwarderExpenseTypes.id });
    const [phatSinhType] = await db.insert(s.forwarderExpenseTypes).values({
      code: `ACC-PS-${suffix}`,
      name: 'Phí phát sinh ACC',
      category: 'PHAT_SINH',
    }).returning({ id: s.forwarderExpenseTypes.id });
    const [opsRow] = await db.insert(s.opsExpenseEntries).values({
      shipmentId: shipment.id,
      shipmentContainerId: container.id,
      expenseTypeCode: `ACC-HQGS-${suffix}`,
      amount: '300000',
      customerChargeAmount: '150000',
      paidById: adminId,
      paidAt: '2026-10-01',
    }).returning({ id: s.opsExpenseEntries.id });
    const [psOpsRow] = await db.insert(s.opsExpenseEntries).values({
      shipmentId: shipment.id,
      shipmentContainerId: container.id,
      expenseTypeCode: `ACC-PS-${suffix}`,
      amount: '90000',
      customerChargeAmount: '60000',
      paidById: adminId,
      paidAt: '2026-10-01',
    }).returning({ id: s.opsExpenseEntries.id });
    const [carrierInfo] = await db.insert(s.tripCarrierInfo).values({
      tripId: trip.id,
      externalFreightCost: '8000000',
    }).returning({ id: s.tripCarrierInfo.id });
    const [tripLink] = await db.insert(s.tripContainers).values({
      tripId: trip.id,
      sourceShipmentId: shipment.id,
      sourceShipmentContainerId: container.id,
      containerNumber: `ACC-${suffix}`,
    }).returning({ id: s.tripContainers.id });
    await db.update(s.shipmentContainers).set({ psActualAmount: '500000' }).where(eq(s.shipmentContainers.id, container.id));
    try {
      const response = await api('GET', `/api/shipments/${shipment.id}/debit-detail`, accountantId);
      assert.equal(response.status, 200, JSON.stringify(response.body).slice(0, 200));
      const body = response.body as unknown as Record<string, unknown>;
      // The acceptance gate: the REAL service output must parse — any drift
      // between producer and contract fails here, not in a hand-written
      // fixture.
      const parsed = shipmentDebitDetailSchema.parse(body);
      const row = parsed.freightRows.find((r) => r.containerNumber === `ACC-${suffix}`);
      assert.ok(row, 'the container row renders');
      assert.equal(row!.freightCharge, 2500000);
      assert.equal(row!.fuelSurcharge, 300000);
      assert.equal(row!.contractFreightTotal, 2800000, 'the snapshot freight+surcharge total rides the explicit wire name');
      assert.equal(row!.psActual, 500000);
      assert.equal(row!.customsFee, 300000, 'container-scoped HQGS ops rows produce the auto customs column');
      assert.equal(row!.customsCustomerCharge, 150000, 'the shared schema preserves the separate customer-charge wire');
      const rawFreight = (body.freightRows as Array<Record<string, unknown>>).find((r) => r.containerNumber === `ACC-${suffix}`)!;
      assert.equal(rawFreight.customsCustomerCharge, 150000, 'SIS22-ACC-012: revenue uses negotiated HQGS charge, excluding payable cost and other fee categories');
      assert.equal(row!.payableFreight, 8000000, "Bảng 2.3 Cước trả = the trip's carrier-side freight");
      assert.equal(row!.phatSinhFee, 90000, 'container-scoped PHAT_SINH ops rows produce the phat-sinh column');
      assert.ok(!('freight' in row!), 'legacy field name is gone from the wire');
      assert.ok(!('surcharge' in row!), 'legacy field name is gone from the wire');
      assert.ok(!('total' in row!), 'the bare total word is gone from the wire');
      assert.ok(!('lachHuyenFee' in row!), 'no place-named field exists on the wire');
      const rawPayables = body.payables as Record<string, unknown>;
      for (const key of ['chiHoTotal', 'externalFreightCost', 'hqgsFee', 'phatSinhFee', 'unclassifiedFee', 'opsExpenseTotal', 'payableTotal']) {
        assert.ok(key in rawPayables, `payables carries ${key} on the raw wire`);
      }
      await db.update(s.opsExpenseEntries).set({ customerChargeAmount: '0' }).where(eq(s.opsExpenseEntries.id, opsRow.id));
      const zeroResponse = await api('GET', `/api/shipments/${shipment.id}/debit-detail`, accountantId);
      const zeroRow = (zeroResponse.body.freightRows as Array<Record<string, unknown>>).find((r) => r.containerNumber === `ACC-${suffix}`)!;
      assert.equal(zeroRow.customsCustomerCharge, 0, 'an explicit zero never falls back to payable cost');
      assert.equal(zeroRow.customsFee, 300000, 'changing recovery leaves the payable unchanged');
      await db.update(s.opsExpenseEntries).set({ expenseTypeCode: `ACC-HQGS-${suffix}` }).where(eq(s.opsExpenseEntries.id, psOpsRow.id));
      const combinedResponse = await api('GET', `/api/shipments/${shipment.id}/debit-detail`, accountantId);
      const combinedRow = (combinedResponse.body.freightRows as Array<Record<string, unknown>>).find((r) => r.containerNumber === `ACC-${suffix}`)!;
      assert.equal(combinedRow.customsCustomerCharge, 60000, 'multiple HQGS entries sum each customer charge once');
      assert.equal(combinedRow.customsFee, 390000, 'the same entries independently conserve payable spending');
    } finally {
      await db.delete(s.tripContainers).where(eq(s.tripContainers.id, tripLink.id));
      await db.delete(s.opsExpenseEntries).where(eq(s.opsExpenseEntries.id, opsRow.id));
      await db.delete(s.opsExpenseEntries).where(eq(s.opsExpenseEntries.id, psOpsRow.id));
      await db.delete(s.tripCarrierInfo).where(eq(s.tripCarrierInfo.id, carrierInfo.id));
      await db.delete(s.forwarderExpenseTypes).where(eq(s.forwarderExpenseTypes.id, hqgsType.id));
      await db.delete(s.forwarderExpenseTypes).where(eq(s.forwarderExpenseTypes.id, phatSinhType.id));
      await db.delete(s.freightRateSnapshots).where(eq(s.freightRateSnapshots.id, snapshot.id));
      await db.delete(s.shipmentContainers).where(eq(s.shipmentContainers.id, container.id));
    }
  });
});

describe('20260919 card _16 — thu khách recharge parity: detail == summary L1', () => {
  test('non-OTHER rows recharge at derived cost — detail total equals the summary L1 figure', async () => {
    const lot = await mkShipmentWithTrip({ linkTripToShipment: true });
    // Legacy typed sell ≠ buy on an invoiced row — exactly the figure HEAD
    // wrongly emits. The parity pin watches detail follow the derivation.
    await mkExpense(lot.trip.id, { expenseType: 'CUSTOMS', buyAmount: '400000', sellAmount: '500000' });
    const detail = await api('GET', `/api/shipments/${lot.shipment.id}/debit-detail`, accountantId);
    assert.equal(detail.status, 200, JSON.stringify(detail.body));
    const summary = await getShipmentDebitSummary({ customerId: lot.customer.id, lockStatus: 'ALL' });
    const l1 = summary.items.find((row) => row.shipmentId === lot.shipment.id);
    assert.equal(String(l1?.receivableTotal), '400000', 'summary L1 counts the derived buy');
    assert.equal(detail.body.thuKhachTotal, 400000, 'detail thuKhachTotal must equal the summary L1 figure');
    const rows = detail.body.chiHoRows as Array<{ items: Array<{ expenseType: string; thuKhach: number | null }> }>;
    const item = rows[0]!.items[0]!;
    assert.equal(item.expenseType, 'CUSTOMS');
    assert.equal(item.thuKhach, 400000, 'row recharge derives at cost pass-through, never the raw sell');
  });

  test('OTHER-row typed sell is untouched by the derivation', async () => {
    const lot = await mkShipmentWithTrip();
    await mkExpense(lot.trip.id, { expenseType: 'OTHER', feeName: 'Phí khác cột', buyAmount: '100000', sellAmount: '250000' });
    const detail = await api('GET', `/api/shipments/${lot.shipment.id}/debit-detail`, accountantId);
    assert.equal(detail.status, 200, JSON.stringify(detail.body));
    const rows = detail.body.chiHoRows as Array<{ otherFees: Array<{ amount: number | null }> }>;
    assert.equal(rows[0]!.otherFees[0]!.amount, 100000, 'otherFees keep carrying the cost cell');
  });
});

describe('20260919 card _20 — trip scope parity: dead trips leave both document layers', () => {
  test('canceled-trip expense is absent from detail rows AND summary L1; its row 404s on edit', async () => {
    const lot = await mkShipmentWithTrip({ linkTripToShipment: true });
    await mkExpense(lot.trip.id, { expenseType: 'FUEL', buyAmount: '400000', sellAmount: '0' });
    const [deadTrip] = await db.insert(s.trips).values({
      fulfillmentId: lot.fulfillment.id,
      shipmentId: lot.shipment.id,
      customerId: lot.customer.id,
      routeId: lot.route.id,
      departureDate: '2026-01-02',
      status: 'CANCELED',
    }).returning({ id: s.trips.id });
    createdTripIds.push(deadTrip.id);
    const deadExpense = await mkExpense(deadTrip.id, { expenseType: 'FUEL', buyAmount: '999000', sellAmount: '0' });

    const detail = await api('GET', `/api/shipments/${lot.shipment.id}/debit-detail`, accountantId);
    assert.equal(detail.status, 200, JSON.stringify(detail.body));
    const rendered = (detail.body.chiHoRows as Array<{ items: Array<{ id: number }> }>)
      .flatMap((row) => row.items.map((item) => item.id));
    assert.ok(!rendered.includes(deadExpense), 'dead trip expense must not render in Lớp 2');
    assert.equal(detail.body.thuKhachTotal, 400000, 'detail total counts only the live trip');

    const summary = await getShipmentDebitSummary({ customerId: lot.customer.id, lockStatus: 'ALL' });
    const l1 = summary.items.find((row) => row.shipmentId === lot.shipment.id);
    assert.equal(String(l1?.receivableTotal), '400000', 'summary L1 counts only the live trip');

    const edit = await api('PUT', `/api/shipments/${lot.shipment.id}/debit-edits`, accountantId, {
      edits: [{ expenseId: deadExpense, buyAmount: 1 }],
    });
    assert.equal(edit.status, 404, `dead-trip row must not be editable — got ${edit.status}`);
  });
});

describe('20260919 freight scope parity: canceled legs leave L1 like they leave Lớp 2', () => {
  test('canceled-trip freight is out of L1; active legs and shipment-issue (null-trip) freezes still count', async () => {
    const lot = await mkShipmentWithTrip({ linkTripToShipment: true });
    const [deadTrip] = await db.insert(s.trips).values({
      fulfillmentId: lot.fulfillment.id,
      shipmentId: lot.shipment.id,
      customerId: lot.customer.id,
      routeId: lot.route.id,
      departureDate: '2026-01-02',
      status: 'CANCELED',
    }).returning({ id: s.trips.id });
    createdTripIds.push(deadTrip.id);
    const [container] = await db.insert(s.shipmentContainers).values({
      shipmentId: lot.shipment.id,
      containerNumber: `FSP-${suffix}`,
    }).returning({ id: s.shipmentContainers.id, containerNumber: s.shipmentContainers.containerNumber });
    const [tripLink] = await db.insert(s.tripContainers).values({
      tripId: lot.trip.id,
      sourceShipmentId: lot.shipment.id,
      sourceShipmentContainerId: container.id,
      containerNumber: `FSP-${suffix}`,
    }).returning({ id: s.tripContainers.id });
    const mkSnapshot = (tripId: number | null, total: string) => db.insert(s.freightRateSnapshots).values({
      shipmentId: lot.shipment.id,
      tripId,
      freightAmount: total,
      surchargeAmount: '0',
      totalAmount: total,
      rateTermsId: 1, pricingTableId: 1, fuelNormId: 1, fuelPricePeriodId: 1,
      billedKm: '10', liters: '0', fuelDelta: '0', sharePct: '0',
    }).returning({ id: s.freightRateSnapshots.id });
    const [liveSnapshot] = await mkSnapshot(lot.trip.id, '400000');
    const [deadSnapshot] = await mkSnapshot(deadTrip.id, '999000');
    // Shipment-issue freeze: the snapshot was stamped when the lot itself was
    // issued, before any leg existed — no trip to point at.
    const [issueSnapshot] = await mkSnapshot(null, '50000');
    try {
      const summary = await getShipmentDebitSummary({ customerId: lot.customer.id, lockStatus: 'ALL' });
      const l1 = summary.items.find((row) => row.shipmentId === lot.shipment.id);
      // A canceled leg never hauls, so its freight never reaches L1. The
      // dispatch freeze of the live leg SUPERSEDES the shipment-issue (trip-
      // NULL) freeze of the same freight anchor — L1 reads the live leg once
      // and now matches Lớp 2 exactly (the intake-only lot remains the only
      // L1-superset case: Lớp 2 cannot render a trip-NULL row).
      assert.equal(String(l1?.freightAuto), '400000', 'L1 counts the live leg 400k (supersede of the 50k intake freeze), never the canceled 999k');

      const detail = await api('GET', `/api/shipments/${lot.shipment.id}/debit-detail`, accountantId);
      assert.equal(detail.status, 200, JSON.stringify(detail.body).slice(0, 200));
      const freightRendered = (detail.body.freightRows as Array<{ contractFreightTotal: number }>)
        .reduce((acc, row) => acc + row.contractFreightTotal, 0);
      assert.equal(freightRendered, 400000, 'Lớp 2 renders only the live leg');
    } finally {
      await db.delete(s.freightRateSnapshots).where(inArray(s.freightRateSnapshots.id, [liveSnapshot.id, deadSnapshot.id, issueSnapshot.id]));
      await db.delete(s.tripContainers).where(eq(s.tripContainers.id, tripLink.id));
      await db.delete(s.shipmentContainers).where(eq(s.shipmentContainers.id, container.id));
    }
  });
});
