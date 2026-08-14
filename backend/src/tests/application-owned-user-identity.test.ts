import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { inArray } from 'drizzle-orm';

import { db, client } from '../db';
import { businessUnits, users } from '../db/schema';
import {
  createBusinessUnit,
  createUser,
  updateUser,
} from '../services/user.service';

const createdUserIds: number[] = [];
const createdBusinessUnitIds: number[] = [];

function uniqueToken(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function createInactiveManager(identity: {
  username: string;
  email?: string;
  phone?: string;
}) {
  const created = await createUser({
    ...identity,
    password: 'Abc123',
    role: 'MANAGER',
    status: 'INACTIVE',
  });
  createdUserIds.push(created.id);
  return created;
}

after(async () => {
  if (createdUserIds.length > 0) {
    await db.delete(users).where(inArray(users.id, createdUserIds));
  }
  if (createdBusinessUnitIds.length > 0) {
    await db.delete(businessUnits).where(inArray(businessUnits.id, createdBusinessUnitIds));
  }
  await client.end();
});

describe('application-owned user and business-unit identity', () => {
  test('allows creating accounts when other users also have unset email/phone', async () => {
    const token = uniqueToken();
    const first = await createInactiveManager({ username: `app-user-${token}` });
    const second = await createInactiveManager({ username: `app-user2-${token}` });
    assert.ok(second.id > 0);
    assert.notEqual(first.id, second.id);
  });

  test('treats blank email/phone as unset and does not conflict on them', async () => {
    const token = uniqueToken();
    const first = await createInactiveManager({ username: `app-user-${token}`, email: '   ', phone: '' });
    const second = await createInactiveManager({ username: `app-user2-${token}`, email: '   ', phone: '' });
    assert.notEqual(first.id, second.id);
  });

  test('returns a semantic conflict before the database uniqueness fence on concurrent usernames', async () => {
    const token = uniqueToken();
    const attempts = await Promise.allSettled([
      createInactiveManager({ username: `app-user-${token}` }),
      createInactiveManager({ username: ` APP-USER-${token.toUpperCase()} ` }),
    ]);

    assert.equal(attempts.filter((result) => result.status === 'fulfilled').length, 1);
    const rejected = attempts.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    assert.ok(rejected);
    assert.equal(rejected.reason.statusCode, 409);
  });

  test('rejects email reuse during update using canonical application comparison', async () => {
    const token = uniqueToken();
    const first = await createInactiveManager({
      username: `app-first-${token}`,
      email: `owner-${token}@example.test`,
    });
    const second = await createInactiveManager({ username: `app-second-${token}` });

    await assert.rejects(
      updateUser(second.id, { email: ` OWNER-${token.toUpperCase()}@EXAMPLE.TEST ` }),
      (error: { statusCode?: number }) => error.statusCode === 409,
    );
    assert.notEqual(first.id, second.id);
  });

  test('serializes concurrent canonical business-unit creation', async () => {
    const token = uniqueToken();
    const attempts = await Promise.allSettled([
      createBusinessUnit({ code: `BU-${token}`, name: `Đơn vị ${token}` }),
      createBusinessUnit({ code: ` bu-${token} `, name: `Đơn vị khác ${token}` }),
    ]);
    for (const result of attempts) {
      if (result.status === 'fulfilled') createdBusinessUnitIds.push(result.value.id);
    }

    assert.equal(attempts.filter((result) => result.status === 'fulfilled').length, 1);
    const rejected = attempts.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    assert.ok(rejected);
    assert.equal(rejected.reason.statusCode, 409);
  });
});
