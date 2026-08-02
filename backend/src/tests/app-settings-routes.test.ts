import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { eq, inArray } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { Role } from '@tingting/shared';
import { config } from '../config';
import { initEnforcer } from '../casbin/enforcer';
import { authMiddleware } from '../middleware/auth';
import { casbinAuthz } from '../middleware/casbin';
import { globalErrorHandler } from '../middleware/errorHandler';
import { approveGovernanceAction } from '../services/adjustment-governance.service';
import { cancelGovernanceAction, checkGovernanceAction, setGovernanceApprovalAfterApplyHookForTest } from '../services/governance-transition.service';
import { getAppSettings, saveAppSettings } from '../services/app-settings.service';
import {
  EMAIL_SETTING_KEYS,
  invalidateEmailSettings,
  saveEmailSettings,
} from '../services/email-settings.service';
import { appSettingsRouter } from '../routes/app-settings';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdUserIds: number[] = [];
const createdGovernanceActionIds: number[] = [];
const createdBusinessUnitIds: number[] = [];
const createdDriverIds: number[] = [];
let server: http.Server;
let baseUrl: string;
let originalSettings: Awaited<ReturnType<typeof getAppSettings>>;
let originalResendKeyValue: string | undefined;
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

async function mkLinkedActiveDriver(businessUnitId: number) {
  const user = await mkUser(`app-settings-driver-${suffix}-${createdDriverIds.length + 1}`, Role.DRIVER);
  const [driver] = await db.insert(s.drivers).values({
    name: `Payroll Driver ${suffix} ${createdDriverIds.length + 1}`,
    phone: `09${String(Date.now()).slice(-8)}`,
    status: 'ACTIVE',
    userId: user.id,
  }).returning();
  createdDriverIds.push(driver.id);
  await db.insert(s.userBusinessUnitLinks).values({
    userId: user.id,
    businessUnitId,
  });
  return { user, driver };
}

function sign(user: { id: number; username: string | null; role: Role | string }) {
  return jwt.sign(
    { userId: user.id, username: user.username ?? `user-${user.id}`, role: user.role as Role },
    config.jwtSecret,
  );
}

async function request(path: string, init: {
  method?: string;
  token?: string;
  body?: unknown;
  idempotencyKey?: string;
  expectedUpdatedAt?: string | null;
} = {}) {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.idempotencyKey) headers['Idempotency-Key'] = init.idempotencyKey;
  if (init.expectedUpdatedAt) headers['If-Unmodified-Since'] = init.expectedUpdatedAt;
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
  const [emailSetting] = await db.select({ value: s.appSettings.value })
    .from(s.appSettings)
    .where(eq(s.appSettings.key, EMAIL_SETTING_KEYS.resendApiKey))
    .limit(1);
  originalResendKeyValue = emailSetting?.value;
  await saveEmailSettings({ clearResendApiKey: true });

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
  try {
    await saveAppSettings(originalSettings);
  } finally {
    try {
      if (server) {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    } finally {
      try {
        if (createdGovernanceActionIds.length > 0) {
          await db.delete(s.governanceActions).where(inArray(s.governanceActions.id, createdGovernanceActionIds));
        }
        if (createdBusinessUnitIds.length > 0) {
          await db.delete(s.userBusinessUnitLinks)
            .where(inArray(s.userBusinessUnitLinks.businessUnitId, createdBusinessUnitIds));
          await db.delete(s.businessUnits).where(inArray(s.businessUnits.id, createdBusinessUnitIds));
        }
        if (createdDriverIds.length > 0) {
          await db.delete(s.drivers).where(inArray(s.drivers.id, createdDriverIds));
        }
        if (createdUserIds.length > 0) {
          await db.delete(s.idempotencyKeys)
            .where(inArray(s.idempotencyKeys.createdBy, createdUserIds));
          await db.delete(s.users).where(inArray(s.users.id, createdUserIds));
        }
      } finally {
        await db.delete(s.appSettings).where(eq(s.appSettings.key, EMAIL_SETTING_KEYS.resendApiKey));
        if (originalResendKeyValue !== undefined) {
          await db.insert(s.appSettings).values({
            key: EMAIL_SETTING_KEYS.resendApiKey,
            value: originalResendKeyValue,
          });
        }
        invalidateEmailSettings();
        setGovernanceApprovalAfterApplyHookForTest(null);
        await client.end();
      }
    }
  }
});

describe('app-settings route authorization', () => {
  test('manager can read app settings but cannot write them', async () => {
    const read = await request('/', { token: managerToken });
    assert.equal(read.status, 200);
    assert.equal(typeof read.body.botEnabled, 'boolean');
    assert.equal(typeof read.body.gpsEnabled, 'boolean');

    const write = await request('/', {
      method: 'PUT',
      token: managerToken,
      body: originalSettings,
      idempotencyKey: `manager-write-${suffix}`,
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
      idempotencyKey: `accountant-write-${suffix}`,
    });
    assert.equal(write.status, 403);
  });

  test('admin can still read and write app settings', async () => {
    const read = await request('/', { token: adminToken });
    assert.equal(read.status, 200);
    assert.equal(typeof read.body.updatedAt, 'string');

    const flipped = {
      botEnabled: !originalSettings.botEnabled,
      gpsEnabled: originalSettings.gpsEnabled,
      creditWarningThresholdDefault: originalSettings.creditWarningThresholdDefault,
      creditTierOneAmountCap: originalSettings.creditTierOneAmountCap,
      salaryPayrollBusinessUnitId: originalSettings.salaryPayrollBusinessUnitId,
    };
    const write = await request('/', {
      method: 'PUT',
      token: adminToken,
      body: flipped,
      idempotencyKey: `admin-settings-${suffix}`,
      expectedUpdatedAt: String(read.body.updatedAt),
    });
    assert.equal(write.status, 200);
    assert.equal(write.body.botEnabled, flipped.botEnabled);
  });

  test('material financial settings create governance while direct toggles still apply immediately', async () => {
    const [unit] = await db.insert(s.businessUnits).values({
      code: `APS-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      name: `App settings payroll unit ${suffix}`,
      status: 'ACTIVE',
    }).returning({ id: s.businessUnits.id });
    createdBusinessUnitIds.push(unit.id);
    await mkLinkedActiveDriver(unit.id);

    const read = await request('/', { token: adminToken });
    assert.equal(read.status, 200);

    const proposed = {
      botEnabled: !Boolean(read.body.botEnabled),
      gpsEnabled: Boolean(read.body.gpsEnabled),
      creditWarningThresholdDefault: Number(read.body.creditWarningThresholdDefault ?? originalSettings.creditWarningThresholdDefault),
      creditTierOneAmountCap: Number(read.body.creditTierOneAmountCap ?? originalSettings.creditTierOneAmountCap),
      salaryPayrollBusinessUnitId: unit.id,
    };
    const write = await request('/', {
      method: 'PUT',
      token: adminToken,
      body: proposed,
      idempotencyKey: `admin-settings-governed-${suffix}`,
      expectedUpdatedAt: String(read.body.updatedAt),
    });
    assert.equal(write.status, 201);
    assert.equal(write.body.status, 'PENDING_CHECK');
    createdGovernanceActionIds.push(Number(write.body.id));

    const after = await request('/', { token: adminToken });
    assert.equal(after.status, 200);
    assert.equal(after.body.botEnabled, proposed.botEnabled, 'direct operational toggle applies immediately');
    assert.equal(
      after.body.salaryPayrollBusinessUnitId,
      originalSettings.salaryPayrollBusinessUnitId,
      'governed payroll-unit change must wait for approval',
    );
    await cancelGovernanceAction({
      actionId: Number(write.body.id),
      actorId: createdUserIds[0]!,
      actorRole: Role.ADMIN,
      expectedVersion: Number(write.body.version),
      reason: 'Dọn fixture kiểm thử app-settings',
    });
  });

  test('failed approval rollback leaves governed payroll settings cache unchanged', async () => {
    const cachedBefore = await getAppSettings();
    const [unit] = await db.insert(s.businessUnits).values({
      code: `APR-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      name: `Rollback payroll unit ${suffix}`,
      status: 'ACTIVE',
    }).returning({ id: s.businessUnits.id });
    createdBusinessUnitIds.push(unit.id);
    await mkLinkedActiveDriver(unit.id);

    const read = await request('/', { token: adminToken });
    assert.equal(read.status, 200);
    const proposed = {
      botEnabled: Boolean(read.body.botEnabled),
      gpsEnabled: Boolean(read.body.gpsEnabled),
      creditWarningThresholdDefault: Number(read.body.creditWarningThresholdDefault ?? cachedBefore.creditWarningThresholdDefault),
      creditTierOneAmountCap: Number(read.body.creditTierOneAmountCap ?? cachedBefore.creditTierOneAmountCap),
      salaryPayrollBusinessUnitId: unit.id,
    };
    const write = await request('/', {
      method: 'PUT',
      token: adminToken,
      body: proposed,
      idempotencyKey: `app-settings-rollback-${suffix}`,
      expectedUpdatedAt: String(read.body.updatedAt),
    });
    assert.equal(write.status, 201);
    createdGovernanceActionIds.push(Number(write.body.id));

    const checked = await checkGovernanceAction({
      actionId: Number(write.body.id),
      checkerId: createdUserIds[2]!,
      checkerRole: Role.ACCOUNTANT,
      expectedVersion: Number(write.body.version),
    });
    setGovernanceApprovalAfterApplyHookForTest(() => {
      throw new Error('rollback-after-apply');
    });
    await assert.rejects(
      approveGovernanceAction({
        actionId: Number(write.body.id),
        approverId: createdUserIds[1]!,
        approverRole: Role.MANAGER,
        expectedVersion: checked.version,
      }),
      /rollback-after-apply/,
    );
    setGovernanceApprovalAfterApplyHookForTest(null);

    const cachedAfter = await getAppSettings();
    assert.deepEqual(cachedAfter, cachedBefore);
    const readAfter = await request('/', { token: adminToken });
    assert.equal(readAfter.status, 200);
    assert.equal(readAfter.body.salaryPayrollBusinessUnitId, cachedBefore.salaryPayrollBusinessUnitId);

    const [action] = await db.select()
      .from(s.governanceActions)
      .where(eq(s.governanceActions.id, Number(write.body.id)))
      .limit(1);
    assert.equal(action?.status, 'PENDING_APPROVAL');
    assert.equal(action?.appliedAt, null);
  });

  test('email credential settings remain admin-only behind the broader config mount', async () => {
    for (const token of [managerToken, accountantToken]) {
      const read = await request('/email', { token });
      assert.equal(read.status, 403);

      const write = await request('/email', {
        method: 'PUT',
        token,
        body: { resendApiKey: 'not-authorized' },
        idempotencyKey: `email-write-${suffix}-${token.slice(0, 6)}`,
      });
      assert.equal(write.status, 403);
    }
  });

  test('admin email-settings read and write responses expose only masked credential state', async () => {
    const initial = await request('/email', { token: adminToken });
    const expectedUpdatedAt = typeof initial.body.updatedAt === 'string'
      ? String(initial.body.updatedAt)
      : null;
    assert.equal(initial.status, 200);
    assert.deepEqual(Object.keys(initial.body).sort(), ['resendKeyMasked', 'resendKeySet', 'updatedAt']);
    assert.equal('resendApiKey' in initial.body, false);

    const write = await request('/email', {
      method: 'PUT',
      token: adminToken,
      body: { resendApiKey: '' },
      idempotencyKey: `email-admin-${suffix}`,
      expectedUpdatedAt,
    });
    assert.equal(write.status, 200);
    assert.deepEqual(Object.keys(write.body).sort(), ['replayed', 'resendKeyMasked', 'resendKeySet', 'updatedAt']);
    assert.equal('resendApiKey' in write.body, false);
  });
});
