import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import { eq, inArray } from 'drizzle-orm';
import { CustomerAccountType, Role } from '@tingting/shared';
import { db, client } from '../db';
import * as s from '../db/schema';
import {
  authenticate,
  createUser,
  deleteUser,
  listUsers,
  updateBusinessUnit,
  updateUser,
} from '../services/user.service';
import { assetAuthMiddleware, authMiddleware } from '../middleware/auth';
import authRoutes from '../routes/auth';
import { config } from '../config';
import { globalErrorHandler } from '../middleware/errorHandler';
import { initEnforcer } from '../casbin/enforcer';
import { disconnectRedis } from '../lib/redis';

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
  await initEnforcer();
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
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.get('/protected', authMiddleware, (_req, res) => res.json({ ok: true }));
  app.get('/protected-asset', assetAuthMiddleware, (_req, res) => res.json({ ok: true }));
  app.use(globalErrorHandler);
  await new Promise<void>((resolve) => {
    server = http.createServer(app);
    server.listen(0, () => {
      baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
  if (customerUserId) await db.delete(s.users).where(eq(s.users.id, customerUserId));
  if (managerUserId) await db.delete(s.users).where(eq(s.users.id, managerUserId));
  if (clerkUserId) await db.delete(s.users).where(eq(s.users.id, clerkUserId));
  if (accountantUserId) await db.delete(s.users).where(eq(s.users.id, accountantUserId));
  if (businessUnitId) await db.delete(s.businessUnits).where(eq(s.businessUnits.id, businessUnitId));
  if (customerId) await db.delete(s.customers).where(eq(s.customers.id, customerId));
  if (secondaryCustomerId) await db.delete(s.customers).where(eq(s.customers.id, secondaryCustomerId));
  await disconnectRedis();
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
    assert.equal(user.customerAccountType, CustomerAccountType.SINGLE_ENTITY);
  });

  test('rejects multiple links for a default customer account', async () => {
    await assert.rejects(
      createUser({
        username: `customer-multi-default-${suffix}`,
        password: 'admin123',
        role: Role.CUSTOMER,
        customerIds: [customerId, secondaryCustomerId],
      }),
      /chỉ được liên kết một pháp nhân/,
    );
  });

  test('allows explicit corporate or agency multi-entity accounts only under admin authority', async () => {
    await assert.rejects(
      createUser({
        username: `customer-multi-manager-${suffix}`,
        password: 'admin123',
        role: Role.CUSTOMER,
        customerAccountType: CustomerAccountType.CORPORATE_GROUP,
        customerIds: [customerId, secondaryCustomerId],
        assignmentAdminOnly: true,
      }),
      /Chỉ quản trị viên mới có thể cấp phạm vi khách hàng nhiều pháp nhân/,
    );

    const groupUser = await createUser({
      username: `customer-multi-admin-${suffix}`,
      password: 'admin123',
      role: Role.CUSTOMER,
      customerAccountType: CustomerAccountType.CORPORATE_GROUP,
      customerIds: [customerId, secondaryCustomerId],
      assignmentAdminOnly: false,
    });
    try {
      assert.equal(groupUser.customerAccountType, CustomerAccountType.CORPORATE_GROUP);
      assert.deepEqual(groupUser.customerIds, [customerId, secondaryCustomerId].sort((a, b) => a - b));
    } finally {
      await db.delete(s.users).where(eq(s.users.id, groupUser.id));
    }
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

  test('allows ADMIN to manage DRIVER payroll-unit links without auto-creating a driver master', async () => {
    const [secondaryUnit] = await db.insert(s.businessUnits).values({
      code: `DRV-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      name: `Driver payroll unit ${suffix}`,
      status: 'ACTIVE',
    }).returning({ id: s.businessUnits.id });

    const driver = await createUser({
      username: `driver-scoped-${suffix}`,
      password: 'admin123',
      role: Role.DRIVER,
      businessUnitIds: [businessUnitId],
      assignmentAdminOnly: false,
    });

    try {
      assert.deepEqual(driver.businessUnitIds, [businessUnitId]);
      const autoCreatedDriver = await db.select({ id: s.drivers.id }).from(s.drivers)
        .where(eq(s.drivers.userId, driver.id));
      assert.equal(autoCreatedDriver.length, 0);

      const updated = await updateUser(driver.id, {
        businessUnitIds: [secondaryUnit.id],
        assignmentAdminOnly: false,
      });
      assert.deepEqual(updated.businessUnitIds, [secondaryUnit.id]);
    } finally {
      await db.delete(s.userBusinessUnitLinks).where(eq(s.userBusinessUnitLinks.userId, driver.id));
      await db.delete(s.drivers).where(eq(s.drivers.userId, driver.id));
      await db.delete(s.users).where(eq(s.users.id, driver.id));
      await db.delete(s.businessUnits).where(eq(s.businessUnits.id, secondaryUnit.id));
    }
  });

  test('rejects non-admin DRIVER payroll-unit assignment mutations', async () => {
    await assert.rejects(
      createUser({
        username: `driver-non-admin-${suffix}`,
        password: 'admin123',
        role: Role.DRIVER,
        businessUnitIds: [businessUnitId],
        assignmentAdminOnly: true,
      }),
      /Chỉ quản trị viên mới có thể quản lý đơn vị tính lương của lái xe/,
    );
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

  test('rejects an explicit SINGLE_ENTITY update with multiple customer links', async () => {
    const user = await createUser({
      username: `customer-single-update-${suffix}`,
      password: 'admin123',
      role: Role.CUSTOMER,
      customerIds: [customerId],
    });

    try {
      await assert.rejects(
        updateUser(user.id, {
          customerAccountType: CustomerAccountType.SINGLE_ENTITY,
          customerIds: [customerId, secondaryCustomerId],
          assignmentAdminOnly: false,
        }),
        /Tài khoản khách hàng thông thường chỉ được liên kết một pháp nhân/,
      );

      const [persisted] = await db.select({
        customerAccountType: s.users.customerAccountType,
      }).from(s.users).where(eq(s.users.id, user.id)).limit(1);
      assert.equal(persisted?.customerAccountType, CustomerAccountType.SINGLE_ENTITY);
      const persistedLinks = await db.select({
        customerId: s.userCustomerLinks.customerId,
      }).from(s.userCustomerLinks).where(eq(s.userCustomerLinks.userId, user.id));
      assert.deepEqual(persistedLinks.map((link) => link.customerId), [customerId]);
    } finally {
      await db.delete(s.users).where(eq(s.users.id, user.id));
    }
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
    await updateUser(customerUserId, {
      customerAccountType: CustomerAccountType.CORPORATE_GROUP,
      customerIds: [customerId, secondaryCustomerId],
      assignmentAdminOnly: false,
    });
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
    await updateUser(customerUserId, {
      customerAccountType: CustomerAccountType.SINGLE_ENTITY,
      customerIds: [customerId],
      assignmentAdminOnly: false,
    });
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

  test('accepts current customer scope for CLERK and ACCOUNTANT tokens', async () => {
    const clerkToken = jwt.sign({
      userId: clerkUserId,
      username: `scoped-clerk-${suffix}`,
      role: Role.CLERK,
      customerId,
      customerIds: [customerId],
    }, config.jwtSecret);
    const accountantToken = jwt.sign({
      userId: accountantUserId,
      username: `accountant-scoped-${suffix}`,
      role: Role.ACCOUNTANT,
      customerId: secondaryCustomerId,
      customerIds: [secondaryCustomerId],
    }, config.jwtSecret);

    for (const [path, token, useQueryToken] of [
      ['/protected', clerkToken, false],
      ['/protected-asset', clerkToken, true],
      ['/protected', accountantToken, false],
    ] as const) {
      const url = useQueryToken
        ? `${baseUrl}${path}?token=${encodeURIComponent(token)}`
        : `${baseUrl}${path}`;
      const response = await fetch(url, {
        headers: useQueryToken ? undefined : { Authorization: `Bearer ${token}` },
      });
      assert.equal(response.status, 200, `${path} should accept the current scoped-role token`);
    }
  });

  test('tokens issued by the login route pass the first authenticated request for scoped roles', async () => {
    for (const identifier of [
      `scoped-clerk-${suffix}`,
      `accountant-scoped-${suffix}`,
    ]) {
      const login = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password: 'admin123' }),
      });
      assert.equal(login.status, 200, `${identifier} login should succeed`);
      const loginBody = await login.json() as { token: string };

      const me = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Authorization: `Bearer ${loginBody.token}` },
      });
      assert.equal(me.status, 200, `${identifier} first authenticated request should succeed`);
    }
  });

  test('rejects stale CLERK scope through API and asset query-token authentication', async () => {
    const token = jwt.sign({
      userId: clerkUserId,
      username: `scoped-clerk-${suffix}`,
      role: Role.CLERK,
      customerId,
      customerIds: [customerId],
    }, config.jwtSecret);

    await updateUser(clerkUserId, {
      customerIds: [secondaryCustomerId],
      businessUnitIds: [businessUnitId],
      assignmentAdminOnly: false,
    });
    for (const url of [
      `${baseUrl}/protected`,
      `${baseUrl}/protected-asset?token=${encodeURIComponent(token)}`,
    ]) {
      const response = await fetch(url, {
        headers: url.includes('?token=') ? undefined : { Authorization: `Bearer ${token}` },
      });
      assert.equal(response.status, 401);
    }
    await updateUser(clerkUserId, {
      customerIds: [customerId],
      businessUnitIds: [businessUnitId],
      assignmentAdminOnly: false,
    });
  });

  test('rejects a scoped ACCOUNTANT token immediately after its customer scope changes', async () => {
    const token = jwt.sign({
      userId: accountantUserId,
      username: `accountant-scoped-${suffix}`,
      role: Role.ACCOUNTANT,
      customerId: secondaryCustomerId,
      customerIds: [secondaryCustomerId],
    }, config.jwtSecret);

    await updateUser(accountantUserId, {
      customerIds: [customerId],
      assignmentAdminOnly: false,
    });
    const response = await fetch(`${baseUrl}/protected`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 401);
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

  test('soft-deleting a scoped user removes persisted customer-link rows', async () => {
    const user = await createUser({
      username: `customer-delete-links-${suffix}`,
      password: 'admin123',
      role: Role.CUSTOMER,
      customerIds: [customerId],
    });

    try {
      await deleteUser(user.id, user.id + 9_000_000);
      const [deleted] = await db.select({ deletedAt: s.users.deletedAt })
        .from(s.users)
        .where(eq(s.users.id, user.id))
        .limit(1);
      assert.ok(deleted?.deletedAt, 'user is soft-deleted');

      const links = await db.select({ customerId: s.userCustomerLinks.customerId })
        .from(s.userCustomerLinks)
        .where(eq(s.userCustomerLinks.userId, user.id));
      assert.deepEqual(links, []);
    } finally {
      await db.delete(s.users).where(eq(s.users.id, user.id));
    }
  });

  test('concurrent delete and scope change cannot leave stale customer-link rows', async () => {
    const user = await createUser({
      username: `customer-delete-race-${suffix}`,
      password: 'admin123',
      role: Role.CUSTOMER,
      customerIds: [customerId],
    });

    try {
      await Promise.allSettled([
        updateUser(user.id, { customerIds: [secondaryCustomerId] }),
        deleteUser(user.id, user.id + 9_100_000),
      ]);

      const [persisted] = await db.select({
        deletedAt: s.users.deletedAt,
        customerId: s.users.customerId,
      }).from(s.users)
        .where(eq(s.users.id, user.id))
        .limit(1);
      const links = await db.select({ customerId: s.userCustomerLinks.customerId })
        .from(s.userCustomerLinks)
        .where(eq(s.userCustomerLinks.userId, user.id));

      if (persisted?.deletedAt != null) {
        assert.equal(links.length, 0, 'soft-deleted user must not retain link rows');
      } else {
        assert.deepEqual(
          links.map((row) => row.customerId).sort((left, right) => left - right),
          persisted?.customerId == null ? [] : [persisted.customerId],
        );
      }
    } finally {
      await db.delete(s.userCustomerLinks).where(eq(s.userCustomerLinks.userId, user.id));
      await db.delete(s.users).where(eq(s.users.id, user.id));
    }
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
