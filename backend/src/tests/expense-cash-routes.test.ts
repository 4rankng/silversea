import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import { and, eq, inArray } from 'drizzle-orm';
import { Role, TxnType } from '@tingting/shared';
import { db, client } from '../db';
import * as s from '../db/schema';
import { config } from '../config';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { IDEMPOTENCY_ENDPOINTS, runIdempotent } from '../services/idempotency.service';
import { globalErrorHandler } from '../middleware/errorHandler';
import expenseAccountingRoutes from '../routes/expense-accounting';
import { auditLogMiddleware } from '../middleware/audit';
import { financeRecordsRoutes } from '../routes/shipments/finance-records.routes';
import { setAuditPersistHandlerForTest } from '../services/audit.service';
import financialRoutes from '../routes/financial/payments.routes';
import { expenseVoucherCode } from '../services/expense-cash-command.service';
import { insertTripComposite } from '../services/trip-composite.service';
import { recordCarrierPaymentIdempotent } from '../services/financial.service';
import { getCarrierPayableStatement } from '../services/statement.service';
import { LedgerService } from '../services/ledger.service';
import { disconnectRedis } from '../lib/redis';

const tag = `cash-${Date.now()}`;
const users: Array<typeof s.users.$inferSelect> = [];
const customers: number[] = [], accounts: number[] = [], shipments: number[] = [], opsExpenses: number[] = [];
const suppliers: number[] = [], drivers: number[] = [], trips: number[] = [], routes: number[] = [], cargoTypes: number[] = [];
const keys: string[] = [];
let server: http.Server, base: string, token: string;
before(async () => {
  for (const role of [Role.ACCOUNTANT, Role.OPS]) users.push((await db.insert(s.users).values({ username: `${tag}-${role}`, role, passwordHash: 'test-only', status: 'ACTIVE' }).returning())[0]);
  token = jwt.sign({ userId: users[0].id, username: users[0].username, role: users[0].role, email: null, fullName: null }, config.jwtSecret, { expiresIn: '1h' });
  const app = express(); app.use(express.json()); app.use(auditLogMiddleware); app.use(authMiddleware);
  app.use('/api/expense-accounting', expenseAccountingRoutes); app.use('/api/shipments', financeRecordsRoutes);
  app.use('/api', financialRoutes); app.use(globalErrorHandler);
  server = http.createServer(app); await new Promise<void>(resolve => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
async function fixture() {
  const [customer] = await db.insert(s.customers).values({ name: `${tag}-${crypto.randomUUID()}` }).returning(); customers.push(customer.id);
  const [shipment] = await db.insert(s.shipments).values({ customerId: customer.id, shipmentCode: `${tag}-${customer.id}` }).returning(); shipments.push(shipment.id);
  const [expense] = await db.insert(s.opsExpenseEntries).values({ shipmentId: shipment.id, expenseTypeCode: 'QA', amount: '500000', customerChargeAmount: '300000',
    paidAt: '2026-09-16', paidById: users[1].id, payerKind: 'USER', feeName: 'QA chi hộ', costGroup: 'OPS_REGULAR' }).returning(); opsExpenses.push(expense.id);
  await db.insert(s.expenseAccountingSources).values({ sourceKind: 'OPS', sourceId: expense.id, shipmentId: shipment.id,
    recordedById: users[1].id, confirmedById: users[0].id, confirmedAt: new Date() });
  const [account] = await db.insert(s.treasuryAccounts).values({ code: `${tag}-${customer.id}`, name: tag, type: 'BANK', fundCode: 'COMPANY', status: 'ACTIVE', createdBy: users[0].id, updatedBy: users[0].id }).returning(); accounts.push(account.id);
  const input = { direction: 'IN' as const, treasuryAccountId: account.id, valueDate: '2026-09-16', physicalReference: `${tag}-${crypto.randomUUID()}`,
    entries: [{ sourceKind: 'OPS' as const, sourceId: expense.id, expectedVersion: 1, amount: 100000 }] };
  const legacy = { customerId: customer.id, receiptId: expenseVoucherCode(input), amount: 100000, unappliedOnly: true,
    treasuryAccountId: account.id, valueDate: input.valueDate, physicalReference: input.physicalReference };
  return { customer, account, input, legacy };
}
async function post(path: string, body: unknown, key = `${tag}-${crypto.randomUUID()}`) {
  keys.push(key);
  const response = await fetch(`${base}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
async function assertVoucherAudit(physicalReference: string, endpoint: string) {
  const rows = await db.select({ payload: s.auditLogs.payload }).from(s.auditLogs).where(eq(s.auditLogs.userId, users[0].id));
  const matches = rows.map(row => row.payload as Record<string, unknown>).filter(payload =>
    payload.path === '/api/expense-accounting/vouchers' && ['SUCCEEDED', 'REPLAYED'].includes(String(payload.outcome))
      && (payload.body as Record<string, unknown> | undefined)?.physicalReference === physicalReference);
  assert.ok(matches.length > 0, `Missing real middleware audit for ${physicalReference}`);
  for (const payload of matches) assert.equal(payload.materialWriteEndpoint, endpoint);
}

async function assertDurableAuditBeforeCommit(send: () => Promise<{ status: number }>, endpoint: string) {
  let capturedEndpoint: string | null | undefined;
  setAuditPersistHandlerForTest(async (payload, tx) => {
    if (tx && payload.metadata?.outcome === 'SUCCEEDED') capturedEndpoint = payload.metadata.materialWriteEndpoint as string | undefined;
    throw new Error('Injected audit failure before commit');
  });
  try { assert.equal((await send()).status, 500); }
  finally { setAuditPersistHandlerForTest(null); }
  assert.equal(capturedEndpoint, endpoint, 'the durable audit must identify the actual command before commit/finalization');
}

test('expense cash rejects an existing account until its fund is explicitly classified', async () => {
  const f = await fixture();
  await db.update(s.treasuryAccounts).set({ fundCode: null }).where(eq(s.treasuryAccounts.id, f.account.id));
  const rejected = await post('/expense-accounting/vouchers', f.input);
  assert.equal(rejected.status, 409, JSON.stringify(rejected));
  assert.match(JSON.stringify(rejected.body), /phân nguồn quỹ/);
  assert.equal((await db.select().from(s.paymentReceipts).where(eq(s.paymentReceipts.customerId, f.customer.id))).length, 0);
  assert.equal((await db.select().from(s.treasuryMovements).where(eq(s.treasuryMovements.treasuryAccountId, f.account.id))).length, 0);
});

test('legacy cash on an unclassified account attaches once after explicit fund setup using the same command key', async () => {
  const f = await fixture();
  await db.update(s.treasuryAccounts).set({ fundCode: null }).where(eq(s.treasuryAccounts.id, f.account.id));
  const key = `${tag}-legacy-unclassified`;
  const old = await post('/payments/receive', f.legacy, key);
  assert.ok(old.status < 300, JSON.stringify(old));
  const [originalReceipt] = await db.select().from(s.paymentReceipts).where(eq(s.paymentReceipts.receiptId, f.legacy.receiptId));
  const [originalLedger] = await db.select().from(s.ledger).where(and(eq(s.ledger.receiptId, f.legacy.receiptId), eq(s.ledger.entityType, 'CUSTOMER'), eq(s.ledger.entityId, f.customer.id)));
  const [originalMovement] = await db.select().from(s.treasuryMovements).where(eq(s.treasuryMovements.paymentReceiptId, originalReceipt.id));
  assert.equal(originalReceipt.receivedAmount, '100000');
  assert.equal(originalMovement.amount, '100000');

  const blocked = await post('/expense-accounting/vouchers', f.input, key);
  assert.equal(blocked.status, 409, JSON.stringify(blocked));
  assert.match(JSON.stringify(blocked.body), /phân nguồn quỹ/);
  assert.equal((await db.select().from(s.expenseCashVouchers).where(eq(s.expenseCashVouchers.treasuryMovementId, originalMovement.id))).length, 0);
  const oldReplay = await post('/payments/receive', f.legacy, key);
  assert.ok(oldReplay.status < 300, JSON.stringify(oldReplay));
  assert.equal(oldReplay.body.replayed, true);

  const [admin] = await db.insert(s.users).values({ username: `${tag}-fund-admin`, role: Role.ADMIN, passwordHash: 'test-only', status: 'ACTIVE' }).returning();
  users.push(admin);
  const adminToken = jwt.sign({ userId: admin.id, username: admin.username, role: admin.role }, config.jwtSecret, { expiresIn: '1h' });
  const setupKey = `${tag}-classify-legacy`; keys.push(setupKey);
  const setup = await fetch(`${base}/finance/treasury/accounts/${f.account.id}/fund`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json', 'Idempotency-Key': setupKey },
    body: JSON.stringify({ expectedVersion: f.account.version, fundCode: 'COMPANY', reason: 'Explicitly confirm the legacy account fund' }),
  });
  assert.equal(setup.status, 200, await setup.text());
  const attached = await post('/expense-accounting/vouchers', f.input, key);
  assert.ok(attached.status < 300, JSON.stringify(attached)); assert.equal(attached.body.replayed, true);
  const repeated = await post('/expense-accounting/vouchers', f.input, key);
  assert.ok(repeated.status < 300, JSON.stringify(repeated)); assert.equal(repeated.body.replayed, true);
  assert.equal(repeated.body.id, attached.body.id);

  const receipts = await db.select().from(s.paymentReceipts).where(eq(s.paymentReceipts.receiptId, f.legacy.receiptId));
  assert.equal(receipts.length, 1); assert.equal(receipts[0].id, originalReceipt.id);
  assert.equal(receipts[0].receivedAmount, '100000'); assert.equal(receipts[0].unappliedAmount, '100000');
  const ledgers = await db.select().from(s.ledger).where(and(eq(s.ledger.receiptId, f.legacy.receiptId), eq(s.ledger.entityType, 'CUSTOMER'), eq(s.ledger.entityId, f.customer.id)));
  assert.equal(ledgers.length, 1); assert.equal(ledgers[0].id, originalLedger.id);
  const movements = await db.select().from(s.treasuryMovements).where(eq(s.treasuryMovements.treasuryAccountId, f.account.id));
  assert.equal(movements.length, 1); assert.equal(movements[0].id, originalMovement.id);
  const vouchers = await db.select().from(s.expenseCashVouchers).where(eq(s.expenseCashVouchers.treasuryMovementId, originalMovement.id));
  assert.equal(vouchers.length, 1); assert.equal(vouchers[0].paymentReceiptId, originalReceipt.id);
  const allocations = await db.select().from(s.expenseCashAllocations).where(eq(s.expenseCashAllocations.voucherId, vouchers[0].id));
  assert.equal(allocations.length, 1); assert.equal(allocations[0].amount, '100000');
  const [source] = await db.select().from(s.expenseAccountingSources).where(and(eq(s.expenseAccountingSources.sourceKind, 'OPS'), eq(s.expenseAccountingSources.sourceId, f.input.entries[0].sourceId)));
  assert.equal(allocations[0].expenseAccountingSourceId, source.id);
  assert.equal(source.version, 2, 'the repeated replay does not consume the source version again');
  // This pre-trip expense still holds unapplied cash, never a fabricated trip allocation.
  assert.equal(allocations[0].paymentAllocationId, null);
  assert.equal((await db.select().from(s.paymentAllocations).where(eq(s.paymentAllocations.paymentReceiptId, originalReceipt.id))).length, 0);
});

test('OPS can read its own expense without inheriting the cash router finance restriction', async () => {
  const f = await fixture();
  const opsToken = jwt.sign({ userId: users[1].id, username: users[1].username, role: Role.OPS }, config.jwtSecret, { expiresIn: '1h' });
  const headers = { Authorization: `Bearer ${opsToken}` };
  const own = await fetch(`${base}/expense-accounting/entries/OPS/${f.input.entries[0].sourceId}`, { headers });
  assert.equal(own.status, 200, await own.text());
  const cash = await fetch(`${base}/expense-accounting/vouchers`, { headers });
  assert.equal(cash.status, 403);
});

test('deposit save uses the production audit middleware and rolls back when audit fails', async () => {
  await fixture(); const shipmentId = shipments.at(-1)!;
  const input = { expectedVersion: 0, billNumber: tag, shippingLineName: 'QA line', amount: 2000000,
    depositDate: '2026-09-16', recoveredAmount: 500000, refundReceivedDate: '2026-09-16' };
  setAuditPersistHandlerForTest(async () => { throw new Error('Injected expense audit failure'); });
  try {
    const rejected = await post(`/shipments/${shipmentId}/container-deposits`, input);
    assert.equal(rejected.status, 500);
    assert.equal((await db.select().from(s.containerDepositRecords).where(eq(s.containerDepositRecords.shipmentId, shipmentId))).length, 0);
  } finally { setAuditPersistHandlerForTest(null); }
  const key = `${tag}-deposit`; const saved = await post(`/shipments/${shipmentId}/container-deposits`, input, key);
  assert.equal(saved.status, 201, JSON.stringify(saved));
  const replay = await post(`/shipments/${shipmentId}/container-deposits`, input, key);
  assert.equal(replay.status, 201); assert.equal(replay.body.id, saved.body.id);
  assert.equal((await db.select().from(s.containerDepositRecords).where(eq(s.containerDepositRecords.shipmentId, shipmentId))).length, 1);
});
for (const order of ['new-first', 'legacy-first', 'concurrent']) test(`customer cash command replays across old and new routes: ${order}`, async () => {
  const f = await fixture(); const key = `${tag}-${order}`;
  const sendNew = () => post('/expense-accounting/vouchers', f.input, key);
  const sendOld = () => post('/payments/receive', f.legacy, key);
  if (order === 'new-first') await assertDurableAuditBeforeCommit(sendNew, IDEMPOTENCY_ENDPOINTS.PAYMENTS_RECEIVE);
  const results = order === 'concurrent' ? await Promise.all([sendNew(), sendOld()])
    : order === 'new-first' ? [await sendNew(), await sendOld()] : [await sendOld(), await sendNew()];
  for (const result of results) assert.ok(result.status < 300, JSON.stringify(result));
  const replay = await sendNew(); assert.equal(replay.body.replayed, true, JSON.stringify(replay));
  await assertVoucherAudit(f.input.physicalReference, IDEMPOTENCY_ENDPOINTS.PAYMENTS_RECEIVE);
  const receipts = await db.select().from(s.paymentReceipts).where(eq(s.paymentReceipts.receiptId, f.legacy.receiptId));
  assert.equal(receipts.length, 1); assert.equal(receipts[0].receivedAmount, '100000');
  const movements = await db.select().from(s.treasuryMovements).where(eq(s.treasuryMovements.paymentReceiptId, receipts[0].id));
  assert.equal(movements.length, 1); assert.equal(movements[0].amount, '100000');
  const changed = await post('/expense-accounting/vouchers', { ...f.input, entries: [{ ...f.input.entries[0], amount: 110000 }] }, key);
  assert.equal(changed.status, 409);
  const reverse = await post(`/expense-accounting/vouchers/${replay.body.id}/reverse`, { expectedVersion: replay.body.version,
    reason: 'QA full reversal', valueDate: '2026-09-16', physicalReference: `${tag}-reverse-${f.customer.id}` });
  assert.equal(reverse.status, 200, JSON.stringify(reverse));
  const [receipt] = await db.select().from(s.paymentReceipts).where(eq(s.paymentReceipts.id, receipts[0].id));
  assert.equal(receipt.refundedAmount, '100000'); assert.equal(receipt.unappliedAmount, '0');
});

for (const order of ['new-first', 'legacy-first', 'concurrent']) test(`vendor cash command replays across old and new routes: ${order}`, async () => {
  const f = await fixture();
  const [supplier] = await db.insert(s.suppliers).values({ name: `${tag}-${crypto.randomUUID()}` }).returning(); suppliers.push(supplier.id);
  const [invoice] = await db.insert(s.shipmentInvoiceRecords).values({ shipmentId: shipments.at(-1)!, supplierId: supplier.id,
    invoiceNumber: crypto.randomUUID(), invoiceDate: '2026-09-16', faceAmount: '1000000', supplierFeeAmount: '500000', createdBy: users[0].id, updatedBy: users[0].id }).returning();
  await db.insert(s.expenseAccountingSources).values({ sourceKind: 'INVOICE', sourceId: invoice.id, shipmentId: invoice.shipmentId, recordedById: users[0].id, confirmedById: users[0].id, confirmedAt: new Date() });
  await db.transaction(tx => LedgerService.postEntry(tx, { txnType: TxnType.VENDOR_EXPENSE, entityType: 'VENDOR', entityId: supplier.id, credit: 500000, debit: 0 }));
  const input = { ...f.input, direction: 'OUT', entries: [{ sourceKind: 'INVOICE', sourceId: invoice.id, expectedVersion: 1, amount: 100000 }] };
  const legacy = { supplierId: supplier.id, receiptId: expenseVoucherCode(input as Parameters<typeof expenseVoucherCode>[0]), amount: '100000', date: input.valueDate,
    treasuryAccountId: input.treasuryAccountId, valueDate: input.valueDate, physicalReference: input.physicalReference };
  const key = `${tag}-vendor-${order}`;
  const sendNew = () => post('/expense-accounting/vouchers', input, key);
  const sendOld = () => post('/payments/vendor', legacy, key);
  if (order === 'new-first') await assertDurableAuditBeforeCommit(sendNew, IDEMPOTENCY_ENDPOINTS.PAYMENTS_VENDOR);
  const results = order === 'concurrent' ? await Promise.all([sendNew(), sendOld()]) : order === 'new-first' ? [await sendNew(), await sendOld()] : [await sendOld(), await sendNew()];
  for (const result of results) assert.ok(result.status < 300, JSON.stringify(result));
  await assertVoucherAudit(input.physicalReference, IDEMPOTENCY_ENDPOINTS.PAYMENTS_VENDOR);
  const paid = await db.select().from(s.ledger).where(and(eq(s.ledger.entityType, 'VENDOR'), eq(s.ledger.entityId, supplier.id), eq(s.ledger.txnType, TxnType.VENDOR_PAYMENT)));
  assert.equal(paid.length, 1); assert.equal(paid[0].debit, '100000');
  assert.equal((await db.select().from(s.treasuryMovements).where(eq(s.treasuryMovements.ledgerEntryId, paid[0].id))).length, 1);
});

for (const order of ['new-first', 'legacy-first', 'concurrent']) test(`driver partial payout replays across expense and driver HTTP routes: ${order}`, async () => {
  const f = await fixture(); const shipmentId = shipments.at(-1)!;
  const [route] = await db.insert(s.routes).values({ name: `${tag}-${crypto.randomUUID()}` }).returning(); routes.push(route.id);
  const [cargo] = await db.insert(s.cargoTypes).values({ name: `${tag}-${crypto.randomUUID()}` }).returning(); cargoTypes.push(cargo.id);
  const [driver] = await db.insert(s.drivers).values({ name: `${tag}-${crypto.randomUUID()}` }).returning(); drivers.push(driver.id);
  const trip = await db.transaction(tx => insertTripComposite(tx, { tripCode: `${tag}-D-${driver.id}`, customerId: f.customer.id,
    shipmentId, routeId: route.id, cargoTypeId: cargo.id, driverId: driver.id, departureDate: '2026-09-16', status: 'COMPLETED', carrierType: 'OWN' })); trips.push(trip.id);
  const [expense] = await db.insert(s.driverIncidentalCosts).values({ tripId: trip.id, driverId: driver.id, costType: 'PARKING', amount: '500000',
    occurredAt: '2026-09-16', payerKind: 'USER', costGroup: 'DRIVER_ROAD', customerChargeAmount: '0' }).returning();
  await db.insert(s.expenseAccountingSources).values({ sourceKind: 'DRIVER', sourceId: expense.id, shipmentId, tripId: trip.id,
    recordedById: users[0].id, confirmedById: users[0].id, confirmedAt: new Date() });
  await db.transaction(tx => LedgerService.postEntry(tx, { txnType: TxnType.VENDOR_EXPENSE, entityType: 'DRIVER', entityId: driver.id, debit: 0, credit: 500000 }));
  const input = { ...f.input, direction: 'OUT' as const, entries: [{ sourceKind: 'DRIVER' as const, sourceId: expense.id, expectedVersion: 1, amount: 100000 }] };
  const legacy = { receiptId: expenseVoucherCode(input), amount: 100000, payoutDate: input.valueDate, method: 'BANK',
    treasuryAccountId: input.treasuryAccountId, valueDate: input.valueDate, physicalReference: input.physicalReference };
  const key = `${tag}-driver-${order}`;
  const sendNew = () => post('/expense-accounting/vouchers', input, key);
  const sendOld = () => post(`/drivers/${driver.id}/payouts`, legacy, key);
  if (order === 'new-first') await assertDurableAuditBeforeCommit(sendNew, IDEMPOTENCY_ENDPOINTS.DRIVER_PAYOUT);
  const results = order === 'concurrent' ? await Promise.all([sendNew(), sendOld()]) : order === 'new-first' ? [await sendNew(), await sendOld()] : [await sendOld(), await sendNew()];
  for (const result of results) assert.ok(result.status < 300, JSON.stringify(result));
  const replay = await sendNew(); assert.equal(replay.body.replayed, true, JSON.stringify(replay));
  await assertVoucherAudit(input.physicalReference, IDEMPOTENCY_ENDPOINTS.DRIVER_PAYOUT);
  const paid = await db.select().from(s.ledger).where(and(eq(s.ledger.entityType, 'DRIVER'), eq(s.ledger.entityId, driver.id), eq(s.ledger.txnType, TxnType.DRIVER_PAYOUT)));
  assert.equal(paid.length, 1); assert.equal(paid[0].debit, '100000');
  assert.equal((await db.select().from(s.treasuryMovements).where(eq(s.treasuryMovements.ledgerEntryId, paid[0].id))).length, 1);
  assert.equal((await post(`/drivers/${driver.id}/payouts`, { ...legacy, amount: 110000 }, key)).status, 409);
  const next = await post('/expense-accounting/vouchers', { ...input, physicalReference: `${tag}-driver-next-${driver.id}`,
    entries: [{ ...input.entries[0], expectedVersion: 2, amount: 250000 }] });
  assert.equal(next.status, 201, JSON.stringify(next));
  assert.equal(await db.transaction(tx => LedgerService.getBalanceTx(tx, 'DRIVER', driver.id)), 150000);
  const over = await post('/expense-accounting/vouchers', { ...input, physicalReference: `${tag}-driver-over-${driver.id}`,
    entries: [{ ...input.entries[0], expectedVersion: 3, amount: 200000 }] });
  assert.ok([409, 422].includes(over.status), JSON.stringify(over));
  assert.equal((await db.select().from(s.treasuryMovements).where(eq(s.treasuryMovements.treasuryAccountId, f.account.id))).length, 2);
});

// Carrier freight is a canonical carrier payable (customers.isCarrier), not a native
// expense source. Test the real HTTP adapter against the canonical idempotent service;
// do not fabricate a supplier expense or a second expense-voucher carrier authority.
for (const order of ['service-first', 'http-first', 'concurrent']) test(`external carrier partial payment replays across canonical service and HTTP: ${order}`, async () => {
  const f = await fixture();
  const [carrier] = await db.insert(s.customers).values({ name: `${tag}-carrier-${crypto.randomUUID()}`, isCarrier: true }).returning(); customers.push(carrier.id);
  await db.transaction(tx => LedgerService.postEntry(tx, { txnType: TxnType.EXTERNAL_CARRIER_COST, entityType: 'CARRIER', entityId: carrier.id, debit: 0, credit: 500000 }));
  const input = { supplierId: carrier.id, receiptId: `${tag}-carrier-${carrier.id}`, amount: '100000', date: '2026-09-16',
    treasuryAccountId: f.account.id, valueDate: '2026-09-16', physicalReference: `${tag}-carrier-bank-${carrier.id}` };
  const key = `${tag}-carrier-${order}`; keys.push(key);
  const sendService = () => recordCarrierPaymentIdempotent({ input, idempotencyKey: key, createdBy: users[0].id });
  const sendHttp = async () => { const result = await post('/payments/carrier', input, key); assert.ok(result.status < 300, JSON.stringify(result)); return result; };
  if (order === 'concurrent') await Promise.all([sendService(), sendHttp()]);
  else if (order === 'service-first') { await sendService(); await sendHttp(); }
  else { await sendHttp(); await sendService(); }
  const replay = await sendHttp(); assert.equal(replay.body.replayed, true);
  const payments = await db.select().from(s.ledger).where(and(eq(s.ledger.entityType, 'CARRIER'), eq(s.ledger.entityId, carrier.id), eq(s.ledger.txnType, TxnType.VENDOR_PAYMENT)));
  assert.equal(payments.length, 1); assert.equal(payments[0].debit, '100000');
  assert.equal((await db.select().from(s.treasuryMovements).where(eq(s.treasuryMovements.ledgerEntryId, payments[0].id))).length, 1);
  assert.equal((await getCarrierPayableStatement(carrier.id)).totalOutstanding, 400000);
  assert.equal((await post('/payments/carrier', { ...input, amount: '110000' }, key)).status, 409);
  const next = await post('/payments/carrier', { ...input, receiptId: `${tag}-carrier-next-${carrier.id}`, physicalReference: `${tag}-carrier-bank-next-${carrier.id}`, amount: '250000' });
  assert.ok(next.status < 300, JSON.stringify(next));
  assert.equal((await getCarrierPayableStatement(carrier.id)).totalOutstanding, 150000);
  const over = await post('/payments/carrier', { ...input, receiptId: `${tag}-carrier-over-${carrier.id}`, physicalReference: `${tag}-carrier-bank-over-${carrier.id}`, amount: '200000' });
  assert.equal(over.status, 422, JSON.stringify(over));
  assert.equal((await db.select().from(s.treasuryMovements).where(eq(s.treasuryMovements.treasuryAccountId, f.account.id))).length, 2);
  assert.equal((await db.select().from(s.ledger).where(and(eq(s.ledger.entityType, 'CUSTOMER'), eq(s.ledger.entityId, carrier.id)))).length, 0, 'carrier AP must stay out of customer AR');
});

test('OPS reimbursement audit identifies the actual command from the shared voucher route', async () => {
  const f = await fixture();
  await db.transaction(tx => LedgerService.postEntry(tx, { txnType: TxnType.VENDOR_EXPENSE, entityType: 'FORWARDER', entityId: users[1].id, debit: 500000, credit: 0 }));
  const reconciliation = await post('/expense-accounting/reconciliations', { opsUserId: users[1].id, from: '2026-09-01', to: '2026-09-30',
    entries: [{ sourceKind: 'OPS', sourceId: f.input.entries[0].sourceId, expectedVersion: 1 }], advances: [] });
  assert.equal(reconciliation.status, 201, JSON.stringify(reconciliation));
  const key = `${tag}-ops-audit`; const input = { ...f.input, direction: 'OUT', entries: [{ ...f.input.entries[0], expectedVersion: 2 }] };
  await assertDurableAuditBeforeCommit(() => post('/expense-accounting/vouchers', input, key), 'expenses.ops-reimburse');
  const saved = await post('/expense-accounting/vouchers', input, key); assert.equal(saved.status, 201, JSON.stringify(saved));
  const replay = await post('/expense-accounting/vouchers', input, key); assert.equal(replay.body.replayed, true, JSON.stringify(replay));
  await assertVoucherAudit(input.physicalReference, 'expenses.ops-reimburse');
});

for (const scenario of ['forbidden-alias', 'missing-registry']) test(`material audit ${scenario} remains fail-closed`, async () => {
  const f = await fixture(); const key = `${tag}-${scenario}`; keys.push(key);
  const path = scenario === 'forbidden-alias' ? '/api/expense-accounting/vouchers' : '/api/qa/undeclared-cash';
  const app = express(); app.use(express.json()); app.use(auditLogMiddleware); app.use(authMiddleware);
  app.post(path, asyncHandler(async (_req, res) => {
    const result = await runIdempotent({ endpoint: 'qa.forbidden-money-alias', idempotencyKey: key, payload: { customerId: f.customer.id },
      createdBy: users[0].id, create: async tx => (await tx.update(s.customers).set({ name: `${f.customer.name}-SHOULD_ROLLBACK` }).where(eq(s.customers.id, f.customer.id)).returning())[0] });
    res.json(result.result);
  })); app.use(globalErrorHandler);
  const isolated = http.createServer(app); await new Promise<void>(resolve => isolated.listen(0, resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${(isolated.address() as AddressInfo).port}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: '{}' });
    assert.equal(response.status, 500, await response.text());
    const [customer] = await db.select().from(s.customers).where(eq(s.customers.id, f.customer.id)); assert.equal(customer.name, f.customer.name);
    assert.equal((await db.select().from(s.idempotencyKeys).where(eq(s.idempotencyKeys.idempotencyKey, key))).length, 0);
  } finally { await new Promise<void>(resolve => isolated.close(() => resolve())); }
});

test('one invalid source rolls back the entire receipt, allocations and bank movement', async () => {
  const f = await fixture(); const other = await fixture();
  const result = await post('/expense-accounting/vouchers', { ...f.input, entries: [f.input.entries[0], other.input.entries[0]] });
  assert.equal(result.status, 400, JSON.stringify(result));
  assert.equal((await db.select().from(s.paymentReceipts).where(eq(s.paymentReceipts.receiptId, f.legacy.receiptId))).length, 0);
  assert.equal((await db.select().from(s.treasuryMovements).where(eq(s.treasuryMovements.treasuryAccountId, f.account.id))).length, 0);
});

after(async () => {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  if (accounts.length) {
    const vouchers = await db.select({ id: s.expenseCashVouchers.id }).from(s.expenseCashVouchers).innerJoin(s.treasuryMovements, eq(s.treasuryMovements.id, s.expenseCashVouchers.treasuryMovementId)).where(inArray(s.treasuryMovements.treasuryAccountId, accounts));
    if (vouchers.length) await db.delete(s.expenseCashAllocations).where(inArray(s.expenseCashAllocations.voucherId, vouchers.map(v => v.id)));
    if (vouchers.length) await db.delete(s.expenseCashVouchers).where(inArray(s.expenseCashVouchers.id, vouchers.map(v => v.id)));
    await db.delete(s.treasuryMovements).where(inArray(s.treasuryMovements.treasuryAccountId, accounts));
    await db.delete(s.treasuryAccounts).where(inArray(s.treasuryAccounts.id, accounts));
  }
  if (customers.length) {
    const receipts = await db.select().from(s.paymentReceipts).where(inArray(s.paymentReceipts.customerId, customers));
    if (receipts.length) await db.delete(s.paymentRefunds).where(inArray(s.paymentRefunds.paymentReceiptId, receipts.map(r => r.id)));
    await db.delete(s.paymentAllocations).where(inArray(s.paymentAllocations.customerId, customers));
    await db.delete(s.paymentReceipts).where(inArray(s.paymentReceipts.customerId, customers));
    await db.delete(s.ledger).where(and(inArray(s.ledger.entityType, ['CUSTOMER', 'CARRIER']), inArray(s.ledger.entityId, customers)));
  }
  if (suppliers.length) {
    await db.delete(s.ledger).where(and(eq(s.ledger.entityType, 'VENDOR'), inArray(s.ledger.entityId, suppliers)));
    await db.delete(s.shipmentInvoiceRecords).where(inArray(s.shipmentInvoiceRecords.supplierId, suppliers));
    await db.delete(s.suppliers).where(inArray(s.suppliers.id, suppliers));
  }
  if (drivers.length) {
    await db.delete(s.ledger).where(and(eq(s.ledger.entityType, 'DRIVER'), inArray(s.ledger.entityId, drivers)));
    await db.delete(s.driverIncidentalCosts).where(inArray(s.driverIncidentalCosts.driverId, drivers));
    await db.delete(s.drivers).where(inArray(s.drivers.id, drivers));
  }
  if (trips.length) {
    await db.delete(s.tripFinancialState).where(inArray(s.tripFinancialState.tripId, trips));
    await db.delete(s.tripCarrierInfo).where(inArray(s.tripCarrierInfo.tripId, trips));
    await db.delete(s.trips).where(inArray(s.trips.id, trips));
  }
  if (routes.length) await db.delete(s.routes).where(inArray(s.routes.id, routes));
  if (cargoTypes.length) await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, cargoTypes));
  if (shipments.length) {
    await db.delete(s.containerDepositRecords).where(inArray(s.containerDepositRecords.shipmentId, shipments));
    await db.delete(s.expenseAccountingSources).where(inArray(s.expenseAccountingSources.shipmentId, shipments));
    await db.delete(s.opsExpenseEntries).where(inArray(s.opsExpenseEntries.shipmentId, shipments));
    await db.delete(s.shipments).where(inArray(s.shipments.id, shipments));
    await db.delete(s.customers).where(inArray(s.customers.id, customers));
  }
  if (keys.length) await db.delete(s.idempotencyKeys).where(inArray(s.idempotencyKeys.idempotencyKey, keys));
  if (users.length) {
    await db.delete(s.ledger).where(and(eq(s.ledger.entityType, 'FORWARDER'), inArray(s.ledger.entityId, users.map(u => u.id))));
    await db.delete(s.expenseReconciliations).where(inArray(s.expenseReconciliations.opsUserId, users.map(u => u.id)));
    await db.delete(s.auditLogs).where(inArray(s.auditLogs.userId, users.map(u => u.id))); await db.delete(s.users).where(inArray(s.users.id, users.map(u => u.id))); }
  await disconnectRedis(); await client.end();
});
