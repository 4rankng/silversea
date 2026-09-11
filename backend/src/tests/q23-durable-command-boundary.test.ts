import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { desc, eq, inArray } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import { client, db } from '../db';
import * as s from '../db/schema';
import { auditLogMiddleware } from '../middleware/audit';
import { globalErrorHandler } from '../middleware/errorHandler';
import { ApiError } from '../errors';
import { disconnectRedis } from '../lib/redis';
import { getMaterialWriteContext, matchDeclaredMaterialWrite } from '../middleware/material-write';
import {
  IDEMPOTENCY_ENDPOINTS,
  hashPayload,
  runIdempotent,
} from '../services/idempotency.service';
import {
  setAuditEnrichmentHandlerForTest,
  setAuditPersistHandlerForTest,
} from '../services/audit.service';

const idempotencyKeys: string[] = [];
const auditLogIds: number[] = [];

let server: http.Server;
let baseUrl = '';
let createCalls = 0;
let nextResultId = 1;
let primaryUserId = 0;
let secondaryUserId = 0;

async function waitForAuditCount(expectedCount: number) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const rows = await db.select().from(s.auditLogs)
      .where(eq(s.auditLogs.actorName, 'Q23 Boundary'))
      .orderBy(desc(s.auditLogs.id))
      .limit(20);
    if (rows.length >= expectedCount) {
      for (const row of rows) {
        if (!auditLogIds.includes(row.id)) auditLogIds.push(row.id);
      }
      return rows;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return [] as Array<typeof s.auditLogs.$inferSelect>;
}

async function requestJson(path: string, options: {
  body?: Record<string, unknown>;
  idempotencyKey?: string;
  actorUserId?: number;
} = {}) {
  const payload = options.body ? JSON.stringify(options.body) : '';
  const headers: Record<string, string> = {
    Connection: 'close',
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload).toString(),
  };
  if (options.idempotencyKey) {
    headers['Idempotency-Key'] = options.idempotencyKey;
    if (!idempotencyKeys.includes(options.idempotencyKey)) {
      idempotencyKeys.push(options.idempotencyKey);
    }
  }
  if (options.actorUserId !== undefined) {
    headers['x-user-id'] = String(options.actorUserId);
  }

  return new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: Number(new URL(baseUrl).port),
      path,
      method: 'POST',
      agent: false,
      headers,
    }, (response) => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        raw += chunk;
      });
      response.on('end', () => {
        try {
          resolve({
            status: response.statusCode ?? 0,
            body: raw ? JSON.parse(raw) as Record<string, unknown> : {},
          });
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

beforeEach(() => {
  createCalls = 0;
  nextResultId = 1;
  setAuditPersistHandlerForTest(null);
  setAuditEnrichmentHandlerForTest(async () => {
    throw new Error('simulated secondary enrichment failure');
  });
});

before(async () => {
  const [primaryUser] = await db.insert(s.users).values({
    username: `q23-boundary-primary-${Date.now()}`,
    passwordHash: 'x',
    role: Role.MANAGER,
    status: 'ACTIVE',
  }).returning({ id: s.users.id });
  primaryUserId = primaryUser.id;
  const [secondaryUser] = await db.insert(s.users).values({
    username: `q23-boundary-secondary-${Date.now()}`,
    passwordHash: 'x',
    role: Role.MANAGER,
    status: 'ACTIVE',
  }).returning({ id: s.users.id });
  secondaryUserId = secondaryUser.id;

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const actorUserId = Number(req.header('x-user-id')) || primaryUserId;
    req.user = {
      userId: actorUserId,
      username: 'q23-boundary',
      email: 'q23-boundary@example.com',
      fullName: 'Q23 Boundary',
      role: Role.MANAGER,
    };
    next();
  });
  app.use(auditLogMiddleware);
  app.post('/api/payments/receive', async (req, res, next) => {
    try {
      if (req.body.mode === 'forbidden') {
        res.status(403).json({ error: 'Không có quyền' });
        return;
      }
      if (req.body.mode === 'rejected') {
        throw new ApiError(422, 'Dữ liệu không hợp lệ');
      }
      const context = getMaterialWriteContext(req);
      const outcome = await runIdempotent({
        endpoint: context?.endpoint ?? IDEMPOTENCY_ENDPOINTS.PAYMENTS_RECEIVE,
        idempotencyKey: context?.idempotencyKey,
        payload: req.body,
        createdBy: req.user?.userId,
        responseStatusCode: 201,
        create: async () => {
          createCalls += 1;
          if (req.body.mode === 'slow') {
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          return {
            id: nextResultId,
            receiptId: `BOUNDARY-${nextResultId++}`,
            amount: req.body.amount,
          };
        },
      });
      res.locals.auditEntityId = Number(outcome.result.id);
      res.status(outcome.statusCode).json({ ...outcome.result, replayed: outcome.replayed });
    } catch (error) {
      next(error);
    }
  });
  app.use(globalErrorHandler);
  server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

describe('Q23 durable command boundary', () => {
  test('rejects a missing key before declared material route logic executes', async () => {
    const response = await requestJson('/api/payments/receive', {
      body: { amount: 1000 },
    });

    assert.equal(response.status, 400);
    assert.match(String(response.body.error ?? ''), /Idempotency-Key/);
    assert.equal(createCalls, 0);

    const rows = await waitForAuditCount(1);
    assert.equal(rows.length >= 1, true);
    const payload = rows[0]?.payload as Record<string, unknown>;
    assert.equal(payload.outcome, 'REJECTED');
    assert.equal(payload.statusCode, 400);
    assert.equal(payload.materialWriteEndpoint, IDEMPOTENCY_ENDPOINTS.PAYMENTS_RECEIVE);
  });

  test('replays exact commands, rejects payload drift, serializes concurrency, and persists durable audit outcomes', async () => {
    const successKey = 'q23-boundary-success';
    const replayA = await requestJson('/api/payments/receive', {
      idempotencyKey: successKey,
      body: { amount: 1000, note: 'A' },
    });
    const replayB = await requestJson('/api/payments/receive', {
      idempotencyKey: successKey,
      body: { amount: 1000, note: 'A' },
    });

    assert.equal(replayA.status, 201);
    assert.equal(replayB.status, 201);
    assert.equal(replayA.body.replayed, false);
    assert.equal(replayB.body.replayed, true);
    assert.equal(replayA.body.id, replayB.body.id);

    const conflictKey = 'q23-boundary-conflict';
    const firstConflict = await requestJson('/api/payments/receive', {
      idempotencyKey: conflictKey,
      body: { amount: 2000, note: 'first' },
    });
    const secondConflict = await requestJson('/api/payments/receive', {
      idempotencyKey: conflictKey,
      body: { amount: 3000, note: 'second' },
    });
    assert.equal(firstConflict.status, 201);
    assert.equal(secondConflict.status, 409);

    const crossActor = await requestJson('/api/payments/receive', {
      idempotencyKey: successKey,
      actorUserId: secondaryUserId,
      body: { amount: 1000, note: 'A' },
    });
    assert.equal(crossActor.status, 409);
    assert.match(String(crossActor.body.error ?? ''), /người thực hiện khác/i);

    const forbidden = await requestJson('/api/payments/receive', {
      idempotencyKey: 'q23-boundary-forbidden',
      body: { amount: 4000, mode: 'forbidden' },
    });
    assert.equal(forbidden.status, 403);

    const rejected = await requestJson('/api/payments/receive', {
      idempotencyKey: 'q23-boundary-rejected',
      body: { amount: 5000, mode: 'rejected' },
    });
    assert.equal(rejected.status, 422);

    const concurrentKey = 'q23-boundary-concurrent';
    const concurrent = await Promise.all([
      requestJson('/api/payments/receive', {
        idempotencyKey: concurrentKey,
        body: { amount: 6000, mode: 'slow' },
      }),
      requestJson('/api/payments/receive', {
        idempotencyKey: concurrentKey,
        body: { amount: 6000, mode: 'slow' },
      }),
    ]);
    assert.deepEqual(
      concurrent.map((item) => item.body.replayed).sort(),
      [false, true],
    );
    assert.equal(createCalls, 3);

    const rows = await waitForAuditCount(8);
    const payloads = rows.map((row) => row.payload as Record<string, unknown>);
    const outcomes = payloads.map((payload) => String(payload.outcome));
    assert.equal(outcomes.includes('SUCCEEDED'), true);
    assert.equal(outcomes.includes('REPLAYED'), true);
    assert.equal(outcomes.includes('FORBIDDEN'), true);
    assert.equal(outcomes.includes('CONFLICT'), true);
    assert.equal(outcomes.includes('REJECTED'), true);
  });

  test('fails closed when audit persistence cannot record a declared material write', async () => {
    setAuditPersistHandlerForTest(async () => {
      throw new Error('simulated audit insert failure');
    });

    const response = await requestJson('/api/payments/receive', {
      idempotencyKey: 'q23-boundary-audit-fail-closed',
      body: { amount: 7777 },
    });

    assert.equal(response.status, 500, JSON.stringify(response.body));
    assert.match(String(response.body.error ?? ''), /ghi nhật ký thao tác/i);
    const rows = await db.select().from(s.idempotencyKeys)
      .where(eq(s.idempotencyKeys.idempotencyKey, 'q23-boundary-audit-fail-closed'));
    assert.equal(rows.length, 0);
  });

  test('rejects replay of legacy null-owner keys for authenticated material writes', async () => {
    const legacyKey = 'q23-boundary-legacy-null-owner';
    idempotencyKeys.push(legacyKey);
    const payload = { amount: 1234, note: 'legacy-null-owner' };
    await db.insert(s.idempotencyKeys).values({
      endpoint: IDEMPOTENCY_ENDPOINTS.PAYMENTS_RECEIVE,
      idempotencyKey: legacyKey,
      entityType: 'payments',
      entityId: 91,
      payloadHash: hashPayload(payload),
      responseStatusCode: 201,
      responseSnapshot: {
        id: 91,
        receiptId: 'LEGACY-91',
        amount: 1234,
      },
      createdBy: null,
    });

    const response = await requestJson('/api/payments/receive', {
      idempotencyKey: legacyKey,
      actorUserId: primaryUserId,
      body: payload,
    });

    assert.equal(response.status, 409, JSON.stringify(response.body));
    assert.match(String(response.body.error ?? ''), /người thực hiện khác/i);
  });

  test('declares the integrated Q23 material-write routes in the centralized registry', () => {
    const samples = [
      ['POST', '/api/upload', IDEMPOTENCY_ENDPOINTS.UPLOAD_TRIP_PHOTO],
      ['POST', '/api/upload/company-logo', IDEMPOTENCY_ENDPOINTS.UPLOAD_COMPANY_LOGO],
      ['POST', '/api/upload/trips/1/photos/container/delete', IDEMPOTENCY_ENDPOINTS.UPLOAD_TRIP_PHOTO_DELETE],
      ['POST', '/api/ocr', IDEMPOTENCY_ENDPOINTS.OCR_CAPTURE],
      ['POST', '/api/ocr/persist-only', IDEMPOTENCY_ENDPOINTS.OCR_PERSIST_ONLY],
      ['POST', '/api/expenses', 'expenses.governed-create'],
      ['PUT', '/api/expenses/1', 'expenses.governed-update'],
      ['DELETE', '/api/expenses/1', 'expenses.governed-delete'],
      ['POST', '/api/expenses/1/photos', IDEMPOTENCY_ENDPOINTS.EXPENSE_PHOTO_CREATE],
      ['DELETE', '/api/expenses/1/photos/9', IDEMPOTENCY_ENDPOINTS.EXPENSE_PHOTO_DELETE],
      ['PATCH', '/api/driver/me/trips/1/containers/2', 'driver.containers.update'],
      ['PUT', '/api/driver/me/trips/1/containers/2/seals', 'driver.containers.seals.replace'],
      ['DELETE', '/api/driver/me/trips/1/photos/container', 'driver.trip-photos.delete'],
      ['POST', '/api/forwarder/me/trips/1/containers', 'forwarder.containers.create'],
      ['POST', '/api/forwarder/me/expenses', 'forwarder.expenses.create'],
      ['PATCH', '/api/forwarder/me/expenses/1', 'forwarder.expenses.update'],
      ['DELETE', '/api/forwarder/me/expenses/1', 'forwarder.expenses.delete'],
      ['PUT', '/api/forwarder/me/trips/1/expense-completion', 'forwarder.expense-completion.update'],
      ['POST', '/api/forwarder/me/advance-requests', 'forwarder.advance-requests.create'],
      ['POST', '/api/forwarder/me/advance-settlements', 'forwarder.advance-settlements.create'],
      ['POST', '/api/forwarder/me/expenses/1/photos', 'forwarder.expense-photos.create'],
      ['DELETE', '/api/forwarder/me/expense-photos/9', 'forwarder.expense-photos.delete'],
      ['POST', '/api/forwarder/me/shipments/1/order-exchange/start', 'forwarder.order-exchange.start'],
      ['POST', '/api/forwarder/me/shipments/1/order-exchange/complete', 'forwarder.order-exchange.complete'],
      ['POST', '/api/forwarder/me/trips/1/paper-order-collection', 'forwarder.paper-order.collection'],
      ['POST', '/api/fleet/tires/1/install', 'config.tires.install'],
      ['PUT', '/api/road-config', 'config.road-config.update'],
      ['PUT', '/api/fuel-config', 'config.fuel-config.update'],
      ['PUT', '/api/company-info', 'config.company-info.update'],
      ['POST', '/api/finance/credit-overrides', 'credit-overrides.create'],
      ['POST', '/api/advance-requests/1/reject', 'advance-requests.reject'],
      ['POST', '/api/advance-settlements/1/reversal', 'advance-settlements.reverse'],
      ['PUT', '/api/finance/fuel-invoices/1', 'fuel-invoices.update'],
      ['POST', '/api/salary/periods/2026-07/issue', 'salary-periods.issue'],
      ['POST', '/api/admin/gps/backfill', 'gps.backfill'],
    ] as const;

    for (const [method, path, endpoint] of samples) {
      const match = matchDeclaredMaterialWrite(method, path);
      assert.equal(match?.endpoint, endpoint, `${method} ${path}`);
    }
  });
});

after(async () => {
  setAuditEnrichmentHandlerForTest(null);
  setAuditPersistHandlerForTest(null);
  server.closeAllConnections();
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  if (idempotencyKeys.length > 0) {
    await db.delete(s.idempotencyKeys)
      .where(inArray(s.idempotencyKeys.idempotencyKey, idempotencyKeys));
  }
  if (auditLogIds.length > 0) {
    await db.delete(s.auditLogs)
      .where(inArray(s.auditLogs.id, auditLogIds));
  }
  if (secondaryUserId > 0) {
    await db.delete(s.users).where(eq(s.users.id, secondaryUserId));
  }
  if (primaryUserId > 0) {
    await db.delete(s.users).where(eq(s.users.id, primaryUserId));
  }
  await disconnectRedis();
  await client.end();
});
