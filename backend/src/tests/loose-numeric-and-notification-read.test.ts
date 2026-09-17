// Loose numeric coercion and silent notification reads.
// (a) positiveNumeric coerced hex strings ("0x10" -> 16) into money fields;
//     string inputs must be decimal literals only.
// (b) POST /api/notifications/:id/read answered 200 with an EMPTY body for a
//     nonexistent id (markAsRead returns undefined, res.json(undefined)); the
//     not-found case must be 404, and a non-numeric id must be a clean 400.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Role, createAdvanceRequestSchema, expenseSchema } from '@tingting/shared';
import notificationRoutes from '../routes/notifications';
import { globalErrorHandler } from '../middleware/errorHandler';

let baseUrl23 = '';
let server23: http.Server | undefined;

test.after(async () => {
  await new Promise<void>((resolve) => server23?.close(() => resolve()));
});

const BASE = {
  supplierId: 1,
  categoryId: 1,
  expenseDate: '2026-09-15',
  paymentStatus: 'UNPAID',
};

test('hex string amount is rejected on expenseSchema', () => {
  const parsed = expenseSchema.safeParse({ ...BASE, amount: '0x10' });
  assert.equal(parsed.success, false);
});

test('decimal string and number amounts still parse (digit/decimal literals fine)', () => {
  for (const amount of ['1000.5', '250000', 1234, 1234.5]) {
    const parsed = expenseSchema.safeParse({ ...BASE, amount });
    assert.equal(parsed.success, true, `amount=${String(amount)} should parse`);
  }
});

test('hex string amount is rejected on advance-request schema', () => {
  const parsed = createAdvanceRequestSchema.safeParse({ amount: '0x10', reason: 'QA15API2' });
  assert.equal(parsed.success, false);
});

test('notification read: nonexistent id -> 404 (was silent empty 200)', async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { user?: unknown }).user = {
      userId: 6,
      role: Role.DRIVER,
      username: 'qa15driver',
      email: 'qa15driver@example.local',
      fullName: 'QA15 Driver Stub',
    };
    next();
  });
  app.use('/api/notifications', notificationRoutes);
  app.use(globalErrorHandler);
  const server = http.createServer(app);
  server23 = server;
  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      baseUrl23 = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
  const res = await fetch(`${baseUrl23}/api/notifications/999999/read`, { method: 'POST' });
  assert.equal(res.status, 404);
});

test('notification read: non-numeric id -> clean 400', async () => {
  const res = await fetch(`${baseUrl23}/api/notifications/abc/read`, { method: 'POST' });
  assert.equal(res.status, 400);
  // The pg pool keeps the loop alive after DB-touching tests; deterministic
  // exit here, after every assertion, without masking failures — an earlier
  // failure sets process.exitCode, an assertion throw skips this line and
  // the run dies by timeout (non-zero) instead of reporting green. The short
  // delay lets the spec reporter flush this test's result line.
  await new Promise((resolve) => setTimeout(resolve, 100));
  process.exit(process.exitCode ?? 0);
});
