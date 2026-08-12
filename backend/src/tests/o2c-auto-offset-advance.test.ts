import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray } from 'drizzle-orm';
import { db, client } from '../db';
import * as s from '../db/schema';
import {
  autoOffsetExpenseApproval,
  getOutstandingAdvanceBalance,
  getOutstandingAdvanceBalances,
} from '../services/advance.service';
import { propagateExpenseApproval } from '../services/source-change.service';

/**
 * O2C Bước 4 — "Ranh giới Tạm ứng" (O2C Flow.md:72 / O2C dev-rev1.md:87):
 * "Ngay khi phí chi hộ được Kế toán duyệt, hệ thống tự động sinh bút toán cấn
 * trừ vào dư nợ tạm ứng." These tests pin the auto-offset fired on expense
 * approval: it consumes outstanding advances FIFO, posts the OPS_SETTLEMENT
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

  async function insertApprovedAdvance(amount: number, approvedAt: Date, requesterId = forwarderId) {
    const [request] = await db.insert(s.advanceRequests).values({
      requesterId,
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
      settlementMethod: (options.settlementMethod ?? 'OPS_ADVANCE') as 'OPS_ADVANCE' | 'COMPANY_DIRECT',
      approvalStatus: options.approvalStatus ?? 'APPROVED',
    }).returning();
    ids.expenses.push(expense.id);
    return expense;
  }

  before(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const [fwd, kt] = await db.insert(s.users).values([
      { username: `o2c-fwd-${suffix}`, passwordHash: 'x', fullName: 'Ops O2C', role: 'OPS' },
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
    if (ids.expenses.length) {
      const linkedSettlements = await db.select({ settlementId: s.settlementExpenses.settlementId })
        .from(s.settlementExpenses)
        .where(inArray(s.settlementExpenses.tripExpenseId, ids.expenses));
      ids.settlements.push(...linkedSettlements.map((row) => row.settlementId));
    }
    const settlementIds = [...new Set(ids.settlements)];
    // Clean settlement links first (FKs), then ledger, then parents.
    if (settlementIds.length) {
      await db.delete(s.advanceSettlementRequests).where(inArray(s.advanceSettlementRequests.settlementId, settlementIds));
      await db.delete(s.settlementExpenses).where(inArray(s.settlementExpenses.settlementId, settlementIds));
    }
    if (ids.expenses.length) await db.delete(s.settlementExpenses).where(inArray(s.settlementExpenses.tripExpenseId, ids.expenses));
    if (settlementIds.length) {
      await db.delete(s.ledger).where(inArray(s.ledger.txnId, settlementIds));
      await db.delete(s.advanceSettlements).where(inArray(s.advanceSettlements.id, settlementIds));
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

    // FIFO: only 150k of the oldest 200k advance is allocated. The residual
    // remains available; no cash refund exists without a separate return flow.
    const linkedRequests = await db.select({
      advanceRequestId: s.advanceSettlementRequests.advanceRequestId,
      allocatedAmount: s.advanceSettlementRequests.allocatedAmount,
    })
      .from(s.advanceSettlementRequests).where(eq(s.advanceSettlementRequests.settlementId, link.settlementId));
    assert.equal(linkedRequests.length, 1, 'FIFO should consume exactly the oldest advance');
    assert.equal(Number(linkedRequests[0].allocatedAmount), 150_000);
    assert.equal(Number(settlement?.refundAmount), 0, 'auto-offset must not invent a cash refund');

    const [posting] = await db.select({ debit: s.ledger.debit })
      .from(s.ledger)
      .where(and(
        eq(s.ledger.txnType, 'OPS_SETTLEMENT'),
        eq(s.ledger.txnId, link.settlementId),
      ))
      .limit(1);
    assert.equal(Number(posting?.debit), 150_000, 'ledger debit must equal the approved expense');

    // Outstanding balance drops by exactly the approved expense: 50k remains
    // on the oldest advance and the newer 500k remains untouched.
    const after = await getOutstandingAdvanceBalance(forwarderId);
    assert.equal(after, 550_000);
    const breakdown = await getOutstandingAdvanceBalances();
    assert.equal(
      breakdown.items.find((item) => item.forwarderId === forwarderId)?.outstanding,
      550_000,
    );
  });

  test('multiple approved expenses consume a single advance incrementally', async () => {
    const [isolatedForwarder] = await db.insert(s.users).values({
      username: `o2c-partial-${Date.now()}`,
      passwordHash: 'x',
      fullName: 'Ops tạm ứng một phần',
      role: 'OPS',
    }).returning();
    ids.users.push(isolatedForwarder.id);
    await insertApprovedAdvance(200_000, new Date('2026-07-01T01:00:00Z'), isolatedForwarder.id);
    const firstExpense = await insertExpense({
      buyAmount: 150_000,
      approvalStatus: 'APPROVED',
      forwarderId: isolatedForwarder.id,
    });
    const secondExpense = await insertExpense({
      buyAmount: 30_000,
      approvalStatus: 'APPROVED',
      forwarderId: isolatedForwarder.id,
    });

    await db.transaction(async (tx) => { await autoOffsetExpenseApproval(tx, firstExpense.id); });
    assert.equal(await getOutstandingAdvanceBalance(isolatedForwarder.id), 50_000);

    await db.transaction(async (tx) => { await autoOffsetExpenseApproval(tx, secondExpense.id); });
    assert.equal(await getOutstandingAdvanceBalance(isolatedForwarder.id), 20_000);

    const links = await db.select({ settlementId: s.settlementExpenses.settlementId })
      .from(s.settlementExpenses)
      .where(inArray(s.settlementExpenses.tripExpenseId, [firstExpense.id, secondExpense.id]));
    ids.settlements.push(...links.map((row) => row.settlementId));
    assert.equal(links.length, 2);

    const settlements = await db.select({ refundAmount: s.advanceSettlements.refundAmount })
      .from(s.advanceSettlements)
      .where(inArray(s.advanceSettlements.id, links.map((row) => row.settlementId)));
    assert.deepEqual(settlements.map((row) => Number(row.refundAmount)), [0, 0]);

    const allocations = await db.select({ allocatedAmount: s.advanceSettlementRequests.allocatedAmount })
      .from(s.advanceSettlementRequests)
      .where(inArray(s.advanceSettlementRequests.settlementId, links.map((row) => row.settlementId)));
    assert.equal(
      allocations.reduce((sum, allocation) => sum + Number(allocation.allocatedAmount), 0),
      180_000,
    );
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

  test('concurrent approval replays create exactly one allocation and one ledger posting', async () => {
    const [isolatedForwarder] = await db.insert(s.users).values({
      username: `o2c-concurrent-${Date.now()}`,
      passwordHash: 'x',
      fullName: 'Ops tạm ứng đồng thời',
      role: 'OPS',
    }).returning();
    ids.users.push(isolatedForwarder.id);
    await insertApprovedAdvance(300_000, new Date('2026-07-02T01:00:00Z'), isolatedForwarder.id);
    const expense = await insertExpense({
      buyAmount: 100_000,
      approvalStatus: 'APPROVED',
      forwarderId: isolatedForwarder.id,
    });

    const results = await Promise.allSettled([
      db.transaction(async (tx) => { await autoOffsetExpenseApproval(tx, expense.id); }),
      db.transaction(async (tx) => { await autoOffsetExpenseApproval(tx, expense.id); }),
    ]);
    assert.deepEqual(results.map((result) => result.status), ['fulfilled', 'fulfilled']);

    const links = await db.select({ settlementId: s.settlementExpenses.settlementId })
      .from(s.settlementExpenses)
      .where(eq(s.settlementExpenses.tripExpenseId, expense.id));
    assert.equal(links.length, 1, 'exactly one allocation link may exist for the expense');
    ids.settlements.push(...links.map((row) => row.settlementId));

    const [settlement] = await db.select({ autoOffsetExpenseId: s.advanceSettlements.autoOffsetExpenseId })
      .from(s.advanceSettlements)
      .where(eq(s.advanceSettlements.id, links[0].settlementId));
    assert.equal(settlement?.autoOffsetExpenseId, expense.id);

    const postings = await db.select({ id: s.ledger.id })
      .from(s.ledger)
      .where(and(
        eq(s.ledger.txnType, 'OPS_SETTLEMENT'),
        inArray(s.ledger.txnId, links.map((row) => row.settlementId)),
      ));
    assert.equal(postings.length, 1, 'exactly one financial posting may exist for the expense');
  });

  test('database uniqueness rejects a second automatic settlement authority for one expense', async () => {
    const [isolatedForwarder] = await db.insert(s.users).values({
      username: `o2c-db-unique-${Date.now()}`,
      passwordHash: 'x',
      fullName: 'Ops khóa DB',
      role: 'OPS',
    }).returning();
    ids.users.push(isolatedForwarder.id);
    await insertApprovedAdvance(300_000, new Date('2026-07-02T02:00:00Z'), isolatedForwarder.id);
    const expense = await insertExpense({
      buyAmount: 100_000,
      approvalStatus: 'APPROVED',
      forwarderId: isolatedForwarder.id,
    });

    await db.transaction(async (tx) => { await autoOffsetExpenseApproval(tx, expense.id); });
    const [existing] = await db.select({ settlementId: s.settlementExpenses.settlementId })
      .from(s.settlementExpenses)
      .where(eq(s.settlementExpenses.tripExpenseId, expense.id));
    ids.settlements.push(existing.settlementId);

    await assert.rejects(
      db.insert(s.advanceSettlements).values({
        code: `AUTO-DUP-${Date.now()}`.slice(0, 20),
        forwarderId: isolatedForwarder.id,
        totalExpenseAmount: '100000',
        refundAmount: '0',
        status: 'APPROVED',
        autoOffsetExpenseId: expense.id,
      }),
      (error: unknown) => {
        const cause = (error as { cause?: { code?: string } }).cause;
        assert.equal(cause?.code, '23505');
        return true;
      },
    );
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
      role: 'OPS',
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
