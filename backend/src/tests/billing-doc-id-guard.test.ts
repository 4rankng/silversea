// Red-first pin for the billing-documents domain onto shared parseId (§2.1):
// garbage :id must be a client 400, never a NaN reaching the billing service.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';

import { Role } from '@tingting/shared';
import { config } from '../config';
import { initEnforcer } from '../casbin/enforcer';
import { initAuditService } from '../services/audit.service';
import billingDocumentsRoutes from '../routes/financial/billing-documents.routes';
import { authMiddleware } from '../middleware/auth';
import { casbinAuthz } from '../middleware/casbin';
import { globalErrorHandler } from '../middleware/errorHandler';

let server: http.Server;
let baseUrl = '';
let token = '';

before(async () => {
  await initEnforcer();
  await initAuditService();

  token = jwt.sign({
    userId: 1,
    username: 'bd-admin',
    email: null,
    fullName: null,
    role: Role.ADMIN,
    customerId: null,
    customerIds: [],
  }, config.jwtSecret);

  const app = express();
  app.use(express.json());
  app.use('/api', authMiddleware, casbinAuthz('financial'), billingDocumentsRoutes);
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

describe('billing-documents garbage-id guard (§2.1 parseId)', () => {
  test('GET with a non-numeric document id is a 400, not a 500', async () => {
    const response = await fetch(`${baseUrl}/api/finance/billing-documents/abc`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.match(String(body.error), /không hợp lệ/);
  });
});
