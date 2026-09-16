// Red-first pin for the master-data-import domain onto shared parseId (§2.1):
// a garbage batch :id must be a client 400, never a NaN reaching
// getMasterImportBatch as a 500. ADMIN-only router (requireRoles inside).
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
import masterImportRoutes from '../routes/config/master-data-import.routes';
import { authMiddleware } from '../middleware/auth';
import { globalErrorHandler } from '../middleware/errorHandler';

let server: http.Server;
let baseUrl = '';
let token = '';

before(async () => {
  await initEnforcer();
  await initAuditService();

  token = jwt.sign({
    userId: 1,
    username: 'mi-admin',
    email: null,
    fullName: null,
    role: Role.ADMIN,
    customerId: null,
    customerIds: [],
  }, config.jwtSecret);

  const app = express();
  app.use(express.json());
  app.use('/api/config/master-data-imports', authMiddleware, masterImportRoutes);
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

describe('master-data-import garbage-id guard (§2.1 parseId)', () => {
  test('GET with a non-numeric batch id is a 400, not a 500', async () => {
    const response = await fetch(`${baseUrl}/api/config/master-data-imports/abc`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.match(String(body.error), /không hợp lệ/);
  });
});
