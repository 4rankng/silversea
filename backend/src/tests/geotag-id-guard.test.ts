// Red-first pin for the shared parseId migration (backend refactor §2.1):
// a garbage :entityId must be a client 400, never a NaN flowing into the
// ownership query as a 500.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';

import * as s from '../db/schema';
import { Role } from '@tingting/shared';
import { config } from '../config';
import { initEnforcer } from '../casbin/enforcer';
import { initAuditService } from '../services/audit.service';
import geotagRoutes from '../routes/geotag';
import { authMiddleware } from '../middleware/auth';
import { casbinAuthz } from '../middleware/casbin';
import { globalErrorHandler } from '../middleware/errorHandler';
import { db } from '../db';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let server: http.Server;
let baseUrl = '';
let token = '';

before(async () => {
  await initEnforcer();
  await initAuditService();

  const [user] = await db.insert(s.users).values({
    username: `gid-${suffix}`,
    passwordHash: 'x',
    role: Role.DRIVER,
    status: 'ACTIVE',
  }).returning();
  token = jwt.sign({
    userId: user.id,
    username: user.username ?? `user-${user.id}`,
    email: null,
    fullName: null,
    role: Role.DRIVER,
    customerId: null,
    customerIds: [],
  }, config.jwtSecret);

  const app = express();
  app.use(express.json());
  app.use('/api/geotag', authMiddleware, casbinAuthz('driver_portal'), geotagRoutes);
  app.use(globalErrorHandler);
  await new Promise<void>((resolve) => {
    server = http.createServer(app);
    server.listen(0, () => {
      baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

after(() => {
  setImmediate(() => process.exit(0));
});

describe('geotag route garbage-id guard (§2.1 parseId)', () => {
  test('GET with a non-numeric entityId is a 400, not a 500', async () => {
    const response = await fetch(`${baseUrl}/api/geotag/trip_photo/abc`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.match(String(body.error), /không hợp lệ/);
  });
});
