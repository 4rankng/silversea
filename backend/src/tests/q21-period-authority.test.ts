import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { client, db } from '../db';
import * as s from '../db/schema';
import { saveDocument, getDocument, deleteDocument } from '../services/billingDocument.service';
import {
  assertFuelPeriodCanAbsorbLateApproval,
  closePeriodLock,
  getClosedPeriodLock,
  reopenPeriodLock,
  resolveDebitNotePeriodAuthority,
  resolveFuelPeriodAuthority,
} from '../services/period-lock.service';
import { closeSalaryPeriod, reopenSalaryPeriod } from '../services/salary-period-close.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdCargoTypeIds: number[] = [];
const createdTripIds: number[] = [];
const createdExpenseIds: number[] = [];
const createdDocumentIds: number[] = [];
const createdPeriodLockIds: number[] = [];
const createdUserIds: number[] = [];

function adHocLine(amount: number, description: string) {
  return {
    sourceType: 'ADHOC' as const,
    sourceId: null,
    lineType: 'ADHOC' as const,
    typeLabel: 'Điều chỉnh',
    unit: 'lần',
    description,
    baseAmount: amount,
    amountOverride: null,
    excluded: false,
    sortOrder: 0,
  };
}

async function mkCustomer(overrides: Partial<typeof s.customers.$inferInsert> = {}) {
  const [row] = await db.insert(s.customers).values({
    name: `Q21 customer ${suffix}-${createdCustomerIds.length}`,
    paymentTermDays: 0,
    ...overrides,
  }).returning();
  createdCustomerIds.push(row.id);
  return row;
}

async function mkTrip(customerId: number, departureDate: string) {
  const [route] = await db.insert(s.routes).values({
    name: `Q21 route ${suffix}-${createdRouteIds.length}`,
  }).returning({ id: s.routes.id });
  createdRouteIds.push(route.id);
  const [cargoType] = await db.insert(s.cargoTypes).values({
    name: `Q21 cargo ${suffix}-${createdCargoTypeIds.length}`,
  }).returning({ id: s.cargoTypes.id });
  createdCargoTypeIds.push(cargoType.id);
  const [trip] = await db.insert(s.trips).values({
    tripCode: `Q21-${suffix}-${createdTripIds.length}`.slice(0, 50),
    customerId,
    routeId: route.id,
    cargoTypeId: cargoType.id,
    status: 'CREATED',
    departureDate,
    carrierType: 'OWN',
  }).returning();
  createdTripIds.push(trip.id);
  return trip;
}

async function mkExpense(tripId: number, invoiceDate: string) {
  const [expense] = await db.insert(s.tripExpenses).values({
    tripId,
    expenseType: 'fuel-topup',
    buyAmount: '250000',
    sellAmount: '300000',
    approvalStatus: 'APPROVED',
    invoiceDate,
    note: 'Q21 late fuel expense',
  }).returning();
  createdExpenseIds.push(expense.id);
  return expense;
}

async function mkUser(role: 'ADMIN' | 'ACCOUNTANT' | 'MANAGER', tag: string) {
  const [user] = await db.insert(s.users).values({
    username: `q21-${role}-${tag}-${suffix}-${createdUserIds.length}`,
    passwordHash: 'x',
    role,
    status: 'ACTIVE',
  }).returning();
  createdUserIds.push(user.id);
  return user;
}

async function trackLock(ref: Awaited<ReturnType<typeof resolveDebitNotePeriodAuthority>> | ReturnType<typeof resolveFuelPeriodAuthority>) {
  const actor = await mkUser('ADMIN', 'lock');
  const lock = await db.transaction((tx) => closePeriodLock(tx, ref, actor.id, 'q21 test'));
  createdPeriodLockIds.push(lock.id);
  return lock;
}

describe('Q21 period authority', () => {
  test('POST same-period save cannot overwrite a confirmed debit note', async () => {
    const customer = await mkCustomer();
    const created = await saveDocument({
      type: 'DEBIT_NOTE',
      entityType: 'CUSTOMER',
      entityId: customer.id,
      entityName: customer.name,
      rangeFrom: '2026-07-01',
      rangeTo: '2026-07-31',
      note: 'Q21 original note',
      lines: [adHocLine(125000, 'Dòng gốc')],
    }, null);
    createdDocumentIds.push(created.id);

    await db.update(s.billingDocuments)
      .set({ debitNoteStatus: 'CONFIRMED', updatedAt: new Date() })
      .where(eq(s.billingDocuments.id, created.id));

    const beforeLedger = await db.select({
      id: s.ledger.id,
      debit: s.ledger.debit,
      credit: s.ledger.credit,
    }).from(s.ledger).where(eq(s.ledger.txnId, created.id));

    await assert.rejects(
      () => saveDocument({
        type: 'DEBIT_NOTE',
        entityType: 'CUSTOMER',
        entityId: customer.id,
        entityName: `${customer.name} changed`,
        rangeFrom: '2026-07-01',
        rangeTo: '2026-07-31',
        note: 'Q21 overwritten note',
        lines: [adHocLine(999000, 'Dòng ghi đè')],
      }, null),
      (err: Error & { statusCode?: number }) =>
        err.statusCode === 409 && /khóa|xác nhận/i.test(err.message),
    );

    const after = await getDocument(created.id);
    assert.equal(after.note, 'Q21 original note');
    assert.equal(after.lines.length, 1);
    assert.equal(after.lines[0]?.description, 'Dòng gốc');
    assert.equal(after.lines[0]?.baseAmount, 125000);

    const afterLedger = await db.select({
      id: s.ledger.id,
      debit: s.ledger.debit,
      credit: s.ledger.credit,
    }).from(s.ledger).where(eq(s.ledger.txnId, created.id));
    assert.deepEqual(afterLedger, beforeLedger);
  });

  test('locked monthly debit-note period rejects direct create and delete', async () => {
    const customer = await mkCustomer();
    const authority = await db.transaction((tx) =>
      resolveDebitNotePeriodAuthority(tx, customer.id, '2026-08-01', '2026-08-31'));
    await trackLock(authority);

    await assert.rejects(
      () => saveDocument({
        type: 'DEBIT_NOTE',
        entityType: 'CUSTOMER',
        entityId: customer.id,
        entityName: customer.name,
        rangeFrom: '2026-08-01',
        rangeTo: '2026-08-31',
        lines: [adHocLine(200000, 'Bị khóa')],
      }, null),
      (err: Error & { statusCode?: number }) => err.statusCode === 409 && /điều chỉnh/i.test(err.message),
    );

    const openDoc = await saveDocument({
      type: 'DEBIT_NOTE',
      entityType: 'CUSTOMER',
      entityId: customer.id,
      entityName: customer.name,
      rangeFrom: '2026-09-01',
      rangeTo: '2026-09-30',
      lines: [adHocLine(300000, 'Mở')],
    }, null);
    createdDocumentIds.push(openDoc.id);
    await deleteDocument(openDoc.id);
    const [deleted] = await db.select({ deletedAt: s.billingDocuments.deletedAt })
      .from(s.billingDocuments)
      .where(eq(s.billingDocuments.id, openDoc.id))
      .limit(1);
    assert.ok(deleted?.deletedAt, 'open-period document can still be deleted');
  });

  test('late debit-note adjustment in current open period links to the original locked period', async () => {
    const customer = await mkCustomer();
    const trip = await mkTrip(customer.id, '2026-05-12');
    const expense = await mkExpense(trip.id, '2026-05-12');

    const lockedAuthority = await db.transaction((tx) =>
      resolveDebitNotePeriodAuthority(tx, customer.id, '2026-05-01', '2026-05-31'));
    const locked = await trackLock(lockedAuthority);

    const doc = await saveDocument({
      type: 'DEBIT_NOTE',
      entityType: 'CUSTOMER',
      entityId: customer.id,
      entityName: customer.name,
      rangeFrom: '2026-06-01',
      rangeTo: '2026-06-30',
      lines: [{
        sourceType: 'EXPENSE',
        sourceId: expense.id,
        lineType: 'SERVICE_FEE',
        typeLabel: 'Phí nhiên liệu muộn',
        unit: 'lần',
        description: 'Điều chỉnh nhiên liệu tháng trước',
        baseAmount: 300000,
        amountOverride: null,
        excluded: false,
        sortOrder: 0,
      }],
    }, null);
    createdDocumentIds.push(doc.id);

    const links = await db.select()
      .from(s.billingDocumentSourcePeriodLocks)
      .where(eq(s.billingDocumentSourcePeriodLocks.documentId, doc.id));
    assert.equal(links.length, 1);
    assert.equal(links[0]?.periodLockId, locked.id);
  });

  test('weekly customer contract rejects ranges that cross weeks', async () => {
    const customer = await mkCustomer({ debitNoteMode: 'WEEKLY' });
    const authority = await db.transaction((tx) =>
      resolveDebitNotePeriodAuthority(tx, customer.id, '2026-07-06', '2026-07-12'));
    assert.equal(authority.cycle, 'WEEKLY');
    assert.equal(authority.periodStart, '2026-07-06');
    assert.equal(authority.periodEnd, '2026-07-12');

    await assert.rejects(
      () => db.transaction((tx) =>
        resolveDebitNotePeriodAuthority(tx, customer.id, '2026-07-10', '2026-07-14')),
      (err: Error & { statusCode?: number }) => err.statusCode === 400 && /một tuần/i.test(err.message),
    );
  });

  test('debit-note reopen is blocked once the period has been issued or paid', async () => {
    const admin = await mkUser('ADMIN', 'reopen');
    const customer = await mkCustomer();
    const document = await saveDocument({
      type: 'DEBIT_NOTE',
      entityType: 'CUSTOMER',
      entityId: customer.id,
      entityName: customer.name,
      rangeFrom: '2026-10-01',
      rangeTo: '2026-10-31',
      lines: [adHocLine(400000, 'Đã phát hành')],
    }, null);
    createdDocumentIds.push(document.id);
    await db.update(s.billingDocuments)
      .set({ debitNoteStatus: 'SENT', updatedAt: new Date() })
      .where(eq(s.billingDocuments.id, document.id));
    const authority = await db.transaction((tx) =>
      resolveDebitNotePeriodAuthority(tx, customer.id, '2026-10-01', '2026-10-31'));
    await trackLock(authority);

    await assert.rejects(
      () => db.transaction((tx) => reopenPeriodLock(tx, authority, admin.id, 'Không hợp lệ')),
      (err: Error & { statusCode?: number }) => err.statusCode === 409 && /phát hành|khóa/i.test(err.message),
    );
  });

  test('fuel late approval is blocked when both source and current months are closed', async () => {
    const may = await trackLock(resolveFuelPeriodAuthority('2026-05-12'));
    const june = await trackLock(resolveFuelPeriodAuthority('2026-06-15'));
    assert.ok(may.id > 0 && june.id > 0);

    await assert.rejects(
      () => db.transaction(async (tx) => {
        const lock = await getClosedPeriodLock(tx, resolveFuelPeriodAuthority('2026-05-12'));
        assert.ok(lock);
        await assertFuelPeriodCanAbsorbLateApproval(tx, '2026-05-12', '2026-06-15');
      }),
      (err: Error & { statusCode?: number }) => err.statusCode === 409 && /nhiên liệu/i.test(err.message),
    );
  });

  test('salary close mirrors into the shared period-lock authority', async () => {
    const admin = await mkUser('ADMIN', 'salary');
    const result = await closeSalaryPeriod({
      period: '2099-11',
      actorId: admin.id,
      actorRole: 'ADMIN',
      note: `Q21 salary ${suffix}`,
    });
    const sharedLock = await db.select()
      .from(s.periodLocks)
      .where(and(
        eq(s.periodLocks.domain, 'SALARY'),
        eq(s.periodLocks.periodKey, '2099-11'),
      ))
      .limit(1);
    if (sharedLock[0]) createdPeriodLockIds.push(sharedLock[0].id);
    assert.equal(sharedLock[0]?.status, 'CLOSED');
    assert.equal(result.status, 'CLOSED');

    await reopenSalaryPeriod({
      period: '2099-11',
      actorId: admin.id,
      actorRole: 'ADMIN',
      note: `Q21 salary reopen ${suffix}`,
    });
    const [reopened] = await db.select({ status: s.periodLocks.status })
      .from(s.periodLocks)
      .where(and(
        eq(s.periodLocks.domain, 'SALARY'),
        eq(s.periodLocks.periodKey, '2099-11'),
      ))
      .limit(1);
    assert.equal(reopened?.status, 'REOPENED');
  });
});

after(async () => {
  try {
    if (createdDocumentIds.length > 0) {
      await db.delete(s.billingDocumentSourcePeriodLocks)
        .where(inArray(s.billingDocumentSourcePeriodLocks.documentId, createdDocumentIds));
      await db.delete(s.billingDocumentLines)
        .where(inArray(s.billingDocumentLines.documentId, createdDocumentIds));
      await db.delete(s.billingDocuments)
        .where(inArray(s.billingDocuments.id, createdDocumentIds));
    }
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
    if (createdPeriodLockIds.length > 0) {
      await db.delete(s.periodLocks).where(inArray(s.periodLocks.id, createdPeriodLockIds));
    }
    await db.delete(s.salaryPeriodCloses)
      .where(sql`${s.salaryPeriodCloses.note} like ${`Q21 salary ${suffix}%`} or ${s.salaryPeriodCloses.note} like ${`Q21 salary reopen ${suffix}%`}`);
    if (createdCustomerIds.length > 0) {
      await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
    }
    if (createdUserIds.length > 0) {
      await db.delete(s.users).where(inArray(s.users.id, createdUserIds));
    }
  } catch (err) {
    console.warn('[q21-period-authority.test] cleanup partial:', (err as Error).message);
  }
  await client.end();
});
