import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { inArray } from 'drizzle-orm';

import { client, db } from '../db';
import * as s from '../db/schema';
import { processExpenseApproval } from '../services/approval.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdTripIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdCargoTypeIds: number[] = [];
const createdExpenseIds: number[] = [];
const createdExpenseTypeIds: number[] = [];
const createdUserIds: number[] = [];

let makerId: number;
let accountantId: number;
let managerId: number;

before(async () => {
  const users = await db.insert(s.users).values([
    { username: `q13-maker-${suffix}`, passwordHash: 'x', role: 'ACCOUNTANT', status: 'ACTIVE' },
    { username: `q13-accountant-${suffix}`, passwordHash: 'x', role: 'ACCOUNTANT', status: 'ACTIVE' },
    { username: `q13-manager-${suffix}`, passwordHash: 'x', role: 'MANAGER', status: 'ACTIVE' },
  ]).returning({ id: s.users.id });
  [makerId, accountantId, managerId] = users.map((row) => row.id);
  createdUserIds.push(...users.map((row) => row.id));
});

async function mkTrip(tag: string) {
  const [customer] = await db.insert(s.customers).values({
    name: `Q13 cust ${tag} ${suffix}`,
  }).returning();
  createdCustomerIds.push(customer.id);
  const [route] = await db.insert(s.routes).values({
    name: `Q13 route ${tag} ${suffix}`,
  }).returning();
  createdRouteIds.push(route.id);
  const [cargoType] = await db.insert(s.cargoTypes).values({
    name: `Q13 cargo ${tag} ${suffix}`,
  }).returning();
  createdCargoTypeIds.push(cargoType.id);
  const [trip] = await db.insert(s.trips).values({
    tripCode: `Q13-${tag}-${suffix}`.slice(0, 50),
    customerId: customer.id,
    routeId: route.id,
    cargoTypeId: cargoType.id,
    status: 'COMPLETED',
    departureDate: '2026-07-18',
    carrierType: 'OWN',
  }).returning();
  createdTripIds.push(trip.id);
  return trip;
}

async function mkExpenseType() {
  const [expenseType] = await db.insert(s.forwarderExpenseTypes).values({
    code: `Q13-NO-INV-${suffix}`.slice(0, 50),
    name: `Q13 no-invoice ${suffix}`,
    requiresInvoice: false,
    substituteEvidenceAllowed: true,
    noInvoiceEvidenceTypes: ['RECEIPT'],
  }).returning();
  createdExpenseTypeIds.push(expenseType.id);
  return expenseType;
}

async function mkExpense(input: {
  tripId: number;
  expenseTypeCode: string;
  buyAmount: string;
  payeeName: string;
  approvalStatus?: string;
}) {
  const [expense] = await db.insert(s.tripExpenses).values({
    tripId: input.tripId,
    createdBy: makerId,
    expenseType: input.expenseTypeCode,
    buyAmount: input.buyAmount,
    sellAmount: '0',
    expenseDate: '2026-07-18',
    payeeName: input.payeeName,
    invoiceNumber: null,
    invoiceDate: null,
    note: 'Chi bốc xếp có biên nhận hợp lệ và cần xử lý đúng ngưỡng cộng dồn trong ngày',
    noInvoiceEvidenceTypes: ['RECEIPT'],
    approvalStatus: input.approvalStatus ?? 'PENDING',
  }).returning();
  createdExpenseIds.push(expense.id);
  return expense;
}

async function runApproval(
  tripId: number,
  expenseId: number,
  actorId: number,
  actorRole: 'ACCOUNTANT' | 'MANAGER',
) {
  try {
    return await processExpenseApproval(
      tripId,
      expenseId,
      actorId,
      actorRole,
      'APPROVED',
    );
  } catch (error) {
    const err = error as Error & { statusCode?: number };
    return { error: err.message, status: err.statusCode ?? 500 };
  }
}

after(async () => {
  try {
    if (createdExpenseIds.length > 0) {
      await db.delete(s.tripExpenses).where(inArray(s.tripExpenses.id, createdExpenseIds));
    }
    if (createdTripIds.length > 0) {
      await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
    }
    if (createdCargoTypeIds.length > 0) {
      await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, createdCargoTypeIds));
    }
    if (createdRouteIds.length > 0) {
      await db.delete(s.routes).where(inArray(s.routes.id, createdRouteIds));
    }
    if (createdCustomerIds.length > 0) {
      await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
    }
    if (createdExpenseTypeIds.length > 0) {
      await db.delete(s.forwarderExpenseTypes).where(inArray(s.forwarderExpenseTypes.id, createdExpenseTypeIds));
    }
    if (createdUserIds.length > 0) {
      await db.delete(s.users).where(inArray(s.users.id, createdUserIds));
    }
  } catch (error) {
    console.warn('[q13-no-invoice-concurrency] cleanup:', (error as Error).message);
  }
  await client.end();
});

describe('Q13/Q14 no-invoice aggregate concurrency', () => {
  test('same payee/day/category approvals across trips do not under-tier concurrent accountant approvals and still allow director-tier approval', async () => {
    const expenseType = await mkExpenseType();
    const baselineTrip = await mkTrip('baseline');
    const firstTrip = await mkTrip('first');
    const secondTrip = await mkTrip('second');

    await mkExpense({
      tripId: baselineTrip.id,
      expenseTypeCode: expenseType.code,
      buyAmount: '5900000',
      payeeName: 'Tran Thi B',
      approvalStatus: 'APPROVED',
    });

    const firstExpense = await mkExpense({
      tripId: firstTrip.id,
      expenseTypeCode: expenseType.code,
      buyAmount: '2200000',
      payeeName: '  TRAN    THI B ',
    });
    const secondExpense = await mkExpense({
      tripId: secondTrip.id,
      expenseTypeCode: expenseType.code,
      buyAmount: '2200000',
      payeeName: 'tran thi b',
    });

    const results = await Promise.all([
      runApproval(firstTrip.id, firstExpense.id, accountantId, 'ACCOUNTANT'),
      runApproval(secondTrip.id, secondExpense.id, accountantId, 'ACCOUNTANT'),
    ]);

    const rejections = results.filter((result) => 'error' in result);

    assert.equal(rejections.length, 2, JSON.stringify(results));
    assert.ok(rejections.every((result) => result.status === 403), JSON.stringify(results));
    assert.ok(rejections.every((result) => /tổng ngày|giám đốc/i.test(result.error)), JSON.stringify(results));

    const rows = await db.select({
      id: s.tripExpenses.id,
      approvalStatus: s.tripExpenses.approvalStatus,
      version: s.tripExpenses.version,
    }).from(s.tripExpenses).where(inArray(s.tripExpenses.id, [firstExpense.id, secondExpense.id]));
    assert.ok(rows.every((row) => row.approvalStatus === 'PENDING'));
    assert.ok(rows.every((row) => row.version === 1));

    const managerApprovals = await Promise.all([
      runApproval(firstTrip.id, firstExpense.id, managerId, 'MANAGER'),
      runApproval(secondTrip.id, secondExpense.id, managerId, 'MANAGER'),
    ]);
    assert.ok(managerApprovals.every((result) => 'ok' in result), JSON.stringify(managerApprovals));

    const afterDirectorApprovals = await db.select({
      id: s.tripExpenses.id,
      approvalStatus: s.tripExpenses.approvalStatus,
    }).from(s.tripExpenses).where(inArray(s.tripExpenses.id, [firstExpense.id, secondExpense.id]));
    assert.ok(afterDirectorApprovals.every((row) => row.approvalStatus === 'APPROVED'));
  });
});
