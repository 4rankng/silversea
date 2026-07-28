import { after, describe, test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { client, db } from '../db';
import * as s from '../db/schema';
import { saveDocument, getDocument, deleteDocument } from '../services/billingDocument.service';
import {
  approveGovernanceAction,
  checkGovernanceAction,
} from '../services/adjustment-governance.service';
import { approveFuelInvoice, createFuelInvoice } from '../services/fuel-invoice.service';
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
const createdSalaryConfirmationIds: number[] = [];
const createdSupplierIds: number[] = [];
const createdTruckIds: number[] = [];
const createdFuelInvoiceIds: number[] = [];
const createdGovernanceActionIds: number[] = [];

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

async function mkSupplier() {
  const [supplier] = await db.insert(s.suppliers).values({
    name: `Q21 fuel supplier ${suffix}-${createdSupplierIds.length}`,
    isFuelSupplier: true,
  }).returning();
  createdSupplierIds.push(supplier.id);
  return supplier;
}

async function mkTruck() {
  const [truck] = await db.insert(s.trucks).values({
    licensePlate: `Q21-${suffix.slice(-8)}-${createdTruckIds.length}`,
  }).returning();
  createdTruckIds.push(truck.id);
  return truck;
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

async function confirmAllDriversForPeriod(year: number, month: number, actorId: number) {
  const drivers = await db.select({ id: s.drivers.id }).from(s.drivers);
  if (drivers.length === 0) return;
  const inserted = await db.insert(s.salaryConfirmations).values(drivers.map((driver) => ({
    driverId: driver.id,
    year,
    month,
    status: 'CONFIRMED' as const,
    confirmedBy: actorId,
    confirmedAt: new Date(),
  }))).onConflictDoNothing().returning({ id: s.salaryConfirmations.id });
  createdSalaryConfirmationIds.push(...inserted.map((row) => row.id));
}

async function withMockedNow<T>(
  context: TestContext,
  isoDateTime: string,
  run: () => Promise<T>,
): Promise<T> {
  context.mock.timers.enable({
    apis: ['Date'],
    now: new Date(isoDateTime),
  });
  try {
    return await run();
  } finally {
    context.mock.timers.reset();
  }
}

async function mkFuelInvoiceForApproval(params: {
  sourceDate: string;
  tag: string;
  creatorId: number;
}) {
  const supplier = await mkSupplier();
  const truck = await mkTruck();
  const trip = await mkTrip((await mkCustomer()).id, params.sourceDate);
  await db.update(s.trips)
    .set({
      truckId: truck.id,
      fuelSupplierId: supplier.id,
      totalFuelCost: '2200000',
      updatedAt: new Date(),
    })
    .where(eq(s.trips.id, trip.id));
  const expense = await mkExpense(trip.id, params.sourceDate);
  const voucherReference = `PXD-Q21-${params.tag}-${suffix}`;
  await db.update(s.tripExpenses)
    .set({
      supplierId: supplier.id,
      expenseDate: params.sourceDate,
      invoiceNumber: voucherReference,
      buyAmount: '2200000',
      sellAmount: '0',
      expenseType: 'FUEL_DIESEL',
      createdBy: params.creatorId,
    })
    .where(eq(s.tripExpenses.id, expense.id));

  const invoice = await createFuelInvoice({
    supplierId: supplier.id,
    invoiceNumber: `HD-Q21-${params.tag}-${suffix}`,
    invoiceDate: params.sourceDate,
    totalLiters: 100,
    unitPrice: 22000,
    note: 'Kiểm tra thẩm quyền kỳ tại lúc áp dụng phê duyệt',
    allocations: [{
      tripId: trip.id,
      truckId: truck.id,
      tripExpenseId: expense.id,
      voucherReference,
      voucherDate: params.sourceDate,
      liters: 100,
    }],
  }, params.creatorId);
  createdFuelInvoiceIds.push(invoice.id);
  return invoice;
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

  test('fuel period does not support direct reopen once the month is locked', async () => {
    const admin = await mkUser('ADMIN', 'fuel-reopen');
    const authority = resolveFuelPeriodAuthority('2026-05-12');
    await trackLock(authority);

    await assert.rejects(
      () => db.transaction((tx) => reopenPeriodLock(tx, authority, admin.id, 'Mở lại kỳ nhiên liệu')),
      (err: Error & { statusCode?: number }) => err.statusCode === 409 && /không hỗ trợ mở lại trực tiếp/i.test(err.message),
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

  test('fuel invoice approval follows the Vietnam month boundary while preserving the locked source month', async (context) => {
    const accountant = await mkUser('ACCOUNTANT', 'fuel-maker');
    const manager = await mkUser('MANAGER', 'fuel-approver');
    const supplier = await mkSupplier();
    const truck = await mkTruck();
    const lockedMay = await trackLock(resolveFuelPeriodAuthority('2026-05-12'));

    const createLateInvoice = async (tag: string) => {
      const trip = await mkTrip((await mkCustomer()).id, '2026-05-12');
      await db.update(s.trips)
        .set({ truckId: truck.id, fuelSupplierId: supplier.id, totalFuelCost: '2200000', updatedAt: new Date() })
        .where(eq(s.trips.id, trip.id));
      const expense = await mkExpense(trip.id, '2026-05-12');
      const voucherReference = `PXD-Q21-${tag}-${suffix}`;
      await db.update(s.tripExpenses)
        .set({
          supplierId: supplier.id,
          expenseDate: '2026-05-12',
          invoiceNumber: voucherReference,
          buyAmount: '2200000',
          sellAmount: '0',
          expenseType: 'FUEL_DIESEL',
          createdBy: accountant.id,
        })
        .where(eq(s.tripExpenses.id, expense.id));

      const invoice = await createFuelInvoice({
        supplierId: supplier.id,
        invoiceNumber: `HD-Q21-${tag}-${suffix}`,
        invoiceDate: '2026-05-20',
        totalLiters: 100,
        unitPrice: 22000,
        note: 'Không được ghi đè tháng đã khóa',
        allocations: [{
          tripId: trip.id,
          truckId: truck.id,
          tripExpenseId: expense.id,
          voucherReference,
          voucherDate: '2026-05-12',
          liters: 100,
        }],
      }, accountant.id);
      createdFuelInvoiceIds.push(invoice.id);
      return invoice;
    };

    const beforeBoundaryInvoice = await createLateInvoice('before-boundary');
    const beforeBoundaryAction = await withMockedNow(
      context,
      '2027-06-30T16:30:00.000Z',
      () => approveFuelInvoice(
        beforeBoundaryInvoice.id,
        manager.id,
        'MANAGER',
        beforeBoundaryInvoice.version,
        'Duyệt trước ranh giới tháng Việt Nam',
      ),
    );
    createdGovernanceActionIds.push(beforeBoundaryAction.id);
    assert.equal(
      (beforeBoundaryAction.afterSnapshot as { targetPeriod?: string }).targetPeriod,
      '2027-06',
    );

    await trackLock(resolveFuelPeriodAuthority('2027-06-15'));

    const afterBoundaryInvoice = await createLateInvoice('after-boundary');
    const action = await withMockedNow(
      context,
      '2027-06-30T17:30:00.000Z',
      () => approveFuelInvoice(
        afterBoundaryInvoice.id,
        manager.id,
        'MANAGER',
        afterBoundaryInvoice.version,
        'Duyệt hóa đơn tháng 5 vào kỳ mở tháng 7',
      ),
    );
    createdGovernanceActionIds.push(action.id);

    const delta = action.deltaSnapshot as {
      lateApprovalLinks?: Array<{ sourcePeriodLockId: number; sourcePeriod: string; targetPeriod: string }>;
    };
    const links = delta.lateApprovalLinks ?? [];
    assert.equal(action.originalPeriodLockId, lockedMay.id);
    assert.equal(action.reason, 'Duyệt hóa đơn tháng 5 vào kỳ mở tháng 7');
    assert.equal(action.makerId, manager.id);
    assert.equal(links.length, 1);
    assert.equal(links[0]?.sourcePeriodLockId, lockedMay.id);
    assert.equal(links[0]?.sourcePeriod, '2026-05');
    assert.equal(links[0]?.targetPeriod, '2027-07');
    assert.equal(
      (action.afterSnapshot as { targetPeriod?: string }).targetPeriod,
      '2027-07',
    );

    const storedInvoices = await db.select({
      invoiceDate: s.fuelInvoices.invoiceDate,
      totalLiters: s.fuelInvoices.totalLiters,
      totalAmount: s.fuelInvoices.totalAmount,
      approvalStatus: s.fuelInvoices.approvalStatus,
    }).from(s.fuelInvoices)
      .where(inArray(s.fuelInvoices.id, [beforeBoundaryInvoice.id, afterBoundaryInvoice.id]))
      .orderBy(s.fuelInvoices.id);
    assert.equal(storedInvoices.length, 2);
    for (const invoice of storedInvoices) {
      assert.equal(invoice.invoiceDate, '2026-05-20');
      assert.equal(Number(invoice.totalLiters), 100);
      assert.equal(Number(invoice.totalAmount), 2_200_000);
      assert.equal(invoice.approvalStatus, 'PENDING');
    }
  });

  test('delayed fuel approval revalidates a source period closed after the maker request', async (context) => {
    const accountant = await mkUser('ACCOUNTANT', 'delayed-maker');
    const manager = await mkUser('MANAGER', 'delayed-requester');
    const admin = await mkUser('ADMIN', 'delayed-approver');
    const invoice = await mkFuelInvoiceForApproval({
      sourceDate: '2031-09-12',
      tag: 'delayed-source-close',
      creatorId: accountant.id,
    });

    const requested = await withMockedNow(
      context,
      '2031-10-15T04:00:00.000Z',
      () => approveFuelInvoice(
        invoice.id,
        manager.id,
        'MANAGER',
        invoice.version,
        'Duyệt trễ sau khi khóa kỳ nguồn',
      ),
    );
    createdGovernanceActionIds.push(requested.id);
    assert.deepEqual(
      (requested.deltaSnapshot as { lateApprovalLinks?: unknown[] }).lateApprovalLinks,
      [],
      'the source period was still open when the maker requested approval',
    );

    const checked = await checkGovernanceAction({
      actionId: requested.id,
      checkerId: accountant.id,
      checkerRole: 'ACCOUNTANT',
      expectedVersion: requested.version,
    });
    const sourceLock = await trackLock(resolveFuelPeriodAuthority('2031-09-12'));

    await withMockedNow(
      context,
      '2031-10-15T04:05:00.000Z',
      () => approveGovernanceAction({
        actionId: checked.id,
        approverId: admin.id,
        approverRole: 'ADMIN',
        expectedVersion: checked.version,
      }),
    );

    const [adjustment] = await db.select().from(s.fuelPeriodAdjustments)
      .where(eq(s.fuelPeriodAdjustments.governanceActionId, requested.id));
    assert.equal(adjustment?.sourcePeriodLockId, sourceLock.id);
    assert.equal(adjustment?.sourcePeriod, '2031-09');
    assert.equal(adjustment?.targetPeriod, '2031-10');
  });

  test('delayed fuel approval re-resolves a stale maker target to the current open Vietnam month', async (context) => {
    const accountant = await mkUser('ACCOUNTANT', 'stale-target-maker');
    const manager = await mkUser('MANAGER', 'stale-target-requester');
    const admin = await mkUser('ADMIN', 'stale-target-approver');
    const sourceLock = await trackLock(resolveFuelPeriodAuthority('2032-05-12'));
    const invoice = await mkFuelInvoiceForApproval({
      sourceDate: '2032-05-12',
      tag: 'stale-target',
      creatorId: accountant.id,
    });

    const requested = await withMockedNow(
      context,
      '2032-07-15T04:00:00.000Z',
      () => approveFuelInvoice(
        invoice.id,
        manager.id,
        'MANAGER',
        invoice.version,
        'Duyệt trễ sang kỳ đang mở mới',
      ),
    );
    createdGovernanceActionIds.push(requested.id);
    assert.equal(
      (requested.afterSnapshot as { targetPeriod?: string }).targetPeriod,
      '2032-07',
    );

    const checked = await checkGovernanceAction({
      actionId: requested.id,
      checkerId: accountant.id,
      checkerRole: 'ACCOUNTANT',
      expectedVersion: requested.version,
    });
    await trackLock(resolveFuelPeriodAuthority('2032-07-15'));

    await withMockedNow(
      context,
      '2032-08-15T04:00:00.000Z',
      () => approveGovernanceAction({
        actionId: checked.id,
        approverId: admin.id,
        approverRole: 'ADMIN',
        expectedVersion: checked.version,
      }),
    );

    const [adjustment] = await db.select().from(s.fuelPeriodAdjustments)
      .where(eq(s.fuelPeriodAdjustments.governanceActionId, requested.id));
    assert.equal(adjustment?.sourcePeriodLockId, sourceLock.id);
    assert.equal(adjustment?.sourcePeriod, '2032-05');
    assert.equal(adjustment?.targetPeriod, '2032-08');
  });

  test('salary close mirrors into the shared period-lock authority', async () => {
    const admin = await mkUser('ADMIN', 'salary');
    await confirmAllDriversForPeriod(2099, 11, admin.id);
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
    if (createdGovernanceActionIds.length > 0) {
      await db.delete(s.governanceActions).where(inArray(s.governanceActions.id, createdGovernanceActionIds));
    }
    if (createdFuelInvoiceIds.length > 0) {
      await db.delete(s.fuelInvoices).where(inArray(s.fuelInvoices.id, createdFuelInvoiceIds));
    }
    if (createdExpenseIds.length > 0) {
      await db.delete(s.tripExpenses).where(inArray(s.tripExpenses.id, createdExpenseIds));
    }
    if (createdTripIds.length > 0) {
      await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
    }
    if (createdTruckIds.length > 0) {
      await db.delete(s.trucks).where(inArray(s.trucks.id, createdTruckIds));
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
    if (createdSalaryConfirmationIds.length > 0) {
      await db.delete(s.salaryConfirmations)
        .where(inArray(s.salaryConfirmations.id, createdSalaryConfirmationIds));
    }
    if (createdCustomerIds.length > 0) {
      await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
    }
    if (createdSupplierIds.length > 0) {
      await db.delete(s.suppliers).where(inArray(s.suppliers.id, createdSupplierIds));
    }
    if (createdUserIds.length > 0) {
      await db.delete(s.users).where(inArray(s.users.id, createdUserIds));
    }
  } catch (err) {
    console.warn('[q21-period-authority.test] cleanup partial:', (err as Error).message);
  }
  await client.end();
});
