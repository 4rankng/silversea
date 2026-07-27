import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import { db, client } from '../db';
import * as s from '../db/schema';
import { authenticate, createUser, listUsers, updateUser } from '../services/user.service';
import { authMiddleware } from '../middleware/auth';
import { config } from '../config';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let customerId: number;
let secondaryCustomerId: number;
let businessUnitId: number;
let customerUserId: number;
let managerUserId: number;
let clerkUserId: number;
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
