import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import bcrypt from 'bcryptjs';
import { inArray } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import { db, client } from '../db';
import * as s from '../db/schema';
import { cacheInvalidate } from '../lib/redis';
import { disconnectRedis } from '../lib/redis';
import { getFuelPriceHistory } from '../services/config.service';

// Card 20261002_290: the fuel-price history resolves changedBy to the user's
// display name backend-side — the internal id is never a user-facing label
// (§2), and the history table's "Người thay đổi" column renders this read.

const tag = `fuelhist-${Date.now()}`;
const userIds: number[] = [];
const historyIds: number[] = [];

before(async () => {
  // The history read is cached app-wide; a stale pre-join payload from another
  // suite would mask the join under test.
  await cacheInvalidate('config:fuel-price-history');
});

test('getFuelPriceHistory resolves changedBy to the display name and keeps unnamed rows null', async () => {
  const [named] = await db.insert(s.users).values({
    username: `${tag}-ketoan`, fullName: `Kế toán ${tag}`, passwordHash: await bcrypt.hash('test-only', 10),
    role: Role.ACCOUNTANT, status: 'ACTIVE',
  }).returning({ id: s.users.id });
  userIds.push(named.id);

  const inserted = await db.insert(s.fuelPriceHistory).values([
    { unitPrice: '23000', effectiveDate: new Date('2026-10-01T00:00:00Z'), changedBy: named.id, note: 'Cấu hình ban đầu' },
    { unitPrice: '24500', effectiveDate: new Date('2026-10-03T00:00:00Z'), changedBy: null, note: null },
  ]).returning({ id: s.fuelPriceHistory.id });
  historyIds.push(...inserted.map(row => row.id));

  const history = await getFuelPriceHistory();
  const namedRow = history.find(row => row.id === historyIds[0]);
  const unnamedRow = history.find(row => row.id === historyIds[1]);
  assert.ok(namedRow && unnamedRow, 'both seeded rows are returned');

  assert.equal(namedRow.changedByName, `Kế toán ${tag}`);
  assert.equal(namedRow.changedBy, named.id);
  assert.equal(unnamedRow.changedByName, null);
});

after(async () => {
  if (historyIds.length) await db.delete(s.fuelPriceHistory).where(inArray(s.fuelPriceHistory.id, historyIds));
  if (userIds.length) await db.delete(s.users).where(inArray(s.users.id, userIds));
  await cacheInvalidate('config:fuel-price-history');
  await disconnectRedis();
  await client.end();
});
