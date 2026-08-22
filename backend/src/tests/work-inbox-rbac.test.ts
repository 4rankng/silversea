import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { Role } from '@tingting/shared';
import { dashboardWorkInboxRouter, financialWorkInboxRouter, systemWorkInboxRouter } from '../routes/work-inbox';
import { globalErrorHandler } from '../middleware/errorHandler';

let server: http.Server;
let baseUrl = '';

before(async () => {
  const app = express();
  app.use((req, _res, next) => {
    const role = String(req.header('X-Test-Role') ?? Role.DRIVER) as Role;
    req.user = { userId: 1, username: `inbox-${role}`, email: null, fullName: null, role };
    next();
  });
  app.use('/financial', financialWorkInboxRouter);
  app.use('/dashboard', dashboardWorkInboxRouter);
  app.use('/system', systemWorkInboxRouter);
  app.use(globalErrorHandler);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

describe('work inbox RBAC', () => {
  test('driver cannot load financial, manager-decision, or Admin health inboxes', async () => {
    for (const path of ['/financial/work-inbox', '/dashboard/decision-inbox', '/system/admin-health']) {
      const response = await fetch(`${baseUrl}${path}`, { headers: { 'X-Test-Role': Role.DRIVER } });
      assert.equal(response.status, 403, path);
      assert.deepEqual(await response.json(), { error: 'Không có quyền truy cập' });
    }
  });

  test('Manager cannot load Admin health', async () => {
    const response = await fetch(`${baseUrl}/system/admin-health`, { headers: { 'X-Test-Role': Role.MANAGER } });
    assert.equal(response.status, 403);
  });

  test('Driver cannot resolve a customer delivery dispute', async () => {
    const response = await fetch(`${baseUrl}/dashboard/delivery-disputes/1/resolve`, {
      method: 'POST',
      headers: { 'X-Test-Role': Role.DRIVER, 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolution: 'Không có quyền' }),
    });
    assert.equal(response.status, 403);
  });
});

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});
