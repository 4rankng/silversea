import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { eq } from 'drizzle-orm';
import { Role, type ExpenseAccountingCreate } from '@tingting/shared';
import { db, client } from '../db';
import * as s from '../db/schema';
import type { Tx } from '../services/trip-shared';
import { createAccountingExpense } from '../services/expense-accounting-create.service';

after(async () => { await client.end(); });
interface LotExpenseFixture {
  key: string;
  customer: typeof s.customers.$inferSelect;
  shipment: typeof s.shipments.$inferSelect;
  ops: typeof s.users.$inferSelect;
  actor: { userId: number; role: Role };
}
async function fixture(run: (tx: Tx, ctx: LotExpenseFixture) => Promise<void>) {
  const rollback = Symbol('rollback');
  try { await db.transaction(async tx => { await run(tx, await setup(tx)); throw rollback; }); }
  catch (error) { if (error !== rollback) throw error; }
}
async function setup(tx: Tx): Promise<LotExpenseFixture> {
  const key = crypto.randomUUID();
  const [customer] = await tx.insert(s.customers).values({ name: key }).returning();
  const [shipment] = await tx.insert(s.shipments).values({ shipmentCode: key, customerId: customer.id }).returning();
  const [ops] = await tx.insert(s.users).values({ username: key, passwordHash: 'fixture', role: Role.OPS, status: 'ACTIVE' }).returning();
  const actor = { userId: 1, role: Role.ACCOUNTANT };
  return { key, customer, shipment, ops, actor };
}
const lotExpense = (ctx: LotExpenseFixture, patch: Partial<ExpenseAccountingCreate> = {}): ExpenseAccountingCreate => ({
  tripId: null, shipmentId: ctx.shipment.id, expenseTypeCode: 'OTHER', amount: 500_000, customerChargeAmount: 450_000,
  expenseDate: '2026-10-14', costGroup: 'DRIVER_SHIPMENT', feeName: ctx.key, payerKind: 'COMPANY', ...patch,
});

// Card 20261005 — kế toán khai chi phí ở mức lô, không cần chuyến: lô chưa có
// chuyến vận chuyển vẫn tạo được khoản chi, gắn lô hàng, tripId = null.
test('lot-level expense (tripId null) creates the ops row + accounting source with tripId null', async () => fixture(async (tx, ctx) => {
  const source = await createAccountingExpense(tx, ctx.actor, lotExpense(ctx, { note: 'khoản chi mức lô' }));
  assert.equal(source.tripId, null);
  assert.equal(source.sourceKind, 'OPS');
  assert.equal(source.shipmentId, ctx.shipment.id);
  const [entry] = await tx.select().from(s.opsExpenseEntries).where(eq(s.opsExpenseEntries.id, source.sourceId));
  assert.equal(entry.shipmentId, ctx.shipment.id);
  assert.equal(entry.shipmentContainerId, null);
  assert.equal(entry.expenseTypeCode, 'OTHER');
  assert.equal(entry.feeName, ctx.key);
  assert.equal(String(entry.amount), '500000');
  assert.equal(String(entry.customerChargeAmount), '450000');
  assert.equal(String(entry.paidAt).slice(0, 10), '2026-10-14');
  assert.equal(entry.paidById, null);
  assert.equal(entry.payerKind, 'COMPANY');
  assert.equal(entry.approvalStatus, 'RECORDED');
  assert.equal(entry.note, 'khoản chi mức lô');
  const [link] = await tx.select().from(s.expenseAccountingSources).where(eq(s.expenseAccountingSources.id, source.id));
  assert.equal(link.sourceKind, 'OPS');
  assert.equal(link.sourceId, entry.id);
  assert.equal(link.shipmentId, ctx.shipment.id);
  assert.equal(link.tripId, null);
}));
test('lot-level expense with a USER payer stamps paidById on the ops row', async () => fixture(async (tx, ctx) => {
  const source = await createAccountingExpense(tx, ctx.actor, lotExpense(ctx, { payerKind: 'USER', payerUserId: ctx.ops.id, customerChargeAmount: 0 }));
  const [entry] = await tx.select().from(s.opsExpenseEntries).where(eq(s.opsExpenseEntries.id, source.sourceId));
  assert.equal(entry.paidById, ctx.ops.id);
  assert.equal(entry.payerKind, 'USER');
  assert.equal(source.payerUserId, ctx.ops.id);
}));
test('lot-level expense on an unknown shipment is a 404; Tiền đường never charges the customer', async () => fixture(async (tx, ctx) => {
  await assert.rejects(createAccountingExpense(tx, ctx.actor, lotExpense(ctx, { shipmentId: 2_147_483_000 })),
    (error: Error & { statusCode?: number }) => error.statusCode === 404 && /Không tìm thấy lô hàng/.test(error.message));
  await assert.rejects(createAccountingExpense(tx, ctx.actor, lotExpense(ctx, { costGroup: 'DRIVER_ROAD', customerChargeAmount: 50_000 })),
    /Tiền đường không thu khách/);
}));
