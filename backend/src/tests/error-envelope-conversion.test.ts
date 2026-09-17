// Verification pass (lead-assigned) for the 22-site error conversion:
// per-file byte-checks that the converted res.status().json() literals now
// thrown as ApiError produce the IDENTICAL envelope — same status, same
// { error: message } body, byte-for-byte on the probes below.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';

import { client } from '../db';
import { disconnectRedis } from '../lib/redis';
import { Role } from '@tingting/shared';
import expenseRoutes from '../routes/expense';
import { coreRoutes } from '../routes/shipments/core.routes';
import { globalErrorHandler } from '../middleware/errorHandler';

let server: http.Server;
let baseUrl = '';

before(async () => {
  const app = express();
  app.use(express.json());
  const injectUser = (role: Role) => (req: unknown, _res: unknown, next: () => void) => {
    (req as { user: unknown }).user = {
      userId: 1, username: 'verify', email: null, fullName: null,
      role, customerId: null, customerIds: [],
    };
    next();
  };
  app.use('/api/expenses', injectUser(Role.OPS), expenseRoutes);
  app.use('/api/shipments', injectUser(Role.MANAGER), coreRoutes);
  app.use(globalErrorHandler);
  await new Promise<void>((resolve) => {
    server = http.createServer(app);
    server.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await disconnectRedis();
  await client.end();
});

async function probe(path: string): Promise<{ status: number; body: object }> {
  const response = await fetch(`${baseUrl}${path}`);
  return { status: response.status, body: await response.json() };
}

describe('error-envelope byte-checks — converted sites (§2.2 pass)', () => {
  test('expense garbage id → 400 {error:"ID không hợp lệ"} byte-identical', async () => {
    const { status, body } = await probe('/api/expenses/abc');
    assert.equal(status, 400);
    assert.equal(JSON.stringify(body), JSON.stringify({ error: 'ID không hợp lệ' }));
  });

  test('expense missing id → 404 {error:"Không tìm thấy khoản chi phí"} byte-identical', async () => {
    const { status, body } = await probe('/api/expenses/999999999');
    assert.equal(status, 404);
    assert.equal(JSON.stringify(body), JSON.stringify({ error: 'Không tìm thấy khoản chi phí' }));
  });

  test('shipments bad dateFrom → 400 {error:"dateFrom không hợp lệ"} byte-identical', async () => {
    const { status, body } = await probe('/api/shipments?dateFrom=not-a-date');
    assert.equal(status, 400);
    assert.equal(JSON.stringify(body), JSON.stringify({ error: 'dateFrom không hợp lệ' }));
  });

  test('shipments oversized B/L → 400 {error:"Số B/L không được vượt quá 50 ký tự"} byte-identical', async () => {
    const long = 'B'.repeat(51);
    const { status, body } = await probe(`/api/shipments?blNumber=${long}`);
    assert.equal(status, 400);
    assert.equal(JSON.stringify(body), JSON.stringify({ error: 'Số B/L không được vượt quá 50 ký tự' }));
  });
});
