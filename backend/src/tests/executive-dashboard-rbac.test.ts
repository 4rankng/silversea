import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { Role } from '@tingting/shared';
import reportsRoutes from '../routes/financial/reports.routes';
import { globalErrorHandler } from '../middleware/errorHandler';

let server: http.Server;
let baseUrl = '';

before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', (req, _res, next) => {
    const role = String(req.header('X-Test-Role') ?? Role.ACCOUNTANT) as Role;
    req.user = {
      userId: 1,
      username: `dashboard-${role.toLowerCase()}`,
      email: null,
      fullName: null,
      role,
    };
    next();
  });
  app.use('/api', reportsRoutes);
  app.use(globalErrorHandler);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

describe('executive dashboard route authority', () => {
  for (const role of [Role.ACCOUNTANT, Role.CLERK, Role.CUSTOMER, Role.DRIVER, Role.FORWARDER]) {
    test(`denies ${role} before loading executive financial data`, async () => {
      const response = await fetch(`${baseUrl}/api/reports/dashboard`, {
        headers: { 'X-Test-Role': role },
      });
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), { error: 'Không có quyền truy cập' });
    });
  }
});
