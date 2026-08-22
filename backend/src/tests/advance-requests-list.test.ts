import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { inArray } from 'drizzle-orm';
import { db, client } from '../db';
import * as s from '../db/schema';
import { listAdvanceRequestsPaginated } from '../services/advance.service';
import { withTestCleanup } from './helpers/db-isolation';

describe('advance requests SQL-paginated list', () => {
  const cleanup = withTestCleanup();
  const ids = { users: [] as number[], requests: [] as number[], settlements: [] as number[] };

  // Name tokens share a unique suffix so the search subquery matches only this
  // run's rows even on the shared integration database.
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const forwarderAName = `ARList A ${suffix}`;
  const forwarderBName = `ARList B ${suffix}`;

  let forwarderAId: number;
  let forwarderBId: number;
  let approvedARequestId: number;

  async function insertRequest(ownerId: number, status: 'PENDING' | 'APPROVED' | 'REJECTED', amount: number, createdAt: Date) {
    const [request] = await db.insert(s.advanceRequests).values({
      requesterId: ownerId,
      amount: String(amount),
      reason: `ARList ${status}`,
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
    const users = await db.insert(s.users).values([
      { username: `arlist-a-${suffix}`, passwordHash: 'x', fullName: forwarderAName, role: 'DRIVER' },
      { username: `arlist-b-${suffix}`, passwordHash: 'x', fullName: forwarderBName, role: 'DRIVER' },
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

  test('paginates in SQL with a complete envelope (forwarder-scoped)', async () => {
    const page2 = await listAdvanceRequestsPaginated({ requesterId: forwarderAId, page: 2, limit: 2 });
    assert.equal(page2.page, 2);
    assert.equal(page2.limit, 2);
    assert.equal(page2.pageSize, 2);
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
    assert.equal(page1.items[0].requesterName, forwarderAName);
  });

  test('filters by status server-side while aggregates stay full-set', async () => {
    const result = await listAdvanceRequestsPaginated({ requesterId: forwarderAId, status: 'APPROVED', page: 1, limit: 50 });
    assert.equal(result.total, 1);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].status, 'APPROVED');
    assert.equal(result.items[0].id, approvedARequestId);
    assert.equal(result.totalPages, 1);
    // Pills/KPIs describe the forwarder's whole set, not the active tab.
    assert.deepEqual(result.statusCounts, { PENDING: 3, APPROVED: 1, REJECTED: 1 });
    assert.equal(result.statusAmounts.APPROVED, 500_000);
    assert.equal(result.statusAmounts.PENDING, 600_000);
  });

  test('search matches requester names in SQL and composes with scoping', async () => {
    const bySuffix = await listAdvanceRequestsPaginated({ search: suffix, page: 1, limit: 50 });
    assert.equal(bySuffix.total, 7); // both forwarders of this run
    assert.ok(bySuffix.items.every(item => item.requesterName === forwarderAName || item.requesterName === forwarderBName));

    const onlyB = await listAdvanceRequestsPaginated({ search: `ARList B ${suffix}`, page: 1, limit: 50 });
    assert.equal(onlyB.total, 2);
    assert.ok(onlyB.items.every(item => item.requesterId === forwarderBId));

    // Search is intersected with the requester scope, never able to leak rows.
    const scopedToA = await listAdvanceRequestsPaginated({ requesterId: forwarderAId, search: `ARList B ${suffix}`, page: 1, limit: 50 });
    assert.equal(scopedToA.total, 0);
    assert.equal(scopedToA.items.length, 0);
  });

  test('forwarder scoping never returns another forwarder rows', async () => {
    const result = await listAdvanceRequestsPaginated({ requesterId: forwarderBId, page: 1, limit: 50 });
    assert.equal(result.total, 2);
    assert.ok(result.items.every(item => item.requesterId === forwarderBId));
    assert.ok(!result.items.some(item => item.requesterId === forwarderAId));
    assert.deepEqual(result.statusCounts, { PENDING: 1, APPROVED: 1 });
  });

  test('excludeLinkedToActiveSettlement drops claimed requests from the filtered set only', async () => {
    const [settlement] = await db.insert(s.advanceSettlements).values({
      code: `PT-ARL-${suffix}`.slice(0, 20),
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

    const eligible = await listAdvanceRequestsPaginated({
      requesterId: forwarderAId,
      status: 'APPROVED',
      excludeLinkedToActiveSettlement: true,
      page: 1,
      limit: 50,
    });
    assert.equal(eligible.total, 0);
    assert.equal(eligible.items.length, 0);
    // The full-set aggregates ignore the eligibility filter by design.
    assert.deepEqual(eligible.statusCounts, { PENDING: 3, APPROVED: 1, REJECTED: 1 });

    const unfiltered = await listAdvanceRequestsPaginated({ requesterId: forwarderAId, status: 'APPROVED', page: 1, limit: 50 });
    assert.equal(unfiltered.total, 1);
  });
});
