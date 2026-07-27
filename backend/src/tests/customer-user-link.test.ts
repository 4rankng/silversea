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
import { createUser, updateUser } from '../services/user.service';
import { authMiddleware } from '../middleware/auth';
import { config } from '../config';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let customerId: number;
let customerUserId: number;
let managerUserId: number;
let server: http.Server;
let baseUrl: string;

before(async () => {
  const [customer] = await db.insert(s.customers)
    .values({ name: `Customer account link ${suffix}` })
    .returning({ id: s.customers.id });
  customerId = customer.id;

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
  if (customerId) await db.delete(s.customers).where(eq(s.customers.id, customerId));
  await client.end();
});

describe('customer account linkage', () => {
  test('creates a CUSTOMER user linked to an existing customer', async () => {
    const user = await createUser({
      username: `customer-linked-${suffix}`,
      password: 'admin123',
      role: Role.CUSTOMER,
      customerId,
    });
    customerUserId = user.id;
    assert.equal(user.customerId, customerId);
  });

  test('rejects a customer link on a non-CUSTOMER role', async () => {
    await assert.rejects(
      createUser({
        username: `manager-invalid-link-${suffix}`,
        password: 'admin123',
        role: Role.MANAGER,
        customerId,
      }),
      /Chỉ tài khoản khách hàng/,
    );
  });

  test('rejects a token immediately after its customer scope changes', async () => {
    const token = jwt.sign({
      userId: customerUserId,
      username: `customer-linked-${suffix}`,
      role: Role.CUSTOMER,
      customerId,
    }, config.jwtSecret);

    await updateUser(customerUserId, { customerId: null });
    const response = await fetch(`${baseUrl}/protected`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 401);
    await updateUser(customerUserId, { customerId });
  });

  test('concurrent role and customer-link changes cannot leave an invalid combination', async () => {
    await Promise.allSettled([
      updateUser(customerUserId, { role: Role.MANAGER }),
      updateUser(customerUserId, { customerId }),
    ]);
    const [persisted] = await db.select({
      role: s.users.role,
      customerId: s.users.customerId,
    }).from(s.users).where(eq(s.users.id, customerUserId)).limit(1);
    assert.equal(persisted.role, Role.MANAGER);
    assert.equal(persisted.customerId, null);

    const updated = await updateUser(customerUserId, { role: Role.MANAGER });
    assert.equal(updated.role, Role.MANAGER);
    assert.equal(updated.customerId, null);
    managerUserId = customerUserId;
    customerUserId = 0;
  });

  test('rejects a link to a missing customer', async () => {
    await assert.rejects(
      updateUser(managerUserId, { role: Role.CUSTOMER, customerId: 2_147_483_647 }),
      /Khách hàng liên kết không tồn tại/,
    );
  });
});
