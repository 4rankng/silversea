import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { inArray } from 'drizzle-orm';
import { db, client } from '../db';
import * as s from '../db/schema';
import { listAdvanceRequests, listAdvanceRequestsPaginated } from '../services/advance.service';
import { withTestCleanup } from './helpers/db-isolation';

// Covers the paginated forwarder advance-requests list route swap:
// listAdvanceRequestsPaginated({ requesterId, status, page, limit }) plus the
// settlement-eligibility branch that keeps the legacy full-array shape.
describe('forwarder advance requests list', () => {
  const cleanup = withTestCleanup();
  const ids = { users: [] as number[], requests: [] as number[], settlements: [] as number[] };

  let forwarderAId: number;
  let forwarderBId: number;
  let approvedARequestId: number;

  async function insertRequest(ownerId: number, status: 'PENDING' | 'APPROVED' | 'REJECTED', amount: number, createdAt: Date) {
    const [request] = await db.insert(s.advanceRequests).values({
      requesterId: ownerId,
      amount: String(amount),
      reason: 'ARList test',
      status,
      approvedBy: status === 'PENDING' ? null : ownerId,
      approvedAt: status === 'PENDING' ? null : createdAt,
      createdAt,
      updatedAt: createdAt,
    }).returning();
    ids.requests.push(request.id);
    return request;
  }

  before(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const users = await db.insert(s.users).values([
      { username: `arlist-a-${suffix}`, passwordHash: 'x', fullName: `ARList A ${suffix}`, role: 'DRIVER' },
      { username: `arlist-b-${suffix}`, passwordHash: 'x', fullName: `ARList B ${suffix}`, role: 'DRIVER' },
    ]).returning();
    [forwarderAId, forwarderBId] = users.map(row => row.id);
    ids.users.push(...users.map(row => row.id));

    // Distinct createdAt values keep the desc(createdAt) ordering (and thus
    // LIMIT/OFFSET page boundaries) deterministic across separate queries.
    const base = Date.now();
    await insertRequest(forwarderAId, 'PENDING', 100_000, new Date(base - 60_000));
    await insertRequest(forwarderAId, 'PENDING', 200_000, new Date(base - 50_000));
    await insertRequest(forwarderAId, 'PENDING', 300_000, new Date(base - 40_000));
    approvedARequestId = (await insertRequest(forwarderAId, 'APPROVED', 500_000, new Date(base - 30_000))).id;
    await insertRequest(forwarderAId, 'REJECTED', 50_000, new Date(base - 20_000));
    await insertRequest(forwarderBId, 'PENDING', 75_000, new Date(base - 10_000));
    await insertRequest(forwarderBId, 'APPROVED', 125_000, new Date(base));
  });

  after(async () => {
    // Links first, then parents — each delete isolated so one failure cannot
    // orphan the rest of the teardown.
    await cleanup.deleteWhere(s.advanceSettlementRequests, ids.requests, (requestIds) => inArray(s.advanceSettlementRequests.advanceRequestId, requestIds));
    await cleanup.deleteAll(s.advanceSettlements, ids.settlements);
    await cleanup.deleteAll(s.advanceRequests, ids.requests);
    await cleanup.deleteAll(s.users, ids.users);
    await client.end();
  });

  test('paginates in SQL with the shared envelope, scoped to one forwarder', async () => {
    const page2 = await listAdvanceRequestsPaginated({ requesterId: forwarderAId, page: 2, limit: 2 });
    // pageSize is the wave-convention alias of limit (plan envelope: pageSize|limit).
    assert.deepEqual(Object.keys(page2).sort(),
      ['items', 'limit', 'page', 'pageSize', 'statusAmounts', 'statusCounts', 'total', 'totalPages']);
    assert.equal(page2.page, 2);
    assert.equal(page2.limit, 2);
    assert.equal(page2.total, 5);
    assert.equal(page2.totalPages, 3);
    assert.equal(page2.items.length, 2);
    // desc(createdAt): page 2 holds the 3rd and 2nd newest of forwarder A.
    assert.deepEqual(page2.items.map(item => Number(item.amount)).sort((a, b) => b - a), [300_000, 200_000]);

    const page1 = await listAdvanceRequestsPaginated({ requesterId: forwarderAId, page: 1, limit: 2 });
    assert.equal(page1.items.length, 2);
    assert.equal(Number(page1.items[0].amount), 50_000); // newest first

    const beyond = await listAdvanceRequestsPaginated({ requesterId: forwarderAId, page: 9, limit: 2 });
    assert.equal(beyond.items.length, 0);
    assert.equal(beyond.total, 5);

    // Enrichment runs on the page rows only — every item carries its names.
    assert.ok(page1.items.every(item => typeof item.requesterName === 'string'));
  });

  test('never returns another forwarder rows; aggregates stay requester-scoped', async () => {
    const result = await listAdvanceRequestsPaginated({ requesterId: forwarderBId, page: 1, limit: 50 });
    assert.equal(result.total, 2);
    assert.ok(result.items.every(item => item.requesterId === forwarderBId));
    assert.ok(!result.items.some(item => item.requesterId === forwarderAId));
    // Pills/KPIs describe this forwarder's whole set, not the global table.
    assert.deepEqual(result.statusCounts, { PENDING: 1, APPROVED: 1 });
    assert.equal(result.statusAmounts.APPROVED, 125_000);
  });

  test('filters by status server-side while aggregates stay full-set', async () => {
    const result = await listAdvanceRequestsPaginated({ requesterId: forwarderAId, status: 'APPROVED', page: 1, limit: 50 });
    assert.equal(result.total, 1);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].id, approvedARequestId);
    assert.deepEqual(result.statusCounts, { PENDING: 3, APPROVED: 1, REJECTED: 1 });
    assert.equal(result.statusAmounts.PENDING, 600_000);
  });

  test('settlement-eligibility branch excludes requests linked to an active settlement', async () => {
    const [settlement] = await db.insert(s.advanceSettlements).values({
      code: `PT-ARL-${Date.now()}`.slice(0, 20),
      forwarderId: forwarderAId,
      totalExpenseAmount: '500000',
      status: 'PENDING',
    }).returning();
    ids.settlements.push(settlement.id);
    await db.insert(s.advanceSettlementRequests).values({
      settlementId: settlement.id,
      advanceRequestId: approvedARequestId,
      allocatedAmount: '500000',
    });

    const eligible = await listAdvanceRequests({
      requesterId: forwarderAId,
      status: 'APPROVED',
      excludeLinkedToActiveSettlement: true,
    });
    assert.ok(!eligible.some(item => item.id === approvedARequestId));

    const unfiltered = await listAdvanceRequests({ requesterId: forwarderAId, status: 'APPROVED' });
    assert.ok(unfiltered.some(item => item.id === approvedARequestId));
  });
});
