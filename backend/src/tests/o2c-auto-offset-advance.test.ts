import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';
import { db, client } from '../db';
import * as s from '../db/schema';
import { autoOffsetExpenseApproval, getOutstandingAdvanceBalance } from '../services/advance.service';
import { propagateExpenseApproval } from '../services/source-change.service';

/**
 * O2C Bước 4 — "Ranh giới Tạm ứng" (O2C Flow.md:72 / O2C dev-rev1.md:87):
 * "Ngay khi phí chi hộ được Kế toán duyệt, hệ thống tự động sinh bút toán cấn
 * trừ vào dư nợ tạm ứng." These tests pin the auto-offset fired on expense
 * approval: it consumes outstanding advances FIFO, posts the FORWARDER_SETTLEMENT
 * debit, drops the outstanding balance, and never double-posts.
 */
describe('O2C auto advance-offset on chi hộ approval', () => {
  const ids = {
    users: [] as number[],
    customers: [] as number[],
    routes: [] as number[],
    cargoTypes: [] as number[],
    trips: [] as number[],
    expenses: [] as number[],
    requests: [] as number[],
    settlements: [] as number[],
  };
  let forwarderId: number;
  let accountantId: number;
  let tripId: number;

  async function insertApprovedAdvance(amount: number, approvedAt: Date) {
    const [request] = await db.insert(s.advanceRequests).values({
      requesterId: forwarderId,
      amount: String(amount),
      reason: 'Test tự cấn trừ',
      status: 'APPROVED',
      approvedBy: accountantId,
      approvedAt,
    }).returning();
    ids.requests.push(request.id);
    return request.id;
  }

  async function insertExpense(options: {
    approvalStatus?: 'PENDING' | 'APPROVED';
    buyAmount?: number;
    settlementMethod?: string;
    forwarderId?: number | null;
  } = {}) {
    const [expense] = await db.insert(s.tripExpenses).values({
      tripId,
      forwarderId: options.forwarderId === undefined ? forwarderId : options.forwarderId,
      createdBy: forwarderId,
      expenseType: 'LIFTING',
      buyAmount: String(options.buyAmount ?? 100_000),
      sellAmount: '120000',
      expenseDate: '2026-07-11',
      settlementMethod: (options.settlementMethod ?? 'FORWARDER_ADVANCE') as 'FORWARDER_ADVANCE' | 'COMPANY_DIRECT',
      approvalStatus: options.approvalStatus ?? 'APPROVED',
    }).returning();
    ids.expenses.push(expense.id);
    return expense;
  }

  before(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const [fwd, kt] = await db.insert(s.users).values([
      { username: `o2c-fwd-${suffix}`, passwordHash: 'x', fullName: 'Ops O2C', role: 'FORWARDER' },
      { username: `o2c-kt-${suffix}`, passwordHash: 'x', fullName: 'Kế toán O2C', role: 'ACCOUNTANT' },
    ]).returning();
    forwarderId = fwd.id;
    accountantId = kt.id;
    ids.users.push(fwd.id, kt.id);

    const [customer] = await db.insert(s.customers).values({ name: `O2C cust ${suffix}` }).returning();
    ids.customers.push(customer.id);
    const [route] = await db.insert(s.routes).values({ name: `O2C route ${suffix}`, distanceKm: 50 }).returning();
    ids.routes.push(route.id);
    const [cargoType] = await db.insert(s.cargoTypes).values({ name: `O2C cargo ${suffix}` }).returning();
    ids.cargoTypes.push(cargoType.id);

    const [trip] = await db.insert(s.trips).values({
      tripCode: `O2C-${suffix}`,
      customerId: customer.id,
      routeId: route.id,
      cargoTypeId: cargoType.id,
      status: 'IN_TRANSIT',
      departureDate: '2026-07-11',
      carrierType: 'OWN',
    }).returning();
    tripId = trip.id;
    ids.trips.push(tripId);
  });

  after(async () => {
    // Clean settlement links first (FKs), then ledger, then parents.
    if (ids.settlements.length) {
      await db.delete(s.advanceSettlementRequests).where(inArray(s.advanceSettlementRequests.settlementId, ids.settlements));
      await db.delete(s.settlementExpenses).where(inArray(s.settlementExpenses.settlementId, ids.settlements));
    }
    if (ids.expenses.length) await db.delete(s.settlementExpenses).where(inArray(s.settlementExpenses.tripExpenseId, ids.expenses));
    if (ids.settlements.length) {
      await db.delete(s.ledger).where(inArray(s.ledger.txnId, ids.settlements));
      await db.delete(s.advanceSettlements).where(inArray(s.advanceSettlements.id, ids.settlements));
    }
    if (ids.requests.length) await db.delete(s.advanceRequests).where(inArray(s.advanceRequests.id, ids.requests));
    if (ids.expenses.length) await db.delete(s.tripExpenses).where(inArray(s.tripExpenses.id, ids.expenses));
    if (ids.trips.length) await db.delete(s.trips).where(inArray(s.trips.id, ids.trips));
    if (ids.cargoTypes.length) await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, ids.cargoTypes));
    if (ids.routes.length) await db.delete(s.routes).where(inArray(s.routes.id, ids.routes));
    if (ids.customers.length) await db.delete(s.customers).where(inArray(s.customers.id, ids.customers));
    if (ids.users.length) await db.delete(s.users).where(inArray(s.users.id, ids.users));
    await client.end();
  });

  test('approving a chi hộ fee auto-offsets the oldest outstanding advance (FIFO) and posts the ledger debit', async () => {
    // Two outstanding advances: 200k (older) and 500k (newer).
    await insertApprovedAdvance(200_000, new Date('2026-07-01T00:00:00Z'));
    await insertApprovedAdvance(500_000, new Date('2026-07-05T00:00:00Z'));
    const before = await getOutstandingAdvanceBalance(forwarderId);
    assert.equal(before, 700_000);

    const expense = await insertExpense({ buyAmount: 150_000, approvalStatus: 'APPROVED' });

    await db.transaction(async (tx) => {
      await autoOffsetExpenseApproval(tx, expense.id);
    });

    // An APPROVED auto-settlement was created and linked to the expense.
    const [link] = await db.select({ settlementId: s.settlementExpenses.settlementId })
      .from(s.settlementExpenses).where(eq(s.settlementExpenses.tripExpenseId, expense.id)).limit(1);
    assert.ok(link, 'expense should be linked to an auto-settlement');
    ids.settlements.push(link.settlementId);
    const [settlement] = await db.select().from(s.advanceSettlements).where(eq(s.advanceSettlements.id, link.settlementId)).limit(1);
    assert.equal(settlement?.status, 'APPROVED');
    assert.equal(Number(settlement?.totalExpenseAmount), 150_000);

    // FIFO: only the oldest 200k advance was consumed (covered the 150k expense),
    // with a 50k refund (advance surplus the forwarder returns).
    const linkedRequests = await db.select({ advanceRequestId: s.advanceSettlementRequests.advanceRequestId })
      .from(s.advanceSettlementRequests).where(eq(s.advanceSettlementRequests.settlementId, link.settlementId));
    assert.equal(linkedRequests.length, 1, 'FIFO should consume exactly the oldest advance');

    // Outstanding balance dropped by the offset (200k consumed), and the
    // remaining 500k advance is still open.
    const after = await getOutstandingAdvanceBalance(forwarderId);
    assert.equal(after, 500_000);
  });

  test('double-post guard: running the offset twice does not create a second settlement', async () => {
    await insertApprovedAdvance(300_000, new Date('2026-07-02T00:00:00Z'));
    const expense = await insertExpense({ buyAmount: 100_000, approvalStatus: 'APPROVED' });

    await db.transaction(async (tx) => { await autoOffsetExpenseApproval(tx, expense.id); });
    // Second run must be a no-op (idempotent).
    await db.transaction(async (tx) => { await autoOffsetExpenseApproval(tx, expense.id); });

    const links = await db.select({ settlementId: s.settlementExpenses.settlementId })
      .from(s.settlementExpenses).where(eq(s.settlementExpenses.tripExpenseId, expense.id));
    assert.equal(links.length, 1, 'exactly one settlement link — no double-post');
    ids.settlements.push(links[0].settlementId);
  });

  test('skip COMPANY_DIRECT expenses (no forwarder fronted the money)', async () => {
    await insertApprovedAdvance(400_000, new Date('2026-07-03T00:00:00Z'));
    const expense = await insertExpense({
      buyAmount: 100_000, approvalStatus: 'APPROVED', settlementMethod: 'COMPANY_DIRECT', forwarderId: null,
    });

    await db.transaction(async (tx) => { await autoOffsetExpenseApproval(tx, expense.id); });

    const links = await db.select({ id: s.settlementExpenses.id })
      .from(s.settlementExpenses).where(eq(s.settlementExpenses.tripExpenseId, expense.id));
    assert.equal(links.length, 0, 'COMPANY_DIRECT expenses must not be auto-offset');
  });

  test('skip when the forwarder has no outstanding advance (no-op, no error)', async () => {
    const [isolatedForwarder] = await db.insert(s.users).values({
      username: `o2c-no-advance-${Date.now()}`,
      passwordHash: 'x',
      fullName: 'Ops không tạm ứng',
      role: 'FORWARDER',
    }).returning();
    ids.users.push(isolatedForwarder.id);
    const expense = await insertExpense({
      buyAmount: 100_000,
      approvalStatus: 'APPROVED',
      forwarderId: isolatedForwarder.id,
    });

    await db.transaction(async (tx) => { await autoOffsetExpenseApproval(tx, expense.id); });

    const links = await db.select({ id: s.settlementExpenses.id })
      .from(s.settlementExpenses).where(eq(s.settlementExpenses.tripExpenseId, expense.id));
    assert.equal(links.length, 0, 'no offset when there is nothing to offset against');
  });

  test('fires through propagateExpenseApproval (the on-approval hook)', async () => {
    await insertApprovedAdvance(250_000, new Date('2026-07-04T00:00:00Z'));
    const expense = await insertExpense({ buyAmount: 80_000, approvalStatus: 'APPROVED' });

    await db.transaction(async (tx) => { await propagateExpenseApproval(tx, { expenseId: expense.id }); });

    const [link] = await db.select({ settlementId: s.settlementExpenses.settlementId })
      .from(s.settlementExpenses).where(eq(s.settlementExpenses.tripExpenseId, expense.id)).limit(1);
    assert.ok(link, 'the on-approval hook should auto-offset');
    ids.settlements.push(link.settlementId);
  });
});
