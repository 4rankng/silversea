import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';
import { db, client } from '../db';
import * as s from '../db/schema';
import { createAdvanceRequest } from '../services/advance-request.service';
import { listAdvanceRequestsPaginated } from '../services/advance.service';
import { withTestCleanup } from './helpers/db-isolation';

// A completed advance approval must keep showing who requested it after the
// requester's account is removed. createAdvanceRequest snapshots the name at
// creation; enrichWithNames falls back to that snapshot when the live users
// row is gone (previously rendered "Đối tác không còn trong danh sách").
describe('advance requester-name snapshot', () => {
  const cleanup = withTestCleanup();
  const ids = { users: [] as number[], requests: [] as number[] };

  let userId: number;
  const expectedName = `AR Snap ${Date.now()}`;

  before(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const [user] = await db.insert(s.users).values({
      username: `arsnap-${suffix}`,
      passwordHash: 'x',
      fullName: expectedName,
      role: 'DRIVER',
    }).returning();
    userId = user.id;
    ids.users.push(userId);

    const created = await createAdvanceRequest(userId, { amount: 150_000, reason: 'snapshot test' });
    ids.requests.push(created.id);
    // Creation captures the snapshot and the live name resolves identically.
    assert.equal(created.requesterNameSnapshot, expectedName);
    assert.equal(created.requesterName, expectedName);

    // Simulate later account removal — the live join must now miss.
    await db.delete(s.users).where(eq(s.users.id, userId));
  });

  after(async () => {
    await cleanup.deleteWhere(s.users, ids.users, (uids) => inArray(s.users.id, uids));
    await cleanup.deleteAll(s.advanceRequests, ids.requests);
    await client.end();
  });

  test('falls back to the snapshot after the requester row is gone', async () => {
    const page = await listAdvanceRequestsPaginated({ requesterId: userId, page: 1, limit: 10 });
    assert.equal(page.total, 1);
    const item = page.items[0];
    assert.equal(item.requesterName, expectedName);
    assert.equal(item.requesterNameSnapshot, expectedName);
  });
});
