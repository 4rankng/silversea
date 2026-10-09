// Card 20261009_2 — the finance-facing Danh sách nhân sự page 403s on
// /auth/users for ACCOUNTANT (menu invites office staff, data is admin-only).
// Fix: a dedicated hr_roster read (policy rows for MANAGER/ACCOUNTANT, ADMIN
// via wildcard) + a driver-only projected service read. Two pins:
// (1) the casbin grant matrix, (2) the projection contract (drivers only,
// roster columns only — no salary/login/assignment metadata).
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Role } from '@tingting/shared';
import { eq, inArray } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { disconnectRedis } from '../lib/redis';
import { getEnforcer, initEnforcer } from '../casbin/enforcer';
import { listHrRoster } from '../services/user.service';

const suffix = `${Date.now()}-hrroster-${Math.random().toString(36).slice(2, 8)}`;
const createdUserIds: number[] = [];

describe('hr_roster casbin grant matrix (card 20261009_2)', () => {
  before(async () => { await initEnforcer(); });

  const cases: Array<[Role, boolean]> = [
    [Role.ADMIN, true],
    [Role.MANAGER, true],
    [Role.ACCOUNTANT, true],
    [Role.DISPATCHER, false],
    [Role.OPS, false],
    [Role.DRIVER, false],
    [Role.CUS, false],
    [Role.CUSTOMER, false],
  ];
  for (const [role, allowed] of cases) {
    test(`${role} ${allowed ? 'can' : 'cannot'} read hr_roster`, async () => {
      const enforcer = getEnforcer();
      assert.equal(await enforcer.enforce(role, 'hr_roster', 'read'), allowed);
    });
  }
});

describe('listHrRoster projection (card 20261009_2)', () => {
  let driverId = 0;

  before(async () => {
    const [driver] = await db.insert(s.users).values({
      username: `hrroster-driver-${suffix}`,
      passwordHash: 'test-only', role: Role.DRIVER, status: 'ACTIVE',
      fullName: 'Roster Driver QA', employeeCode: 'RD001', email: 'rd@example.com', phone: '0900',
    }).returning({ id: s.users.id });
    driverId = driver.id;
    createdUserIds.push(driverId);
    const [office] = await db.insert(s.users).values({
      username: `hrroster-acct-${suffix}`,
      passwordHash: 'test-only', role: Role.ACCOUNTANT, status: 'ACTIVE',
      fullName: 'Roster Accountant QA',
    }).returning({ id: s.users.id });
    createdUserIds.push(office.id);
    const [deleted] = await db.insert(s.users).values({
      username: `hrroster-deleted-${suffix}`,
      passwordHash: 'test-only', role: Role.DRIVER, status: 'ACTIVE',
      fullName: 'Roster Deleted QA', deletedAt: new Date(),
    }).returning({ id: s.users.id });
    createdUserIds.push(deleted.id);
  });

  after(async () => {
    if (createdUserIds.length) await db.delete(s.users).where(inArray(s.users.id, createdUserIds));
    // the soft-deleted row is still matched by id for cleanup
    await db.delete(s.users).where(eq(s.users.username, `hrroster-deleted-${suffix}`));
    await disconnectRedis();
  });

  test('returns only live drivers, projected roster columns only', async () => {
    const roster = await listHrRoster();
    assert.ok(Array.isArray(roster.items));
    assert.ok(Array.isArray(roster.businessUnits));
    assert.equal(typeof roster.total, 'number');
    // our fixtures decide membership precisely
    const driverRow = roster.items.find((u) => u.id === driverId);
    assert.ok(driverRow, 'seeded live driver must be in the roster');
    assert.equal(driverRow.role, Role.DRIVER);
    assert.equal(driverRow.fullName, 'Roster Driver QA');
    assert.deepEqual(Object.keys(driverRow).sort(),
      ['businessUnitIds', 'email', 'employeeCode', 'fullName', 'id', 'phone', 'role', 'status'],
      'projection must expose roster columns only');
    assert.equal(roster.items.find((u) => u.fullName === 'Roster Accountant QA'), undefined,
      'office roles never appear (2026-10-09 driver-only ruling)');
    assert.equal(roster.items.find((u) => u.fullName === 'Roster Deleted QA'), undefined,
      'soft-deleted users never appear');
  });
});
