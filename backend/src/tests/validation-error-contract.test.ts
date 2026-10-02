// Validation-error contract: `details` must be a structured issue array, never a
// stringified-objects blob, and the top-level `error` string must be free of
// internal field paths — it is what a user reads in a banner (see the
// 2026-09-18 leak report). Field locations belong to `details` alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Role, createShipmentSchema } from '@tingting/shared';
import { ApiError } from '../errors';
import { throwValidation } from '../lib/validation';
import driverRoutes from '../routes/driver';
import { globalErrorHandler } from '../middleware/errorHandler';

let server: http.Server | undefined;
let baseUrl = '';

test.after(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

test('throwValidation carries structured issue details, not a stringified blob', () => {
  const parsed = createShipmentSchema.safeParse({ cargoWeightKg: -5 });
  assert.equal(parsed.success, false);
  if (parsed.success) return;
  let err: unknown;
  try {
    throwValidation(parsed.error);
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof ApiError);
  const apiErr = err as ApiError;
  assert.equal(apiErr.statusCode, 400);
  // Top-level user-facing message: the issue message alone — no field path.
  assert.equal(apiErr.message, 'Trọng lượng phải là số không âm hợp lệ');
  assert.equal(apiErr.message.includes('cargoWeightKg'), false);
  assert.ok(Array.isArray(apiErr.details), 'details must be a structured array');
  const details = apiErr.details as Array<{ message: string; path: Array<string | number> }>;
  assert.ok(details.length >= 1);
  for (const d of details) {
    assert.equal(typeof d.message, 'string');
    assert.ok(Array.isArray(d.path));
  }
  assert.equal(details[0].path[0], 'cargoWeightKg');
});

test('driver progress route returns structured details with field paths', async () => {
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
  app.use('/api/driver/me', driverRoutes);
  app.use(globalErrorHandler);
  await new Promise<void>((resolve) => {
    const srv = http.createServer(app);
    server = srv;
    srv.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
      resolve();
    });
  });
  const res = await fetch(`${baseUrl}/api/driver/me/fulfillments/999999/progress`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 400);
  const body = (await res.json()) as {
    error: string;
    details: Array<{ message: string; path: Array<string | number> }>;
  };
  // The path lives in `details`, never in the sentence a user reads.
  assert.ok(!body.error.includes('(eventType)'), `top message must not carry a field path, got: ${body.error}`);
  assert.ok(Array.isArray(body.details), 'details must be a structured array');
  assert.ok(
    body.details.some((d) => Array.isArray(d.path) && d.path[0] === 'expectedVersion'),
    'expectedVersion issue must carry its field path',
  );
  assert.ok(!JSON.stringify(body).includes('[object Object]'), 'no stringified-object blob');
});
