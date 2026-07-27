import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { inArray } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { Role } from '@tingting/shared';
import { config } from '../config';
import { initEnforcer } from '../casbin/enforcer';
import { authMiddleware } from '../middleware/auth';
import { casbinAuthz } from '../middleware/casbin';
import { globalErrorHandler } from '../middleware/errorHandler';
import { getAppSettings, saveAppSettings } from '../services/app-settings.service';
import { appSettingsRouter } from '../routes/app-settings';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdUserIds: number[] = [];
let server: http.Server;
let baseUrl: string;
let originalSettings: Awaited<ReturnType<typeof getAppSettings>>;
let adminToken: string;
let managerToken: string;
let accountantToken: string;

async function mkUser(username: string, role: Role) {
  const [user] = await db.insert(s.users).values({
    username,
    passwordHash: await bcrypt.hash('admin123', 10),
    role,
  }).returning();
  createdUserIds.push(user.id);
  return user;
}

function sign(user: { id: number; username: string | null; role: Role | string }) {
  return jwt.sign(
    { userId: user.id, username: user.username ?? `user-${user.id}`, role: user.role as Role },
    config.jwtSecret,
  );
}

async function request(path: string, init: { method?: string; token?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  const response = await fetch(`${baseUrl}/api/admin/app-settings${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

before(async () => {
  await initEnforcer();
  originalSettings = await getAppSettings();

  const app = express();
  app.use(express.json());
  app.use('/api/admin/app-settings', authMiddleware, casbinAuthz('config'), appSettingsRouter);
  app.use(globalErrorHandler);
  await new Promise<void>((resolve) => {
    server = http.createServer(app);
    server.listen(0, () => {
      baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });

  adminToken = sign(await mkUser(`app-settings-admin-${suffix}`, Role.ADMIN));
  managerToken = sign(await mkUser(`app-settings-manager-${suffix}`, Role.MANAGER));
  accountantToken = sign(await mkUser(`app-settings-accountant-${suffix}`, Role.ACCOUNTANT));
});

after(async () => {
  await saveAppSettings(originalSettings);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (createdUserIds.length > 0) {
    await db.delete(s.users).where(inArray(s.users.id, createdUserIds));
  }
  await client.end();
});

describe('app-settings route authorization', () => {
  test('manager can read app settings but cannot write them', async () => {
    const read = await request('/', { token: managerToken });
    assert.equal(read.status, 200);
    assert.equal(typeof read.body.botEnabled, 'boolean');
    assert.equal(typeof read.body.tutorialEnabled, 'boolean');
    assert.equal(typeof read.body.gpsEnabled, 'boolean');

    const write = await request('/', {
      method: 'PUT',
      token: managerToken,
      body: originalSettings,
    });
    assert.equal(write.status, 403);
  });

  test('accountant can read app settings but cannot write them', async () => {
    const read = await request('/', { token: accountantToken });
    assert.equal(read.status, 200);
    assert.equal(typeof read.body.botEnabled, 'boolean');

    const write = await request('/', {
      method: 'PUT',
      token: accountantToken,
      body: originalSettings,
    });
    assert.equal(write.status, 403);
  });

  test('admin can still read and write app settings', async () => {
    const read = await request('/', { token: adminToken });
    assert.equal(read.status, 200);

    const flipped = {
      botEnabled: !originalSettings.botEnabled,
      tutorialEnabled: originalSettings.tutorialEnabled,
      gpsEnabled: originalSettings.gpsEnabled,
    };
    const write = await request('/', {
      method: 'PUT',
      token: adminToken,
      body: flipped,
    });
    assert.equal(write.status, 200);
    assert.equal(write.body.botEnabled, flipped.botEnabled);
  });

  test('email credential settings remain admin-only behind the broader config mount', async () => {
    for (const token of [managerToken, accountantToken]) {
      const read = await request('/email', { token });
      assert.equal(read.status, 403);

      const write = await request('/email', {
        method: 'PUT',
        token,
        body: { resendApiKey: 'not-authorized' },
      });
      assert.equal(write.status, 403);
    }
  });

  test('admin email-settings read and write responses expose only masked credential state', async () => {
    for (const response of [
      await request('/email', { token: adminToken }),
      await request('/email', {
        method: 'PUT',
        token: adminToken,
        body: { resendApiKey: '' },
      }),
    ]) {
      assert.equal(response.status, 200);
      assert.deepEqual(Object.keys(response.body).sort(), ['resendKeyMasked', 'resendKeySet']);
      assert.equal('resendApiKey' in response.body, false);
    }
  });
});
