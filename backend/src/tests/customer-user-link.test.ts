import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import { eq, inArray } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import { db, client } from '../db';
import * as s from '../db/schema';
import {
  authenticate,
  createUser,
  listUsers,
  updateBusinessUnit,
  updateUser,
} from '../services/user.service';
import { authMiddleware } from '../middleware/auth';
import { config } from '../config';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let customerId: number;
let secondaryCustomerId: number;
let businessUnitId: number;
let customerUserId: number;
let managerUserId: number;
let clerkUserId: number;
let accountantUserId: number;
let server: http.Server;
let baseUrl: string;

before(async () => {
  const [customer] = await db.insert(s.customers)
    .values({ name: `Customer account link ${suffix}` })
    .returning({ id: s.customers.id });
  customerId = customer.id;
  const [secondaryCustomer] = await db.insert(s.customers)
    .values({ name: `Customer account link secondary ${suffix}` })
    .returning({ id: s.customers.id });
  secondaryCustomerId = secondaryCustomer.id;
  const [businessUnit] = await db.insert(s.businessUnits)
    .values({
      code: `CUL-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      name: `Customer account link unit ${suffix}`,
      status: 'ACTIVE',
    })
    .returning({ id: s.businessUnits.id });
  businessUnitId = businessUnit.id;

  const app = express();
  app.get('/protected', authMiddleware, (_req, res) => res.json({ ok: true }));
  await new Promise<void>((resolve) => {
    server = http.createServer(app);
    server.listen(0, () => {
      baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (customerUserId) await db.delete(s.users).where(eq(s.users.id, customerUserId));
  if (managerUserId) await db.delete(s.users).where(eq(s.users.id, managerUserId));
  if (clerkUserId) await db.delete(s.users).where(eq(s.users.id, clerkUserId));
  if (accountantUserId) await db.delete(s.users).where(eq(s.users.id, accountantUserId));
  if (businessUnitId) await db.delete(s.businessUnits).where(eq(s.businessUnits.id, businessUnitId));
  if (customerId) await db.delete(s.customers).where(eq(s.customers.id, customerId));
  if (secondaryCustomerId) await db.delete(s.customers).where(eq(s.customers.id, secondaryCustomerId));
  await client.end();
});

describe('customer account linkage', () => {
  test('creates a CUSTOMER user linked to an existing customer', async () => {
    const user = await createUser({
      username: `customer-linked-${suffix}`,
      password: 'admin123',
      role: Role.CUSTOMER,
      customerIds: [customerId],
    });
    customerUserId = user.id;
    assert.equal(user.customerId, customerId);
    assert.deepEqual(user.customerIds, [customerId]);
  });

  test('rejects a customer link on a non-CUSTOMER role', async () => {
    await assert.rejects(
      createUser({
        username: `manager-invalid-link-${suffix}`,
        password: 'admin123',
        role: Role.MANAGER,
        customerIds: [customerId],
      }),
      /Chỉ tài khoản khách hàng/,
    );
  });

  test('rejects an ACTIVE customer without at least one linked customer', async () => {
    await assert.rejects(
      createUser({
        username: `customer-unlinked-${suffix}`,
        password: 'admin123',
        role: Role.CUSTOMER,
      }),
      /ACTIVE phải có ít nhất một khách hàng liên kết/,
    );
  });

  test('allows an INACTIVE customer to be created without customer links', async () => {
    const user = await createUser({
      username: `customer-inactive-unlinked-${suffix}`,
      password: 'admin123',
      role: Role.CUSTOMER,
      status: 'INACTIVE',
    });
    assert.equal(user.customerId, null);
    assert.deepEqual(user.customerIds, []);
    await db.delete(s.users).where(eq(s.users.id, user.id));
  });

  test('rejects creating an ACTIVE clerk without a valid assignment scope', async () => {
    await assert.rejects(
      createUser({
        username: `clerk-unscoped-${suffix}`,
        password: 'admin123',
        role: Role.CLERK,
      }),
      /Nhân viên chứng từ ACTIVE phải có ít nhất một đơn vị phụ trách/,
    );
  });

  test('rejects non-admin clerk scope assignment mutations', async () => {
    await assert.rejects(
      createUser({
        username: `clerk-non-admin-${suffix}`,
        password: 'admin123',
        role: Role.CLERK,
        customerIds: [customerId],
        businessUnitIds: [businessUnitId],
        assignmentAdminOnly: true,
      }),
      /Chỉ quản trị viên mới có thể quản lý phạm vi nhân viên chứng từ/,
    );
  });

  test('allows admin-managed optional customer scope for ACCOUNTANT', async () => {
    const accountant = await createUser({
      username: `accountant-scoped-${suffix}`,
      password: 'admin123',
      role: Role.ACCOUNTANT,
      customerIds: [customerId],
      assignmentAdminOnly: false,
    });
    accountantUserId = accountant.id;
    assert.equal(accountant.customerId, customerId);
    assert.deepEqual(accountant.customerIds, [customerId]);

    const updated = await updateUser(accountant.id, {
      customerIds: [secondaryCustomerId],
      assignmentAdminOnly: false,
    });
    assert.deepEqual(updated.customerIds, [secondaryCustomerId]);
  });

  test('rejects non-admin ACCOUNTANT customer-scope assignment', async () => {
    await assert.rejects(
      createUser({
        username: `accountant-non-admin-${suffix}`,
        password: 'admin123',
        role: Role.ACCOUNTANT,
        customerIds: [customerId],
        assignmentAdminOnly: true,
      }),
      /Chỉ quản trị viên mới có thể quản lý phạm vi khách hàng của kế toán/,
    );
  });

  test('rejects a token immediately after its customer scope changes', async () => {
    const token = jwt.sign({
      userId: customerUserId,
      username: `customer-linked-${suffix}`,
      role: Role.CUSTOMER,
      customerId,
      customerIds: [customerId],
    }, config.jwtSecret);

    await updateUser(customerUserId, { customerIds: [secondaryCustomerId] });
    const response = await fetch(`${baseUrl}/protected`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 401);
    await updateUser(customerUserId, { customerIds: [customerId] });
  });

  test('revokes a token when a linked customer is soft-deleted', async () => {
    await updateUser(customerUserId, { customerIds: [customerId, secondaryCustomerId] });
    const token = jwt.sign({
      userId: customerUserId,
      username: `customer-linked-${suffix}`,
      role: Role.CUSTOMER,
      customerId,
      customerIds: [customerId, secondaryCustomerId].sort((a, b) => a - b),
    }, config.jwtSecret);

    await db.update(s.customers)
      .set({ deletedAt: new Date() })
      .where(eq(s.customers.id, secondaryCustomerId));
    const response = await fetch(`${baseUrl}/protected`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 401);
    const refreshed = await authenticate(`customer-linked-${suffix}`, 'admin123');
    assert.deepEqual(refreshed.customerIds, [customerId]);
    assert.equal(refreshed.customerId, customerId);

    await db.update(s.customers)
      .set({ deletedAt: null })
      .where(eq(s.customers.id, secondaryCustomerId));
    await updateUser(customerUserId, { customerIds: [customerId] });
  });

  test('rejects clearing scope from an ACTIVE clerk account', async () => {
    const clerk = await createUser({
      username: `scoped-clerk-${suffix}`,
      password: 'admin123',
      role: Role.CLERK,
      customerIds: [customerId],
      businessUnitIds: [businessUnitId],
    });
    clerkUserId = clerk.id;

    await assert.rejects(
      updateUser(clerk.id, { businessUnitIds: [], customerIds: [] }),
      /Nhân viên chứng từ ACTIVE phải có ít nhất một đơn vị phụ trách/,
    );
  });

  test('hides assignment metadata from accountant-scoped user listing', async () => {
    const scopedClerk = clerkUserId
      ? await authenticate(`scoped-clerk-${suffix}`, 'admin123')
      : await createUser({
        username: `scoped-clerk-list-${suffix}`,
        password: 'admin123',
        role: Role.CLERK,
        customerIds: [customerId],
        businessUnitIds: [businessUnitId],
      });
    if (!clerkUserId) clerkUserId = scopedClerk.id;

    const users = await listUsers(Role.ACCOUNTANT);
    const listed = users.items.find((user) => user.id === scopedClerk.id);
    assert.ok(listed, 'scoped clerk listed');
    assert.deepEqual(listed?.customerIds, []);
    assert.deepEqual(listed?.businessUnitIds, []);
    assert.deepEqual(listed?.shipmentIds, []);
  });

  test('unit deactivation preserves the ACTIVE clerk assignment invariant', async () => {
    const [primaryUnit, alternativeUnit] = await db.insert(s.businessUnits).values([
      {
        code: `CUL-P-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        name: `Clerk lifecycle primary ${suffix}`,
        status: 'ACTIVE',
      },
      {
        code: `CUL-A-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        name: `Clerk lifecycle alternative ${suffix}`,
        status: 'ACTIVE',
      },
    ]).returning();
    const clerk = await createUser({
      username: `clerk-unit-lifecycle-${suffix}`,
      password: 'admin123',
      role: Role.CLERK,
      customerIds: [customerId],
      businessUnitIds: [primaryUnit.id],
    });

    try {
      await assert.rejects(
        updateBusinessUnit(primaryUnit.id, { status: 'INACTIVE' }),
        /đơn vị hoạt động duy nhất/,
      );
      const [stillActive] = await db.select({ status: s.businessUnits.status })
        .from(s.businessUnits)
        .where(eq(s.businessUnits.id, primaryUnit.id));
      assert.equal(stillActive.status, 'ACTIVE');

      await updateUser(clerk.id, {
        businessUnitIds: [primaryUnit.id, alternativeUnit.id],
      });
      const deactivated = await updateBusinessUnit(primaryUnit.id, { status: 'INACTIVE' });
      assert.equal(deactivated.status, 'INACTIVE');
      const refreshed = await authenticate(`clerk-unit-lifecycle-${suffix}`, 'admin123');
      assert.deepEqual(refreshed.businessUnitIds, [alternativeUnit.id]);

      await updateBusinessUnit(primaryUnit.id, { status: 'ACTIVE' });
      const race = await Promise.allSettled([
        updateUser(clerk.id, { businessUnitIds: [primaryUnit.id] }),
        updateBusinessUnit(primaryUnit.id, { status: 'INACTIVE' }),
      ]);
      assert.equal(
        race.filter((result) => result.status === 'fulfilled').length,
        1,
        'assignment and deactivation serialize so exactly one conflicting operation commits',
      );
      const afterRace = await authenticate(`clerk-unit-lifecycle-${suffix}`, 'admin123');
      assert.ok(afterRace.businessUnitIds.length > 0, 'ACTIVE clerk retains at least one ACTIVE unit');
    } finally {
      await db.delete(s.users).where(eq(s.users.id, clerk.id));
      await db.delete(s.businessUnits).where(eq(s.businessUnits.id, primaryUnit.id));
      await db.delete(s.businessUnits).where(eq(s.businessUnits.id, alternativeUnit.id));
    }
  });

  test('concurrent deactivation of different units preserves an ACTIVE clerk unit', async () => {
    const units = await db.insert(s.businessUnits).values([
      {
        code: `CUL-R1-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        name: `Clerk race unit one ${suffix}`,
        status: 'ACTIVE',
      },
      {
        code: `CUL-R2-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        name: `Clerk race unit two ${suffix}`,
        status: 'ACTIVE',
      },
    ]).returning();
    const unitIds = units.map((unit) => unit.id);
    const clerk = await createUser({
      username: `clerk-unit-race-${suffix}`,
      password: 'admin123',
      role: Role.CLERK,
      customerIds: [customerId],
      businessUnitIds: unitIds,
    });

    try {
      const outcomes: Array<{
        winners: number;
        loserStatusCodes: unknown[];
        activeUnits: number;
      }> = [];
      for (let trial = 0; trial < 20; trial += 1) {
        await db.update(s.businessUnits)
          .set({ status: 'ACTIVE' })
          .where(inArray(s.businessUnits.id, unitIds));
        const results = await Promise.allSettled(
          unitIds.map((unitId) => updateBusinessUnit(unitId, { status: 'INACTIVE' })),
        );
        const activeUnits = await db.select({
          id: s.businessUnits.id,
          status: s.businessUnits.status,
        })
          .from(s.businessUnits)
          .where(inArray(s.businessUnits.id, unitIds));
        outcomes.push({
          winners: results.filter((result) => result.status === 'fulfilled').length,
          loserStatusCodes: results
            .filter((result) => result.status === 'rejected')
            .map((result) => result.reason?.statusCode),
          activeUnits: activeUnits.filter((unit) => unit.status === 'ACTIVE').length,
        });
      }
      assert.ok(
        outcomes.every((outcome) => (
          outcome.winners === 1
          && outcome.loserStatusCodes.length === 1
          && outcome.loserStatusCodes[0] === 409
          && outcome.activeUnits >= 1
        )),
        `each trial must have one 409 loser and an active unit: ${JSON.stringify(outcomes)}`,
      );
    } finally {
      await db.delete(s.users).where(eq(s.users.id, clerk.id));
      await db.delete(s.businessUnits).where(inArray(s.businessUnits.id, unitIds));
    }
  });

  test('rejects clearing links from an ACTIVE customer account', async () => {
    await assert.rejects(
      updateUser(customerUserId, { customerIds: [] }),
      /ACTIVE phải có ít nhất một khách hàng liên kết/,
    );
  });

  test('concurrent role and customer-link changes cannot leave an invalid combination', async () => {
    await Promise.allSettled([
      updateUser(customerUserId, { role: Role.MANAGER }),
      updateUser(customerUserId, { customerIds: [customerId] }),
    ]);
    const [persisted] = await db.select({
      role: s.users.role,
      customerId: s.users.customerId,
    }).from(s.users).where(eq(s.users.id, customerUserId)).limit(1);
    assert.equal(persisted.role, Role.MANAGER);
    assert.equal(persisted.customerId, null);
    const links = await db.select().from(s.userCustomerLinks).where(eq(s.userCustomerLinks.userId, customerUserId));
    assert.equal(links.length, 0);

    const updated = await updateUser(customerUserId, { role: Role.MANAGER });
    assert.equal(updated.role, Role.MANAGER);
    assert.equal(updated.customerId, null);
    assert.deepEqual(updated.customerIds, []);
    managerUserId = customerUserId;
    customerUserId = 0;
  });

  test('rejects a link to a missing customer', async () => {
      await assert.rejects(
      updateUser(managerUserId, { role: Role.CUSTOMER, customerIds: [2_147_483_647] }),
      /Khách hàng liên kết không tồn tại/,
    );
  });
});
