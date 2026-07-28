import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { inArray } from 'drizzle-orm';
import { Role } from '@tingting/shared';

import { config } from '../config';
import { db, client } from '../db';
import * as s from '../db/schema';
import { initEnforcer } from '../casbin/enforcer';
import { authMiddleware } from '../middleware/auth';
import { globalErrorHandler } from '../middleware/errorHandler';
import authRoutes from '../routes/auth';
import { disconnectRedis, getRedis } from '../lib/redis';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdUserIds = new Set<number>();
const usedIdempotencyKeys = new Set<string>();
const usedBlacklistJtis = new Set<string>();

let server: http.Server;
let baseUrl: string;

function signToken(
  user: { id: number; username: string | null; role: typeof s.users.$inferSelect.role },
  jti: string,
): string {
  usedBlacklistJtis.add(jti);
  return jwt.sign({
    userId: user.id,
    username: user.username,
    fullName: user.username,
    role: user.role,
    jti,
  }, config.jwtSecret, { expiresIn: '1h' });
}

async function requestJson(path: string, init: {
  method?: string;
  token?: string;
  body?: unknown;
  idempotencyKey?: string;
} = {}) {
  if (init.idempotencyKey) usedIdempotencyKeys.add(init.idempotencyKey);
  const headers: Record<string, string> = {};
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (init.idempotencyKey) headers['Idempotency-Key'] = init.idempotencyKey;
  const response = await fetch(`${baseUrl}${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const body = await response.json().catch(() => ({}));
  return {
    status: response.status,
    body: body as Record<string, unknown>,
  };
}

async function createUser(username: string, password = 'admin123') {
  const [user] = await db.insert(s.users).values({
    username,
    fullName: username,
    passwordHash: await bcrypt.hash(password, 10),
    role: Role.ADMIN,
    status: 'ACTIVE',
  }).returning({
    id: s.users.id,
    username: s.users.username,
    role: s.users.role,
  });
  createdUserIds.add(user.id);
  return user;
}

before(async () => {
  await initEnforcer();

  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.get('/api/protected', authMiddleware, (_req, res) => res.json({ ok: true }));
  app.use(globalErrorHandler);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });

  if (usedIdempotencyKeys.size > 0) {
    await db.delete(s.idempotencyKeys)
      .where(inArray(s.idempotencyKeys.idempotencyKey, [...usedIdempotencyKeys]));
  }
  for (const jti of usedBlacklistJtis) {
    await getRedis().del(`blacklist:${jti}`);
  }
  if (createdUserIds.size > 0) {
    await db.delete(s.users).where(inArray(s.users.id, [...createdUserIds]));
  }
  await disconnectRedis();
  await client.end();
});

describe('auth session revocation', () => {
  test('logout blacklists the current token immediately', async () => {
    const user = await createUser(`logout-revoke-${suffix}`);
    const token = signToken(user, `logout-jti-${suffix}`);

    const logout = await requestJson('/api/auth/logout', {
      method: 'POST',
      token,
      body: {},
    });
    assert.equal(logout.status, 200);
    assert.equal(logout.body.success, true);

    const protectedResponse = await requestJson('/api/protected', { token });
    assert.equal(protectedResponse.status, 401);
    assert.equal(protectedResponse.body.error, 'Token đã bị thu hồi');
  });

  test('password-change replay retries revocation until the old token is blacklisted', async () => {
    const user = await createUser(`password-revoke-${suffix}`);
    const token = signToken(user, `password-jti-${suffix}`);
    const redis = getRedis();
    const originalSet = redis.set.bind(redis);
    let setCalls = 0;
    redis.set = (async (...args: Parameters<typeof redis.set>) => {
      setCalls += 1;
      if (setCalls === 1 && typeof args[0] === 'string' && args[0].startsWith('blacklist:')) {
        throw new Error('redis unavailable');
      }
      return originalSet(...args);
    }) as typeof redis.set;

    try {
      const idempotencyKey = `auth-password-revoke-${suffix}`;
      const firstAttempt = await requestJson('/api/auth/change-password', {
        method: 'POST',
        token,
        idempotencyKey,
        body: { currentPassword: 'admin123', newPassword: 'admin456' },
      });
      assert.equal(firstAttempt.status, 503);
      assert.match(String(firstAttempt.body.error ?? ''), /chưa được thu hồi/i);

      const replayAttempt = await requestJson('/api/auth/change-password', {
        method: 'POST',
        token,
        idempotencyKey,
        body: { currentPassword: 'admin123', newPassword: 'admin456' },
      });
      assert.equal(replayAttempt.status, 200);
      assert.equal(replayAttempt.body.success, true);
      assert.equal(replayAttempt.body.replayed, true);

      const protectedResponse = await requestJson('/api/protected', { token });
      assert.equal(protectedResponse.status, 401);
      assert.equal(protectedResponse.body.error, 'Token đã bị thu hồi');

      const login = await requestJson('/api/auth/login', {
        method: 'POST',
        body: { identifier: user.username, password: 'admin456' },
      });
      assert.equal(login.status, 200);
      assert.equal(typeof login.body.token, 'string');
    } finally {
      redis.set = originalSet;
    }
  });
});
