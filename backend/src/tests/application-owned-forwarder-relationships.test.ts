import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';

import { client, db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import { lockSupplierRow } from '../services/application-relationship.service';
import { createTripExpense } from '../services/forwarder.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ids = {
  users: [] as number[],
  suppliers: [] as number[],
  expenses: [] as number[],
  containers: [] as number[],
  trips: [] as number[],
  customers: [] as number[],
  routes: [] as number[],
  expenseTypes: [] as number[],
};

let forwarderId: number;
let creatorId: number;
let wrongRoleUserId: number;
let tripId: number;
let otherTripId: number;
let containerId: number;
let supplierId: number;
let expenseTypeCode: string;

function expenseInput(overrides: Partial<Parameters<typeof createTripExpense>[1]> = {}) {
  return {
    tripId,
    forwarderId,
    createdBy: creatorId,
    expenseType: expenseTypeCode,
    buyAmount: '100000',
    sellAmount: '0',
    settlementMethod: 'OPS_ADVANCE',
    supplierId,
    expenseDate: '2026-08-03',
    invoiceNumber: `INV-${suffix}`,
    note: 'Kiểm tra quan hệ do ứng dụng quản lý',
    ...overrides,
  };
}

async function expectRelationshipError(
  input: Parameters<typeof createTripExpense>[1],
  pattern: RegExp,
) {
  await assert.rejects(
    () => createTripExpense(db, input),
    (error: unknown) => error instanceof ApiError
      && error.statusCode >= 400
      && error.statusCode < 500
      && pattern.test(error.message),
  );
}

before(async () => {
  const [customer] = await db.insert(s.customers).values({
    name: `Forwarder relationship customer ${suffix}`,
  }).returning();
  ids.customers.push(customer.id);
  const [route] = await db.insert(s.routes).values({
    name: `Forwarder relationship route ${suffix}`,
  }).returning();
  ids.routes.push(route.id);
  const users = await db.insert(s.users).values([
    {
      username: `forwarder-relationship-${suffix}`,
      passwordHash: 'test-only',
      role: 'OPS',
      status: 'ACTIVE',
    },
    {
      username: `creator-relationship-${suffix}`,
      passwordHash: 'test-only',
      role: 'ACCOUNTANT',
      status: 'ACTIVE',
    },
    {
      username: `wrong-role-relationship-${suffix}`,
      passwordHash: 'test-only',
      role: 'DRIVER',
      status: 'ACTIVE',
    },
  ]).returning();
  ids.users.push(...users.map((user) => user.id));
  [forwarderId, creatorId, wrongRoleUserId] = users.map((user) => user.id);

  expenseTypeCode = `REL_${suffix}`.slice(0, 50);
  const [expenseType] = await db.insert(s.forwarderExpenseTypes).values({
    code: expenseTypeCode,
    name: `Loại phí quan hệ ${suffix}`,
    status: 'ACTIVE',
  }).returning();
  ids.expenseTypes.push(expenseType.id);
  const [supplier] = await db.insert(s.suppliers).values({
    name: `Nhà cung cấp quan hệ ${suffix}`,
    status: 'ACTIVE',
  }).returning();
  supplierId = supplier.id;
  ids.suppliers.push(supplier.id);
  const trips = await db.insert(s.trips).values([
    {
      tripCode: `FR-${suffix}-A`.slice(0, 50),
      customerId: customer.id,
      routeId: route.id,
      departureDate: '2026-08-03',
      status: 'CREATED',
    },
    {
      tripCode: `FR-${suffix}-B`.slice(0, 50),
      customerId: customer.id,
      routeId: route.id,
      departureDate: '2026-08-03',
      status: 'CREATED',
    },
  ]).returning();
  ids.trips.push(...trips.map((trip) => trip.id));
  [tripId, otherTripId] = trips.map((trip) => trip.id);
  const [container] = await db.insert(s.tripContainers).values({
    tripId: otherTripId,
    containerNumber: `CONT-${suffix}`.slice(0, 50),
    createdBy: creatorId,
  }).returning();
  containerId = container.id;
  ids.containers.push(container.id);
});

after(async () => {
  try {
    if (ids.expenses.length > 0) await db.delete(s.tripExpenses).where(inArray(s.tripExpenses.id, ids.expenses));
    if (ids.containers.length > 0) await db.delete(s.tripContainers).where(inArray(s.tripContainers.id, ids.containers));
    if (ids.trips.length > 0) await db.delete(s.trips).where(inArray(s.trips.id, ids.trips));
    if (ids.suppliers.length > 0) await db.delete(s.suppliers).where(inArray(s.suppliers.id, ids.suppliers));
    if (ids.expenseTypes.length > 0) await db.delete(s.forwarderExpenseTypes).where(inArray(s.forwarderExpenseTypes.id, ids.expenseTypes));
    if (ids.routes.length > 0) await db.delete(s.routes).where(inArray(s.routes.id, ids.routes));
    if (ids.customers.length > 0) await db.delete(s.customers).where(inArray(s.customers.id, ids.customers));
    if (ids.users.length > 0) await db.delete(s.users).where(inArray(s.users.id, ids.users));
  } finally {
    await client.end();
  }
});

describe('application-owned forwarder expense relationships', () => {
  test('rejects missing or invalid parent references before insert', async () => {
    await expectRelationshipError(expenseInput({ tripId: 2_147_483_647 }), /chuyến đi/i);
    await expectRelationshipError(expenseInput({ forwarderId: wrongRoleUserId }), /nhân viên giao nhận/i);
    await expectRelationshipError(expenseInput({ createdBy: 2_147_483_647 }), /người tạo/i);
    await expectRelationshipError(expenseInput({ supplierId: 2_147_483_647 }), /nhà cung cấp/i);
    await expectRelationshipError(expenseInput({ tripContainerId: containerId }), /container không thuộc chuyến/i);
    await expectRelationshipError(expenseInput({ liftPricingId: 2_147_483_647 }), /biểu phí nâng hạ/i);
    await db.update(s.users).set({ status: 'INACTIVE' }).where(eq(s.users.id, forwarderId));
    await expectRelationshipError(expenseInput(), /nhân viên giao nhận/i);
    await db.update(s.users).set({ status: 'ACTIVE' }).where(eq(s.users.id, forwarderId));
    await db.update(s.suppliers).set({ status: 'INACTIVE' }).where(eq(s.suppliers.id, supplierId));
    await expectRelationshipError(expenseInput(), /nhà cung cấp/i);
    await db.update(s.suppliers).set({ status: 'ACTIVE' }).where(eq(s.suppliers.id, supplierId));

    const persisted = await db.select({ id: s.tripExpenses.id }).from(s.tripExpenses)
      .where(eq(s.tripExpenses.note, 'Kiểm tra quan hệ do ứng dụng quản lý'));
    assert.equal(persisted.length, 0);
  });

  test('supplier retirement racing expense creation cannot create an orphan', async () => {
    const raceSupplier = await db.insert(s.suppliers).values({
      name: `Nhà cung cấp race ${suffix}`,
      status: 'ACTIVE',
    }).returning().then((rows) => rows[0]);
    ids.suppliers.push(raceSupplier.id);

    const outcomes = await Promise.allSettled([
      createTripExpense(db, expenseInput({
        supplierId: raceSupplier.id,
        invoiceNumber: `INV-RACE-${suffix}`,
        note: 'Chi phí cạnh tranh nghỉ dùng nhà cung cấp',
      })),
      db.transaction(async (tx) => {
        await lockSupplierRow(tx, raceSupplier.id, { mode: 'update' });
        await tx.update(s.suppliers)
          .set({ status: 'INACTIVE', updatedAt: new Date() })
          .where(eq(s.suppliers.id, raceSupplier.id));
      }),
    ]);
    const created = outcomes[0].status === 'fulfilled' ? outcomes[0].value : null;
    if (created) ids.expenses.push(created.id);

    const [supplier] = await db.select({ id: s.suppliers.id }).from(s.suppliers)
      .where(eq(s.suppliers.id, raceSupplier.id)).limit(1);
    const expense = created
      ? await db.select({ supplierId: s.tripExpenses.supplierId }).from(s.tripExpenses)
        .where(eq(s.tripExpenses.id, created.id)).limit(1).then((rows) => rows[0])
      : null;
    assert.ok(supplier, 'retirement keeps the referenced supplier row available for history');
    assert.ok(!expense || expense.supplierId === supplier.id, 'a committed expense must retain a real supplier parent');
  });
});
