import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import sharp from 'sharp';
import { eq, inArray, like } from 'drizzle-orm';
import { Role } from '@tingting/shared';

import { initEnforcer } from '../casbin/enforcer';
import { config } from '../config';
import { client, db } from '../db';
import * as s from '../db/schema';
import { disconnectRedis } from '../lib/redis';
import { authMiddleware } from '../middleware/auth';
import { auditLogMiddleware } from '../middleware/audit';
import { casbinAuthz, requireRoles } from '../middleware/casbin';
import { globalErrorHandler } from '../middleware/errorHandler';
import ocrRoutes from '../routes/ocr';
import ocrSettingsRoutes from '../routes/ocr-settings';
import { decryptSecret } from '../services/crypto';
import {
  callOpenRouterVision,
  extractContainerAndSeal,
  OCR_DISABLED_ERROR,
} from '../services/ocr.service';
import {
  OCR_SETTING_KEYS,
  invalidateOcrSettings,
} from '../services/ocr-settings.service';
import { storageService } from '../services/storage.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const idempotencyKeys = new Set<string>();
const createdUserIds = new Set<number>();
const createdTripPhotoIds = new Set<number>();
const storageKeys = new Set<string>();

let server: http.Server;
let baseUrl = '';
let adminId = 0;
let managerId = 0;
let adminToken = '';
let managerToken = '';
let tripId = 0;
let customerId = 0;
let routeId = 0;
let cargoTypeId = 0;
let imageBuffer: Buffer;
let originalRows: Array<{ key: string; value: string }> = [];
let originalOpenrouterEnv = '';
let originalGeminiEnv = '';
const originalFetch = globalThis.fetch;

function sign(user: { id: number; username: string; role: string }) {
  return jwt.sign(
    { userId: user.id, username: user.username, role: user.role },
    config.jwtSecret,
  );
}

async function captureOcrRows() {
  return db.select({ key: s.appSettings.key, value: s.appSettings.value })
    .from(s.appSettings)
    .where(like(s.appSettings.key, 'ocr.%'))
    .orderBy(s.appSettings.key);
}

async function replaceOcrRows(rows: Array<{ key: string; value: string }>) {
  await db.delete(s.appSettings).where(like(s.appSettings.key, 'ocr.%'));
  if (rows.length > 0) {
    await db.insert(s.appSettings).values(rows);
  }
  invalidateOcrSettings();
}

async function resetToEnvFallback(env: { openrouter: string; gemini: string }) {
  config.openrouterApiKey = env.openrouter;
  config.geminiApiKey = env.gemini;
  await replaceOcrRows([]);
}

async function requestJson(path: string, init: {
  method?: string;
  token?: string;
  body?: unknown;
  idempotencyKey?: string;
  expectedUpdatedAt?: string | null;
} = {}) {
  if (init.idempotencyKey) idempotencyKeys.add(init.idempotencyKey);
  const headers: Record<string, string> = {};
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (init.idempotencyKey) headers['Idempotency-Key'] = init.idempotencyKey;
  if (init.expectedUpdatedAt) headers['If-Unmodified-Since'] = init.expectedUpdatedAt;
  const response = await fetch(`${baseUrl}${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  return {
    status: response.status,
    body: await response.json().catch(() => ({})) as Record<string, unknown>,
  };
}

async function multipartRequest(
  path: string,
  token: string,
  fields: Record<string, string>,
  idempotencyKey: string,
  buffer = imageBuffer,
) {
  idempotencyKeys.add(idempotencyKey);
  const form = new FormData();
  form.set('file', new Blob([new Uint8Array(buffer)], { type: 'image/jpeg' }), 'ocr.jpg');
  for (const [key, value] of Object.entries(fields)) {
    form.set(key, value);
  }
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Idempotency-Key': idempotencyKey,
    },
    body: form,
  });
  return {
    status: response.status,
    body: await response.json().catch(() => ({})) as Record<string, unknown>,
  };
}

before(async () => {
  await initEnforcer();
  originalRows = await captureOcrRows();
  originalOpenrouterEnv = config.openrouterApiKey;
  originalGeminiEnv = config.geminiApiKey;

  const mkUser = async (username: string, role: 'ADMIN' | 'MANAGER') => {
    const [user] = await db.insert(s.users).values({
      username,
      fullName: username,
      passwordHash: 'x',
      role,
      status: 'ACTIVE',
    }).returning({ id: s.users.id, username: s.users.username, role: s.users.role });
    createdUserIds.add(user.id);
    return user;
  };

  const admin = await mkUser(`ocr-admin-${suffix}`, 'ADMIN');
  const manager = await mkUser(`ocr-manager-${suffix}`, 'MANAGER');
  adminId = admin.id;
  managerId = manager.id;
  adminToken = sign({ ...admin, username: admin.username ?? `admin-${admin.id}` });
  managerToken = sign({ ...manager, username: manager.username ?? `manager-${manager.id}` });

  const [customer] = await db.insert(s.customers).values({
    name: `OCR customer ${suffix}`,
  }).returning({ id: s.customers.id });
  customerId = customer.id;
  const [route] = await db.insert(s.routes).values({
    name: `OCR route ${suffix}`,
  }).returning({ id: s.routes.id });
  routeId = route.id;
  const [cargoType] = await db.insert(s.cargoTypes).values({
    name: `OCR cargo ${suffix}`,
  }).returning({ id: s.cargoTypes.id });
  cargoTypeId = cargoType.id;
  const [trip] = await db.insert(s.trips).values({
    tripCode: `OCR-${suffix}`,
    customerId,
    routeId,
    cargoTypeId,
    departureDate: '2026-08-02',
  }).returning({ id: s.trips.id });
  tripId = trip.id;

  imageBuffer = await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 20, g: 30, b: 40 } },
  }).jpeg().toBuffer();

  const app = express();
  app.use(express.json());
  app.use(auditLogMiddleware);
  app.use('/api/admin/ocr-settings', authMiddleware, casbinAuthz('ocr-settings'), requireRoles(Role.ADMIN), ocrSettingsRoutes);
  app.use('/api/ocr', authMiddleware, casbinAuthz('ocr'), ocrRoutes);
  app.use(globalErrorHandler);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  globalThis.fetch = originalFetch;
  try {
    await replaceOcrRows(originalRows);
    config.openrouterApiKey = originalOpenrouterEnv;
    config.geminiApiKey = originalGeminiEnv;

    if (idempotencyKeys.size > 0) {
      await db.delete(s.idempotencyKeys)
        .where(inArray(s.idempotencyKeys.idempotencyKey, [...idempotencyKeys]));
    }

    const tripPhotos = await db.select({
      id: s.tripPhotos.id,
      storageKey: s.tripPhotos.storageKey,
    }).from(s.tripPhotos).where(eq(s.tripPhotos.tripId, tripId));
    if (tripPhotos.length > 0) {
      for (const row of tripPhotos) {
        createdTripPhotoIds.add(row.id);
        storageKeys.add(row.storageKey);
      }
      await db.delete(s.tripPhotos).where(inArray(s.tripPhotos.id, [...createdTripPhotoIds]));
    }

    const durableJobs = await db.select({
      id: s.durableEffectJobs.id,
      payload: s.durableEffectJobs.payload,
    }).from(s.durableEffectJobs);
    const scopedJobIds = durableJobs
      .filter((row) => {
        const payload = row.payload as Record<string, unknown>;
        return typeof payload.storageKey === 'string' && storageKeys.has(payload.storageKey);
      })
      .map((row) => row.id);
    if (scopedJobIds.length > 0) {
      await db.delete(s.durableEffectJobs).where(inArray(s.durableEffectJobs.id, scopedJobIds));
    }

    for (const storageKey of storageKeys) {
      await storageService.delete(storageKey).catch(() => undefined);
    }

    await db.delete(s.auditLogs).where(inArray(s.auditLogs.userId, [adminId, managerId]));
    if (tripId) {
      await db.delete(s.trips).where(eq(s.trips.id, tripId));
    }
    if (cargoTypeId) {
      await db.delete(s.cargoTypes).where(eq(s.cargoTypes.id, cargoTypeId));
    }
    if (routeId) {
      await db.delete(s.routes).where(eq(s.routes.id, routeId));
    }
    if (customerId) {
      await db.delete(s.customers).where(eq(s.customers.id, customerId));
    }
    if (createdUserIds.size > 0) {
      await db.delete(s.users).where(inArray(s.users.id, [...createdUserIds]));
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await disconnectRedis();
    await client.end();
  }
});

describe('ocr settings route + runtime integration', () => {
  test('GET uses env fallback, hides plaintext, and PUT replays with encrypted storage', async () => {
    await resetToEnvFallback({
      openrouter: 'env-openrouter-1234',
      gemini: 'env-gemini-5678',
    });

    const initial = await requestJson('/api/admin/ocr-settings', { token: adminToken });
    assert.equal(initial.status, 200);
    assert.equal(initial.body.enabled, true);
    assert.equal(initial.body.openrouterKeySet, true);
    assert.equal(initial.body.geminiKeySet, true);
    assert.equal(initial.body.openrouterKeyMasked, '••••••••1234');
    assert.equal(initial.body.geminiKeyMasked, '••••••••5678');
    assert.equal(initial.body.updatedAt, null);
    assert.equal('openrouterApiKey' in initial.body, false);
    assert.equal('geminiApiKey' in initial.body, false);

    const forbidden = await requestJson('/api/admin/ocr-settings', {
      method: 'PUT',
      token: managerToken,
      idempotencyKey: `ocr-settings-forbidden-${suffix}`,
      body: { enabled: true, openrouterApiKey: 'forbidden-key' },
    });
    assert.equal(forbidden.status, 403);

    const writeKey = `ocr-settings-write-${suffix}`;
    const first = await requestJson('/api/admin/ocr-settings', {
      method: 'PUT',
      token: adminToken,
      idempotencyKey: writeKey,
      body: {
        enabled: true,
        openrouterApiKey: 'db-openrouter-4321',
        geminiApiKey: 'db-gemini-8765',
      },
    });
    const replay = await requestJson('/api/admin/ocr-settings', {
      method: 'PUT',
      token: adminToken,
      idempotencyKey: writeKey,
      body: {
        enabled: true,
        openrouterApiKey: 'db-openrouter-4321',
        geminiApiKey: 'db-gemini-8765',
      },
    });
    assert.equal(first.status, 200);
    assert.equal(first.body.replayed, false);
    assert.equal(replay.status, 200);
    assert.equal(replay.body.replayed, true);
    assert.equal(first.body.openrouterKeyMasked, '••••••••4321');
    assert.equal(first.body.geminiKeyMasked, '••••••••8765');

    const rows = await captureOcrRows();
    const storedOpenrouter = rows.find((row) => row.key === OCR_SETTING_KEYS.openrouterApiKey);
    const storedGemini = rows.find((row) => row.key === OCR_SETTING_KEYS.geminiApiKey);
    assert.ok(storedOpenrouter?.value.startsWith('enc:v1:'));
    assert.ok(storedGemini?.value.startsWith('enc:v1:'));
    assert.notEqual(storedOpenrouter?.value, 'db-openrouter-4321');
    assert.notEqual(storedGemini?.value, 'db-gemini-8765');
    assert.equal(decryptSecret(storedOpenrouter?.value ?? ''), 'db-openrouter-4321');
    assert.equal(decryptSecret(storedGemini?.value ?? ''), 'db-gemini-8765');

    const cleared = await requestJson('/api/admin/ocr-settings', {
      method: 'PUT',
      token: adminToken,
      idempotencyKey: `ocr-settings-clear-after-write-${suffix}`,
      expectedUpdatedAt: String(first.body.updatedAt),
      body: { enabled: false, clearOpenRouterKey: true, clearGeminiKey: true },
    });
    assert.equal(cleared.status, 200, JSON.stringify(cleared.body));

    const replayAfterClear = await requestJson('/api/admin/ocr-settings', {
      method: 'PUT',
      token: adminToken,
      idempotencyKey: writeKey,
      body: {
        enabled: true,
        openrouterApiKey: 'db-openrouter-4321',
        geminiApiKey: 'db-gemini-8765',
      },
    });
    assert.equal(replayAfterClear.status, 200);
    assert.equal(replayAfterClear.body.replayed, true);
    assert.equal(replayAfterClear.body.openrouterKeyMasked, '••••••••4321');
    assert.equal(replayAfterClear.body.geminiKeyMasked, '••••••••8765');
  });

  test('PUT retains omitted and blank keys, supports clears, and enforces stale-write + enable-without-key guards', async () => {
    await resetToEnvFallback({ openrouter: '', gemini: '' });

    const seed = await requestJson('/api/admin/ocr-settings', {
      method: 'PUT',
      token: adminToken,
      idempotencyKey: `ocr-settings-seed-${suffix}`,
      body: {
        enabled: true,
        openrouterApiKey: 'seed-openrouter-1111',
        geminiApiKey: 'seed-gemini-2222',
      },
    });
    assert.equal(seed.status, 200);
    const seedRead = await requestJson('/api/admin/ocr-settings', { token: adminToken });
    assert.equal(seedRead.status, 200);
    const seedVersion = String(seedRead.body.updatedAt);

    const retain = await requestJson('/api/admin/ocr-settings', {
      method: 'PUT',
      token: adminToken,
      idempotencyKey: `ocr-settings-retain-${suffix}`,
      expectedUpdatedAt: seedVersion,
      body: {
        enabled: true,
        openrouterApiKey: 'next-openrouter-3333',
        geminiApiKey: '   ',
      },
    });
    assert.equal(retain.status, 200);
    assert.equal(retain.body.openrouterKeyMasked, '••••••••3333');
    assert.equal(retain.body.geminiKeyMasked, '••••••••2222');
    assert.equal(retain.body.geminiKeySet, true);

    const stale = await requestJson('/api/admin/ocr-settings', {
      method: 'PUT',
      token: adminToken,
      idempotencyKey: `ocr-settings-stale-${suffix}`,
      expectedUpdatedAt: seedVersion,
      body: {
        enabled: true,
        openrouterApiKey: 'stale-openrouter-4444',
      },
    });
    assert.equal(stale.status, 409);

    const clearVersion = String(retain.body.updatedAt);
    const cleared = await requestJson('/api/admin/ocr-settings', {
      method: 'PUT',
      token: adminToken,
      idempotencyKey: `ocr-settings-clear-${suffix}`,
      expectedUpdatedAt: clearVersion,
      body: {
        enabled: false,
        clearOpenRouterKey: true,
        clearGeminiKey: true,
      },
    });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.enabled, false);
    assert.equal(cleared.body.openrouterKeySet, false);
    assert.equal(cleared.body.geminiKeySet, false);

    const cannotEnable = await requestJson('/api/admin/ocr-settings', {
      method: 'PUT',
      token: adminToken,
      idempotencyKey: `ocr-settings-enable-fail-${suffix}`,
      expectedUpdatedAt: String(cleared.body.updatedAt),
      body: { enabled: true },
    });
    assert.equal(cannotEnable.status, 400);
    assert.match(String(cannotEnable.body.error ?? ''), /OpenRouter hoặc Gemini/);
  });

  test('serializes concurrent admin writes so one stale merge is rejected', async () => {
    await resetToEnvFallback({ openrouter: '', gemini: '' });
    const seeded = await requestJson('/api/admin/ocr-settings', {
      method: 'PUT',
      token: adminToken,
      idempotencyKey: `ocr-settings-concurrent-seed-${suffix}`,
      body: {
        enabled: true,
        openrouterApiKey: 'concurrent-openrouter-1111',
        geminiApiKey: 'concurrent-gemini-2222',
      },
    });
    assert.equal(seeded.status, 200);
    const expectedUpdatedAt = String(seeded.body.updatedAt);

    const [openrouterWrite, geminiWrite] = await Promise.all([
      requestJson('/api/admin/ocr-settings', {
        method: 'PUT',
        token: adminToken,
        idempotencyKey: `ocr-settings-concurrent-openrouter-${suffix}`,
        expectedUpdatedAt,
        body: { enabled: true, openrouterApiKey: 'concurrent-openrouter-3333' },
      }),
      requestJson('/api/admin/ocr-settings', {
        method: 'PUT',
        token: adminToken,
        idempotencyKey: `ocr-settings-concurrent-gemini-${suffix}`,
        expectedUpdatedAt,
        body: { enabled: true, geminiApiKey: 'concurrent-gemini-4444' },
      }),
    ]);
    assert.deepEqual(
      [openrouterWrite.status, geminiWrite.status].sort((a, b) => a - b),
      [200, 409],
      JSON.stringify({ openrouterWrite, geminiWrite }),
    );

    const current = await requestJson('/api/admin/ocr-settings', { token: adminToken });
    assert.equal(current.status, 200);
    if (openrouterWrite.status === 200) {
      assert.equal(current.body.openrouterKeyMasked, '••••••••3333');
      assert.equal(current.body.geminiKeyMasked, '••••••••2222');
    } else {
      assert.equal(current.body.openrouterKeyMasked, '••••••••1111');
      assert.equal(current.body.geminiKeyMasked, '••••••••4444');
    }
  });

  test('replays successful recognition after OCR is disabled', async () => {
    await resetToEnvFallback({ openrouter: '', gemini: '' });
    const enabled = await requestJson('/api/admin/ocr-settings', {
      method: 'PUT',
      token: adminToken,
      idempotencyKey: `ocr-settings-replay-enable-${suffix}`,
      body: { enabled: true, openrouterApiKey: 'replay-openrouter-1357' },
    });
    assert.equal(enabled.status, 200);

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith(baseUrl)) return originalFetch(input, init);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                container_numbers: ['ALLU5216535'],
                litres: 10,
                unit_price: 20000,
                total: 200000,
              }),
            },
          }],
          model: 'qwen/qwen3-vl-32b-instruct',
        }),
        text: async () => '',
        headers: new Headers(),
      } as Response;
    }) as unknown as typeof globalThis.fetch;

    const captureKey = `ocr-capture-replay-${suffix}`;
    const pumpKey = `ocr-pump-replay-${suffix}`;
    try {
      const capture = await multipartRequest('/api/ocr', adminToken, {
        type: 'CONTAINER',
      }, captureKey);
      const pump = await multipartRequest('/api/ocr/pump', adminToken, {}, pumpKey);
      assert.equal(capture.status, 200);
      assert.equal(capture.body.ok, true);
      assert.equal(pump.status, 200);
      assert.equal(pump.body.ok, true);

      const disabled = await requestJson('/api/admin/ocr-settings', {
        method: 'PUT',
        token: adminToken,
        idempotencyKey: `ocr-settings-replay-disable-${suffix}`,
        expectedUpdatedAt: String(enabled.body.updatedAt),
        body: { enabled: false },
      });
      assert.equal(disabled.status, 200, JSON.stringify(disabled.body));

      const captureReplay = await multipartRequest('/api/ocr', adminToken, {
        type: 'CONTAINER',
      }, captureKey);
      const pumpReplay = await multipartRequest('/api/ocr/pump', adminToken, {}, pumpKey);
      assert.equal(captureReplay.status, 200);
      assert.deepEqual(captureReplay.body, capture.body);
      assert.equal(pumpReplay.status, 200);
      assert.deepEqual(pumpReplay.body, pump.body);

      const newCapture = await multipartRequest('/api/ocr', adminToken, {
        type: 'CONTAINER',
      }, `ocr-capture-new-disabled-${suffix}`);
      assert.equal(newCapture.status, 503);
      assert.match(String(newCapture.body.error ?? ''), /đang tắt/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('disabled recognition rejects capture and pump, but persist-only still writes the photo row', async () => {
    await resetToEnvFallback({ openrouter: '', gemini: '' });
    const disabled = await requestJson('/api/admin/ocr-settings', {
      method: 'PUT',
      token: adminToken,
      idempotencyKey: `ocr-settings-disable-${suffix}`,
      body: {
        enabled: false,
        openrouterApiKey: 'disabled-openrouter-9999',
      },
    });
    assert.equal(disabled.status, 200);

    const beforeRows = await db.select({ id: s.tripPhotos.id })
      .from(s.tripPhotos)
      .where(eq(s.tripPhotos.tripId, tripId));

    const capture = await multipartRequest('/api/ocr', adminToken, {
      type: 'CONTAINER',
      trip_id: String(tripId),
    }, `ocr-capture-disabled-${suffix}`);
    assert.equal(capture.status, 503);
    assert.match(String(capture.body.error ?? ''), /đang tắt/);

    const pump = await multipartRequest('/api/ocr/pump', adminToken, {}, `ocr-pump-disabled-${suffix}`);
    assert.equal(pump.status, 503);
    assert.match(String(pump.body.error ?? ''), /đang tắt/);

    const persisted = await multipartRequest('/api/ocr/persist-only', adminToken, {
      type: 'CONTAINER',
      trip_id: String(tripId),
    }, `ocr-persist-disabled-${suffix}`);
    assert.equal(persisted.status, 200, JSON.stringify(persisted.body));
    assert.equal(persisted.body.ok, true);

    const afterRows = await db.select({
      id: s.tripPhotos.id,
      storageKey: s.tripPhotos.storageKey,
    })
      .from(s.tripPhotos)
      .where(eq(s.tripPhotos.tripId, tripId));
    assert.equal(afterRows.length, beforeRows.length + 1);
    const storageKey = String(persisted.body.storageKey);
    storageKeys.add(storageKey);
    const saved = afterRows.find((row) => row.storageKey === storageKey);
    assert.ok(saved);
    createdTripPhotoIds.add(saved.id);
  });

  test('runtime OCR provider calls resolve keys from OCR settings rows and stop before fetch when disabled', async () => {
    await resetToEnvFallback({ openrouter: '', gemini: '' });
    await replaceOcrRows([
      { key: OCR_SETTING_KEYS.enabled, value: 'true' },
      { key: OCR_SETTING_KEYS.openrouterApiKey, value: 'plain-openrouter-2468' },
      { key: OCR_SETTING_KEYS.geminiApiKey, value: '' },
    ]);

    const seenAuth: string[] = [];
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers instanceof Headers
        ? init.headers
        : new Headers(init?.headers as HeadersInit | undefined);
      seenAuth.push(headers.get('Authorization') ?? '');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: '{"container_numbers":["ALLU5216535"]}' } }],
          model: 'qwen/qwen3-vl-32b-instruct',
        }),
        text: async () => '',
        headers: new Headers(),
      } as Response;
    }) as unknown as typeof globalThis.fetch;

    try {
      const direct = await callOpenRouterVision('prompt', imageBuffer, 'image/jpeg');
      assert.equal(direct.success, true);
      assert.equal(seenAuth.at(-1), 'Bearer plain-openrouter-2468');

      const extracted = await extractContainerAndSeal(imageBuffer, 'CONTAINER', 'image/jpeg');
      assert.equal(extracted.success, true);
      assert.equal(extracted.provider, 'openrouter');
      assert.deepEqual(extracted.containerNumbers, ['ALLU5216535']);
      assert.equal(seenAuth.at(-1), 'Bearer plain-openrouter-2468');
    } finally {
      globalThis.fetch = originalFetch;
    }

    await replaceOcrRows([
      { key: OCR_SETTING_KEYS.enabled, value: 'false' },
      { key: OCR_SETTING_KEYS.openrouterApiKey, value: 'disabled-openrouter-1357' },
      { key: OCR_SETTING_KEYS.geminiApiKey, value: '' },
    ]);

    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      throw new Error('fetch should not run while OCR is disabled');
    }) as unknown as typeof globalThis.fetch;
    try {
      const disabled = await extractContainerAndSeal(imageBuffer, 'CONTAINER', 'image/jpeg');
      assert.equal(disabled.success, false);
      assert.equal(disabled.provider, null);
      assert.equal(disabled.error, OCR_DISABLED_ERROR);
      assert.equal(calls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
