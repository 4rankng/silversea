import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import { db, client } from '../db';
import * as s from '../db/schema';
import { config } from '../config';
import { initEnforcer } from '../casbin/enforcer';
import { disconnectRedis } from '../lib/redis';
import { authMiddleware } from '../middleware/auth';
import { casbinAuthz } from '../middleware/casbin';
import { globalErrorHandler } from '../middleware/errorHandler';
import configRoutes from '../routes/config';

const key = `FIX17-TAX-${crypto.randomUUID()}`;
let server: http.Server;
let baseUrl: string;
let token: string;
let actorId: number;
let customer: typeof s.customers.$inferSelect;
let supplier: typeof s.suppliers.$inferSelect;
before(async () => {
  await initEnforcer();
  const [actor] = await db.insert(s.users).values({ username: key, passwordHash: 'test fixture', role: Role.ADMIN }).returning();
  actorId = actor.id;
  token = jwt.sign({ userId: actor.id, username: key, role: Role.ADMIN, customerId: null, customerIds: [] }, config.jwtSecret);
  [customer] = await db.insert(s.customers).values({ name: key, taxCode: '1234567890' }).returning();
  [supplier] = await db.insert(s.suppliers).values({ name: key, taxCode: '1234567890' }).returning();
  const app = express();
  app.use(express.json());
  app.use('/api', authMiddleware, casbinAuthz('config'), configRoutes);
  app.use(globalErrorHandler);
  server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
after(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  if (customer) await db.delete(s.customers).where(eq(s.customers.id, customer.id));
  if (supplier) await db.delete(s.suppliers).where(eq(s.suppliers.id, supplier.id));
  if (actorId) await db.delete(s.users).where(eq(s.users.id, actorId));
  await disconnectRedis();
  await client.end();
});
for (const resource of ['customers', 'suppliers'] as const) {
  for (const method of ['POST', 'PUT'] as const) {
    test(`${resource} ${method}: oversized tax code returns field validation and writes nothing`, async () => {
      const row = resource === 'customers' ? customer : supplier;
      const res = await fetch(`${baseUrl}/${resource}${method === 'PUT' ? `/${row.id}` : ''}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID(), ...(method === 'PUT' ? { 'If-Unmodified-Since': row.updatedAt.toISOString() } : {}) },
        body: JSON.stringify({ name: key, taxCode: '1'.repeat(21) }),
      });
      const body = await res.json();
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.match(body.error, /20/);
      assert.deepEqual(body.details[0].path, ['taxCode']);
      const table = resource === 'customers' ? s.customers : s.suppliers;
      const saved = await db.select({ taxCode: table.taxCode }).from(table).where(eq(table.name, key));
      assert.deepEqual(saved, [{ taxCode: '1234567890' }]);
    });
  }
}
