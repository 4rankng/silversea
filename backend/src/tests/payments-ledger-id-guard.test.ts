// Red-first pin for the financial ledger statement routes onto shared
// parseId (§2.1): garbage supplier/carrier ids must be a client 400, never a
// NaN flowing into the statement queries as a 500.
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
import paymentsRoutes from '../routes/financial/payments.routes';
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
    username: 'pl-admin',
    email: null,
    fullName: null,
    role: Role.ADMIN,
    customerId: null,
    customerIds: [],
  }, config.jwtSecret);

  const app = express();
  app.use(express.json());
  app.use('/api/finance', authMiddleware, casbinAuthz('financial'), paymentsRoutes);
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

describe('financial ledger garbage-id guard (§2.1 parseId)', () => {
  test('supplier statement with a non-numeric id is a 400, not a 500', async () => {
    const response = await fetch(`${baseUrl}/api/finance/ledger/suppliers/abc/statement`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.match(String(body.error), /không hợp lệ/);
  });

  test('carrier statement with a non-numeric id is a 400, not a 500', async () => {
    const response = await fetch(`${baseUrl}/api/finance/ledger/carriers/abc/statement`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.match(String(body.error), /không hợp lệ/);
  });
});
