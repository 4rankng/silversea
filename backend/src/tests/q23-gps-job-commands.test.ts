import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, afterEach, before, describe, it } from 'node:test';
import express from 'express';
import { eq, inArray } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import { client, db } from '../db';
import * as s from '../db/schema';
import { disconnectRedis } from '../lib/redis';
import { createAdminGpsRouter, type AdminGpsDeps } from '../routes/admin-gps';
import { globalErrorHandler } from '../middleware/errorHandler';
import { hashPayload } from '../services/idempotency.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const idempotencyKeys: string[] = [];

let adminUserId = 0;
let server: http.Server;
let baseUrl = '';

async function closeActiveServer() {
  if (!server || !server.listening) return;
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

before(async () => {
  const [admin] = await db.insert(s.users).values({
    username: `q23-gps-admin-${suffix}`,
    passwordHash: 'x',
    role: Role.ADMIN,
    status: 'ACTIVE',
  }).returning({ id: s.users.id });
  adminUserId = admin.id;
});

after(async () => {
  await closeActiveServer();
  if (idempotencyKeys.length > 0) {
    await db.delete(s.idempotencyKeys)
      .where(inArray(s.idempotencyKeys.idempotencyKey, [...new Set(idempotencyKeys)]));
  }
  if (adminUserId > 0) {
    await db.delete(s.users).where(eq(s.users.id, adminUserId));
  }
  await disconnectRedis();
  await client.end();
});

afterEach(async () => {
  await closeActiveServer();
});

async function request(
  path: string,
  body: Record<string, unknown>,
  key?: string,
) {
  if (key) idempotencyKeys.push(key);
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

describe('Q23 GPS job commands', () => {
  it('returns pending for concurrent same-key backfill, replays success, and rejects payload drift', async () => {
    let releaseTrip: (() => void) | null = null;
    const deps: AdminGpsDeps = {
      selectBackfillTripIds: async () => ({ tripIds: [101], truncated: false }),
      captureAndDeriveTripGps: async (tripId) => {
        await new Promise<void>((resolve) => {
          releaseTrip = resolve;
        });
        return {
          tripId,
          status: 'ok',
          pointCount: 12,
          legsDerived: 2,
          legsTotal: 2,
        };
      },
    };

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = {
        userId: adminUserId,
        username: `q23-gps-admin-${suffix}`,
        email: null,
        fullName: null,
        role: Role.ADMIN,
      };
      next();
    });
    app.use('/api/admin/gps', createAdminGpsRouter(deps));
    app.use(globalErrorHandler);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const key = `q23-gps-backfill-${suffix}`;
    const firstPromise = request('/api/admin/gps/backfill', { tripIds: [101] }, key);
    for (let attempt = 0; attempt < 50 && releaseTrip === null; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(releaseTrip, 'capture should have started');

    const pending = await request('/api/admin/gps/backfill', { tripIds: [101] }, key);
    assert.equal(pending.status, 202, JSON.stringify(pending.body));
    assert.equal(pending.body.commandStatus, 'PENDING');

    const release = releaseTrip!;
    release();
    const first = await firstPromise;
    assert.equal(first.status, 200, JSON.stringify(first.body));

    const replay = await request('/api/admin/gps/backfill', { tripIds: [101] }, key);
    assert.equal(replay.status, 200, JSON.stringify(replay.body));
    assert.deepEqual(replay, first);

    const conflict = await request('/api/admin/gps/backfill', { tripIds: [102] }, key);
    assert.equal(conflict.status, 409);

  });

  it('persists failed recapture commands and lets the same key retry to success', async () => {
    let attempts = 0;
    const deps: AdminGpsDeps = {
      selectBackfillTripIds: async () => ({ tripIds: [], truncated: false }),
      captureAndDeriveTripGps: async (tripId) => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('simulated gps failure');
        }
        return {
          tripId,
          status: 'partial',
          pointCount: 4,
          legsDerived: 0,
          legsTotal: 2,
          errorKind: 'derive_failed',
        };
      },
    };

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = {
        userId: adminUserId,
        username: `q23-gps-admin-${suffix}`,
        email: null,
        fullName: null,
        role: Role.ADMIN,
      };
      next();
    });
    app.use('/api/admin/gps', createAdminGpsRouter(deps));
    app.use(globalErrorHandler);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const key = `q23-gps-recapture-${suffix}`;
    const failed = await request('/api/admin/gps/recapture/501', {}, key);
    assert.equal(failed.status, 500, JSON.stringify(failed.body));
    assert.equal(failed.body.commandStatus, 'FAILED');
    assert.match(String(failed.body.error ?? ''), /Tác vụ GPS thất bại/);
    assert.doesNotMatch(String(failed.body.error ?? ''), /simulated gps failure/);

    const retried = await request('/api/admin/gps/recapture/501', {}, key);
    assert.equal(retried.status, 200, JSON.stringify(retried.body));
    assert.equal(retried.body.tripId, 501);
    assert.equal(attempts, 2);

    const replay = await request('/api/admin/gps/recapture/501', {}, key);
    assert.equal(replay.status, 200, JSON.stringify(replay.body));
    assert.deepEqual(replay, retried);
  });

  it('recovers a stale pending lease for the same key after takeover timeout', async () => {
    let attempts = 0;
    const deps: AdminGpsDeps = {
      selectBackfillTripIds: async () => ({ tripIds: [], truncated: false }),
      captureAndDeriveTripGps: async (tripId) => {
        attempts += 1;
        return {
          tripId,
          status: 'ok',
          pointCount: 8,
          legsDerived: 1,
          legsTotal: 1,
        };
      },
    };

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = {
        userId: adminUserId,
        username: `q23-gps-admin-${suffix}`,
        email: null,
        fullName: null,
        role: Role.ADMIN,
      };
      next();
    });
    app.use('/api/admin/gps', createAdminGpsRouter(deps));
    app.use(globalErrorHandler);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const key = `q23-gps-stale-pending-${suffix}`;
    idempotencyKeys.push(key);
    await db.insert(s.idempotencyKeys).values({
      endpoint: 'gps.recapture',
      idempotencyKey: key,
      entityType: 'GPS_COMMAND',
      entityId: null,
      payloadHash: hashPayload({ tripId: 777 }),
      responseStatusCode: 202,
      responseSnapshot: {
        commandStatus: 'PENDING',
        attempt: 1,
        acceptedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        leaseExpiresAt: new Date(Date.now() - 9 * 60 * 1000).toISOString(),
      },
      createdBy: adminUserId,
    });

    const recovered = await request('/api/admin/gps/recapture/777', {}, key);
    assert.equal(recovered.status, 200, JSON.stringify(recovered.body));
    assert.equal(recovered.body.tripId, 777);
    assert.equal(attempts, 1);

    const [stored] = await db.select({ snapshot: s.idempotencyKeys.responseSnapshot })
      .from(s.idempotencyKeys)
      .where(eq(s.idempotencyKeys.idempotencyKey, key))
      .limit(1);
    const snapshot = stored?.snapshot as Record<string, unknown>;
    assert.equal(snapshot.commandStatus, 'SUCCEEDED');
    assert.equal(snapshot.attempt, 2);
  });
});
