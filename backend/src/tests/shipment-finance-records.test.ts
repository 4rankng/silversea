import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { Role, containerDepositSchema, shipmentInvoiceRecordSchema } from '@tingting/shared';
import { client, db } from '../db';
import * as s from '../db/schema';
import type { AuthUser } from '../middleware/auth';
import type { Tx } from '../services/trip-shared';
import { depositStatus, listShipmentFinanceRecords, saveContainerDepositRecord, saveShipmentInvoiceRecord } from '../services/shipment-finance-records.service';
import { hydrateExpenseAccountingSource } from '../services/expense-accounting-source.service';

after(async () => { await client.end(); });

async function isolated(run: (tx: Tx, actor: AuthUser, shipmentId: number, supplierId: number) => Promise<void>) {
  const rollback = new Error('rollback fixture');
  try {
    await db.transaction(async (tx) => {
      const key = `finance-docs-${crypto.randomUUID()}`;
      const [user] = await tx.insert(s.users).values({ username: key, passwordHash: 'test-only', role: Role.ACCOUNTANT, status: 'ACTIVE' }).returning();
      const [customer] = await tx.insert(s.customers).values({ name: key }).returning();
      const [shipment] = await tx.insert(s.shipments).values({ shipmentCode: key.slice(0, 50), customerId: customer.id, createdBy: user.id }).returning();
      const [supplier] = await tx.insert(s.suppliers).values({ name: key }).returning();
      const actor: AuthUser = { userId: user.id, username: key, fullName: 'Kế toán', email: null, role: Role.ACCOUNTANT };
      await run(tx, actor, shipment.id, supplier.id);
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
}

const deposit = { expectedVersion: 0, billNumber: 'BL-16', shippingLineName: 'MSC', amount: 2_000_000, depositDate: '2026-09-16', recoveredAmount: 0 };
test('KT-17/18: documentary deposit save, partial refund, readback and optimistic conflict without cash', async () => {
  await isolated(async (tx, actor, shipmentId) => {
    const cashBefore = await tx.select({ id: s.treasuryMovements.id }).from(s.treasuryMovements);
    const first = await saveContainerDepositRecord(tx, shipmentId, containerDepositSchema.parse(deposit), actor);
    const updated = await saveContainerDepositRecord(tx, shipmentId, containerDepositSchema.parse({ ...deposit,
      id: first.id, expectedVersion: 1, recoveredAmount: 500_000, refundReceivedDate: '2026-09-20',
    }), actor);
    assert.equal(updated.version, 2);
    await assert.rejects(saveContainerDepositRecord(tx, shipmentId, { ...deposit, id: first.id, expectedVersion: 1 }, actor), /đã thay đổi/);
    const view = await listShipmentFinanceRecords(actor, { shipmentId, page: 1, pageSize: 25, depositState: 'OPEN' }, tx);
    assert.equal(view.deposits[0].outstandingAmount, '1500000');
    assert.equal(view.deposits[0].status, 'PARTIAL');
    assert.equal(view.depositTotal, 1);
    const cashAfter = await tx.select({ id: s.treasuryMovements.id }).from(s.treasuryMovements);
    assert.deepEqual(cashAfter, cashBefore);
    const history = await tx.select().from(s.auditLogs).where(eq(s.auditLogs.entityId, shipmentId));
    assert.equal(history.filter((row) => row.entityType === 'container-deposit').length, 2);
  });
});
test('KT-16/21: invoice fee has one source; CUS sees invoice but cannot write or read deposits', async () => {
  await isolated(async (tx, actor, shipmentId, supplierId) => {
    const input = shipmentInvoiceRecordSchema.parse({ expectedVersion: 0, supplierId, invoiceNumber: 'VAT-16', invoiceDate: '2026-09-16', faceAmount: 1_000_000, supplierFeeAmount: 50_000 });
    const record = await saveShipmentInvoiceRecord(tx, shipmentId, input, actor);
    const [link] = await tx.select().from(s.expenseAccountingSources).where(eq(s.expenseAccountingSources.sourceId, record.id));
    const source = await hydrateExpenseAccountingSource(tx, link);
    assert.equal(source.sourceKind, 'INVOICE');
    assert.equal(source.amount, '50000');
    assert.equal(source.customerChargeAmount, '0');
    await assert.rejects(saveShipmentInvoiceRecord(tx, shipmentId, input, actor), /đã có/);
    const cus = { ...actor, role: Role.CUS };
    await assert.rejects(saveShipmentInvoiceRecord(tx, shipmentId, input, cus), /Chỉ kế toán/);
    const view = await listShipmentFinanceRecords(cus, { shipmentId, page: 1, pageSize: 25 }, tx);
    assert.equal(view.invoices[0].faceAmount, '1000000');
    assert.equal(view.invoices[0].supplierFeeAmount, '50000');
    assert.equal(view.deposits.length, 0);
    assert.equal(view.canWrite, false);
    await assert.rejects(listShipmentFinanceRecords(cus, { page: 1, pageSize: 25 }, tx), /không có quyền/);
  });
});
test('KT-16/20: reconciled invoice fees cannot be overwritten and do not create fictitious trips', async () => {
  await isolated(async (tx, actor, shipmentId, supplierId) => {
    const input = shipmentInvoiceRecordSchema.parse({ expectedVersion: 0, supplierId, invoiceNumber: 'VAT-LOCKED', invoiceDate: '2026-09-16', faceAmount: 1_000_000, supplierFeeAmount: 50_000 });
    const record = await saveShipmentInvoiceRecord(tx, shipmentId, input, actor);
    const [source] = await tx.select().from(s.expenseAccountingSources).where(eq(s.expenseAccountingSources.sourceId, record.id));
    assert.equal(source.tripId, null);
    assert.equal(source.linkedTripExpenseId, null);
    await tx.update(s.expenseAccountingSources).set({ confirmedAt: new Date(), confirmedById: actor.userId }).where(eq(s.expenseAccountingSources.id, source.id));
    await assert.rejects(saveShipmentInvoiceRecord(tx, shipmentId, { ...input, id: record.id, expectedVersion: record.version, supplierFeeAmount: 80_000 }, actor), /không sửa đè/);
    const [unchanged] = await tx.select().from(s.shipmentInvoiceRecords).where(eq(s.shipmentInvoiceRecords.id, record.id));
    assert.equal(unchanged.supplierFeeAmount, '50000');
    assert.equal(unchanged.version, record.version);
    const trips = await tx.select({ id: s.trips.id }).from(s.trips).where(eq(s.trips.shipmentId, shipmentId));
    assert.equal(trips.length, 0);
  });
});
test('KT-17: deposited/refunded states describe facts without an overdue threshold', () => {
  assert.equal(depositStatus('2000000', '0', null), 'WAITING_DOCUMENTS');
  assert.equal(depositStatus('2000000', '0', '2026-09-16'), 'WAITING_REFUND');
  assert.equal(depositStatus('2000000', '500000', null), 'PARTIAL');
  assert.equal(depositStatus('2000000', '2000000', null), 'REFUNDED');
});
test('KT-17/18: documentary refund updates remain available after shipment costs close', async () => {
  await isolated(async (tx, actor, shipmentId) => {
    const first = await saveContainerDepositRecord(tx, shipmentId, deposit, actor);
    await tx.insert(s.shipmentAccountingLocks).values({ shipmentId, billingDocumentId: 0, billingDocumentVersion: 1,
      billingPeriodSnapshot: { rangeFrom: '2026-09-01', rangeTo: '2026-09-30', issuedAt: '2026-09-16T00:00:00Z' },
      shipmentVersionAtLock: 1, reason: 'Local regression fixture', activatedBy: actor.userId });
    const updated = await saveContainerDepositRecord(tx, shipmentId, { ...deposit, id: first.id, expectedVersion: first.version,
      documentsSubmittedDate: '2026-09-17', refundReceivedDate: '2026-09-20', recoveredAmount: 500_000 }, actor);
    assert.equal(updated.recoveredAmount, '500000');
    assert.equal(updated.version, 2);
    await assert.rejects(saveContainerDepositRecord(tx, shipmentId, { ...deposit, id: first.id, expectedVersion: updated.version,
      amount: 3_000_000 }, actor), /khóa|chốt/i);
    const [unchanged] = await tx.select().from(s.containerDepositRecords).where(eq(s.containerDepositRecords.id, first.id));
    assert.equal(unchanged.amount, '2000000');
    assert.equal(unchanged.recoveredAmount, '500000');
  });
});
