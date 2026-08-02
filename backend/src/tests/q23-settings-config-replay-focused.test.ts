import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { and, eq, inArray, isNull, like } from 'drizzle-orm';
import { Role, TrailerType } from '@tingting/shared';

import { config } from '../config';
import { initEnforcer } from '../casbin/enforcer';
import { client, db } from '../db';
import * as s from '../db/schema';
import { disconnectRedis } from '../lib/redis';
import { authMiddleware } from '../middleware/auth';
import { requireRoles, casbinAuthz } from '../middleware/casbin';
import { globalErrorHandler } from '../middleware/errorHandler';
import authRoutes from '../routes/auth';
import { appSettingsRouter } from '../routes/app-settings';
import configRoutes, { salaryPeriodsAdminRouter, tireLifecycleRouter } from '../routes/config';
import paymentsRoutes from '../routes/financial/payments.routes';
import faqAdminRoutes from '../routes/faq-admin';
import gpsSettingsRoutes from '../routes/gps-settings';
import llmSettingsRoutes from '../routes/llm-settings';
import { getAppSettings, saveAppSettings } from '../services/app-settings.service';
import { invalidateGpsSettings } from '../services/gps/settings';
import { invalidateGpsProvider } from '../services/gps/providers';
import { invalidatePortalSession } from '../services/gps/portalClient';
import { invalidateLlmSettings } from '../services/llm/settings';
import { invalidateActiveProvider } from '../services/llm/provider-registry';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const idempotencyKeys = new Set<string>();
const createdUserIds = new Set<number>();
const createdBusinessUnitIds = new Set<number>();
const createdFaqEntryIds = new Set<number>();
const createdDebitTemplateIds = new Set<number>();
const createdSalaryOverrideIds = new Set<number>();
const createdTruckIds = new Set<number>();
const createdTrailerIds = new Set<number>();
const createdTireIds = new Set<number>();

let server: http.Server;
let baseUrl = '';
let adminId = 0;
let managerId = 0;
let accountantId = 0;
let driverId = 0;
let adminToken = '';
let managerToken = '';
let accountantToken = '';
let driverToken = '';
let originalAppSettings: Awaited<ReturnType<typeof getAppSettings>>;
let originalGpsRows: Array<{ key: string; value: string }> = [];
let originalLlmRows: Array<{ key: string; value: string }> = [];
let originalSalaryDefault: typeof s.salaryPeriods.$inferSelect | null = null;

function expectPendingGovernance(body: Record<string, unknown>) {
  assert.equal(body.status, 'PENDING_CHECK');
  assert.equal(body.subjectType, 'PRICE_CONFIG');
  assert.equal(body.actionKind, 'PRICE_CONFIG_CHANGE');
}

async function checkAction(actionId: number, version: number) {
  return requestJson(`/api/governance-actions/${actionId}/check`, {
    method: 'POST',
    token: accountantToken,
    idempotencyKey: `q23-settings-check-${actionId}-${version}`,
    body: { expectedVersion: version },
  });
}

async function approveAction(actionId: number, version: number) {
  return requestJson(`/api/governance-actions/${actionId}/approve`, {
    method: 'POST',
    token: managerToken,
    idempotencyKey: `q23-settings-approve-${actionId}-${version}`,
    body: { expectedVersion: version },
  });
}

function sign(user: { id: number; username: string; role: string }) {
  return jwt.sign(
    { userId: user.id, username: user.username, role: user.role },
    config.jwtSecret,
  );
}

async function capturePrefix(prefix: string) {
  return db.select({ key: s.appSettings.key, value: s.appSettings.value })
    .from(s.appSettings)
    .where(like(s.appSettings.key, prefix))
    .orderBy(s.appSettings.key);
}

async function restorePrefix(prefix: string, rows: Array<{ key: string; value: string }>) {
  await db.delete(s.appSettings).where(like(s.appSettings.key, prefix));
  if (rows.length === 0) return;
  await db.insert(s.appSettings).values(rows);
}

async function cleanupPriorQ23ReplayArtifacts() {
  const [currentSalaryDefault] = await db.select({ id: s.salaryPeriods.id })
    .from(s.salaryPeriods)
    .where(eq(s.salaryPeriods.isDefault, true))
    .limit(1);
  await db.delete(s.governanceActions).where(inArray(s.governanceActions.subjectKey, [
    'salary-period-default',
    '2099-12',
  ]));
  if (currentSalaryDefault) {
    await db.delete(s.governanceActions).where(eq(s.governanceActions.subjectId, currentSalaryDefault.id));
  }
  const staleUsers = await db.select({ id: s.users.id })
    .from(s.users)
    .where(like(s.users.username, 'q23-%'));
  const staleUserIds = staleUsers.map((row) => row.id);
  if (staleUserIds.length > 0) {
    await db.delete(s.governanceActions).where(inArray(s.governanceActions.makerId, staleUserIds));
    await db.delete(s.governanceActions).where(inArray(s.governanceActions.checkerId, staleUserIds));
    await db.delete(s.governanceActions).where(inArray(s.governanceActions.approverId, staleUserIds));
  }
  await db.delete(s.salaryPeriods).where(and(
    eq(s.salaryPeriods.month, 12),
    eq(s.salaryPeriods.year, 2099),
    eq(s.salaryPeriods.isDefault, false),
    isNull(s.salaryPeriods.deletedAt),
  ));
  await db.delete(s.debitNoteTemplates).where(like(s.debitNoteTemplates.name, 'Q23 Template %'));
  await db.delete(s.faqEntries).where(like(s.faqEntries.question, 'Q23 FAQ %'));
}

async function requestJson(path: string, init: {
  method?: string;
  token?: string;
  body?: unknown;
  idempotencyKey?: string;
  expectedUpdatedAt?: string;
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
  const body = await response.json().catch(() => ({}));
  return {
    status: response.status,
    body: body as Record<string, unknown>,
  };
}

before(async () => {
  await cleanupPriorQ23ReplayArtifacts();
  await initEnforcer();
  originalAppSettings = await getAppSettings();
  originalGpsRows = await capturePrefix('gps.%');
  originalLlmRows = await capturePrefix('llm.%');
  originalSalaryDefault = await db.select().from(s.salaryPeriods)
    .where(eq(s.salaryPeriods.isDefault, true))
    .limit(1)
    .then((rows) => rows[0] ?? null);

  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api/admin/app-settings', authMiddleware, casbinAuthz('config'), appSettingsRouter);
  app.use('/api/admin/gps-settings', authMiddleware, requireRoles(Role.ADMIN), gpsSettingsRoutes);
  app.use('/api/admin/llm-settings', authMiddleware, casbinAuthz('llm-settings'), requireRoles(Role.ADMIN), llmSettingsRoutes);
  app.use('/api/admin/faq-entries', authMiddleware, casbinAuthz('faq-admin'), requireRoles(Role.ADMIN), faqAdminRoutes);
  app.use('/api', authMiddleware, casbinAuthz('config'), configRoutes);
  app.use('/api/salary-periods', authMiddleware, casbinAuthz('config'), salaryPeriodsAdminRouter);
  app.use('/api/fleet/tires', authMiddleware, casbinAuthz('config'), tireLifecycleRouter);
  app.use('/api', authMiddleware, paymentsRoutes);
  app.use(globalErrorHandler);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const mkUser = async (username: string, role: 'ADMIN' | 'MANAGER' | 'ACCOUNTANT' | 'DRIVER') => {
    const [user] = await db.insert(s.users).values({
      username,
      fullName: username,
      passwordHash: await bcrypt.hash('admin123', 10),
      role,
      status: 'ACTIVE',
    }).returning({ id: s.users.id, username: s.users.username, role: s.users.role });
    createdUserIds.add(user.id);
    return user;
  };

  const admin = await mkUser(`q23-admin-${suffix}`, 'ADMIN');
  const manager = await mkUser(`q23-manager-${suffix}`, 'MANAGER');
  const accountant = await mkUser(`q23-accountant-${suffix}`, 'ACCOUNTANT');
  const driver = await mkUser(`q23-driver-${suffix}`, 'DRIVER');

  adminId = admin.id;
  managerId = manager.id;
  accountantId = accountant.id;
  driverId = driver.id;
  adminToken = sign({ ...admin, username: admin.username ?? `admin-${admin.id}` });
  managerToken = sign({ ...manager, username: manager.username ?? `manager-${manager.id}` });
  accountantToken = sign({ ...accountant, username: accountant.username ?? `accountant-${accountant.id}` });
  driverToken = sign({ ...driver, username: driver.username ?? `driver-${driver.id}` });
});

describe('Q23 focused settings/config replay closure', () => {
  test('auth routes replay, reject payload drift, enforce stale-write guards, and keep RBAC', async () => {
    const me = await requestJson('/api/auth/me', { token: adminToken });
    assert.equal(me.status, 200);
    const originalProfileVersion = String(me.body.updatedAt);

    const profileKey = `q23-profile-${suffix}`;
    const profilePayload = { fullName: `Q23 Profile ${suffix}` };
    const profileFirst = await requestJson('/api/auth/me', {
      method: 'PATCH',
      token: adminToken,
      body: profilePayload,
      idempotencyKey: profileKey,
      expectedUpdatedAt: originalProfileVersion,
    });
    const profileReplay = await requestJson('/api/auth/me', {
      method: 'PATCH',
      token: adminToken,
      body: profilePayload,
      idempotencyKey: profileKey,
      expectedUpdatedAt: originalProfileVersion,
    });
    const profileConflict = await requestJson('/api/auth/me', {
      method: 'PATCH',
      token: adminToken,
      body: { fullName: `Q23 Profile Drift ${suffix}` },
      idempotencyKey: profileKey,
      expectedUpdatedAt: originalProfileVersion,
    });
    assert.equal(profileFirst.status, 200);
    assert.equal(profileReplay.status, 200);
    assert.equal(profileFirst.body.replayed, false);
    assert.equal(profileReplay.body.replayed, true);
    assert.equal(profileConflict.status, 409);

    const profileStale = await requestJson('/api/auth/me', {
      method: 'PATCH',
      token: adminToken,
      body: { fullName: `Q23 Profile Stale ${suffix}` },
      idempotencyKey: `q23-profile-stale-${suffix}`,
      expectedUpdatedAt: originalProfileVersion,
    });
    assert.equal(profileStale.status, 409);

    const passwordKey = `q23-password-${suffix}`;
    const passwordFirst = await requestJson('/api/auth/change-password', {
      method: 'POST',
      token: adminToken,
      body: { currentPassword: 'admin123', newPassword: 'admin456' },
      idempotencyKey: passwordKey,
    });
    const passwordReplay = await requestJson('/api/auth/change-password', {
      method: 'POST',
      token: adminToken,
      body: { currentPassword: 'admin123', newPassword: 'admin456' },
      idempotencyKey: passwordKey,
    });
    const passwordConflict = await requestJson('/api/auth/change-password', {
      method: 'POST',
      token: adminToken,
      body: { currentPassword: 'admin123', newPassword: 'admin789' },
      idempotencyKey: passwordKey,
    });
    assert.equal(passwordFirst.status, 200);
    assert.equal(passwordReplay.body.replayed, true);
    assert.equal(passwordConflict.status, 409);

    const forbiddenUserCreate = await requestJson('/api/auth/users', {
      method: 'POST',
      token: accountantToken,
      idempotencyKey: `q23-user-forbidden-${suffix}`,
      body: {
        username: `acct-forbidden-${suffix}`,
        fullName: 'Forbidden',
        phone: `09${Date.now().toString().slice(-8)}`,
        password: 'secret123',
        role: 'DRIVER',
      },
    });
    assert.equal(forbiddenUserCreate.status, 403);

    const userCreateKey = `q23-user-create-${suffix}`;
    const userCreatePayload = {
      username: `q23-user-${suffix}`,
      fullName: `Q23 User ${suffix}`,
      phone: `09${(Date.now() + 1).toString().slice(-8)}`,
      password: 'secret123',
      role: 'DRIVER',
    };
    const userCreateA = await requestJson('/api/auth/users', {
      method: 'POST',
      token: adminToken,
      idempotencyKey: userCreateKey,
      body: userCreatePayload,
    });
    const userCreateB = await requestJson('/api/auth/users', {
      method: 'POST',
      token: adminToken,
      idempotencyKey: userCreateKey,
      body: userCreatePayload,
    });
    assert.equal(userCreateA.status, 201);
    assert.equal(userCreateB.status, 201);
    assert.deepEqual(
      [userCreateA.body.replayed, userCreateB.body.replayed].sort(),
      [false, true],
    );
    const createdRouteUserId = Number(userCreateA.body.id);
    createdUserIds.add(createdRouteUserId);
    const createdRouteUserVersion = String(userCreateA.body.updatedAt);

    const userUpdateKey = `q23-user-update-${suffix}`;
    const userUpdatePayload = { fullName: `Q23 User Updated ${suffix}` };
    const userUpdate = await requestJson(`/api/auth/users/${createdRouteUserId}`, {
      method: 'PATCH',
      token: adminToken,
      idempotencyKey: userUpdateKey,
      expectedUpdatedAt: createdRouteUserVersion,
      body: userUpdatePayload,
    });
    const userUpdateReplay = await requestJson(`/api/auth/users/${createdRouteUserId}`, {
      method: 'PATCH',
      token: adminToken,
      idempotencyKey: userUpdateKey,
      expectedUpdatedAt: createdRouteUserVersion,
      body: userUpdatePayload,
    });
    const userUpdateStale = await requestJson(`/api/auth/users/${createdRouteUserId}`, {
      method: 'PATCH',
      token: adminToken,
      idempotencyKey: `q23-user-update-stale-${suffix}`,
      expectedUpdatedAt: createdRouteUserVersion,
      body: { fullName: `Q23 User Stale ${suffix}` },
    });
    assert.equal(userUpdate.status, 200);
    assert.equal(userUpdateReplay.body.replayed, true);
    assert.equal(userUpdateStale.status, 409);

    const deleteKey = `q23-user-delete-${suffix}`;
    const userDelete = await requestJson(`/api/auth/users/${createdRouteUserId}`, {
      method: 'DELETE',
      token: adminToken,
      idempotencyKey: deleteKey,
      expectedUpdatedAt: String(userUpdate.body.updatedAt),
    });
    const userDeleteReplay = await requestJson(`/api/auth/users/${createdRouteUserId}`, {
      method: 'DELETE',
      token: adminToken,
      idempotencyKey: deleteKey,
      expectedUpdatedAt: String(userUpdate.body.updatedAt),
    });
    assert.equal(userDelete.status, 200);
    assert.equal(userDeleteReplay.body.replayed, true);

    const forbiddenUnitCreate = await requestJson('/api/auth/business-units', {
      method: 'POST',
      token: managerToken,
      idempotencyKey: `q23-unit-forbidden-${suffix}`,
      body: { code: `Q23M${suffix}`.slice(0, 20), name: `Q23 Manager ${suffix}` },
    });
    assert.equal(forbiddenUnitCreate.status, 403);

    const businessUnitKey = `q23-unit-create-${suffix}`;
    const businessUnitPayload = {
      code: `Q23B${Date.now()}`.slice(0, 20),
      name: `Q23 Business Unit ${suffix}`,
    };
    const [unitCreateA, unitCreateB] = await Promise.all([
      requestJson('/api/auth/business-units', {
        method: 'POST',
        token: adminToken,
        idempotencyKey: businessUnitKey,
        body: businessUnitPayload,
      }),
      requestJson('/api/auth/business-units', {
        method: 'POST',
        token: adminToken,
        idempotencyKey: businessUnitKey,
        body: businessUnitPayload,
      }),
    ]);
    assert.equal(unitCreateA.status, 201);
    assert.equal(unitCreateB.status, 201);
    const unitId = Number(unitCreateA.body.id);
    createdBusinessUnitIds.add(unitId);
    const unitVersion = String(unitCreateA.body.updatedAt);

    const unitUpdate = await requestJson(`/api/auth/business-units/${unitId}`, {
      method: 'PATCH',
      token: adminToken,
      idempotencyKey: `q23-unit-update-${suffix}`,
      expectedUpdatedAt: unitVersion,
      body: { name: `Q23 Business Unit Updated ${suffix}` },
    });
    const unitStale = await requestJson(`/api/auth/business-units/${unitId}`, {
      method: 'PATCH',
      token: adminToken,
      idempotencyKey: `q23-unit-stale-${suffix}`,
      expectedUpdatedAt: unitVersion,
      body: { name: `Q23 Business Unit Stale ${suffix}` },
    });
    assert.equal(unitUpdate.status, 200);
    assert.equal(unitStale.status, 409);

    const unitDeactivateKey = `q23-unit-delete-${suffix}`;
    const unitDelete = await requestJson(`/api/auth/business-units/${unitId}`, {
      method: 'DELETE',
      token: adminToken,
      idempotencyKey: unitDeactivateKey,
      expectedUpdatedAt: String(unitUpdate.body.updatedAt),
    });
    const unitDeleteReplay = await requestJson(`/api/auth/business-units/${unitId}`, {
      method: 'DELETE',
      token: adminToken,
      idempotencyKey: unitDeactivateKey,
      expectedUpdatedAt: String(unitUpdate.body.updatedAt),
    });
    assert.equal(unitDelete.status, 200);
    assert.equal(unitDeleteReplay.body.replayed, true);
  });

  test('admin-only settings and FAQ routes replay correctly and reject stale writes', async () => {
    const gpsRead = await requestJson('/api/admin/gps-settings', { token: adminToken });
    assert.equal(gpsRead.status, 200);
    const gpsVersion = typeof gpsRead.body.updatedAt === 'string' ? String(gpsRead.body.updatedAt) : undefined;

    const gpsForbidden = await requestJson('/api/admin/gps-settings', {
      method: 'PUT',
      token: managerToken,
      idempotencyKey: `q23-gps-forbidden-${suffix}`,
      body: { username: 'forbidden', password: 'secret' },
      expectedUpdatedAt: gpsVersion,
    });
    assert.equal(gpsForbidden.status, 403);

    const gpsKey = `q23-gps-${suffix}`;
    const gpsPayload = { username: `gps-${suffix}`, password: 'gps-secret' };
    const gpsFirst = await requestJson('/api/admin/gps-settings', {
      method: 'PUT',
      token: adminToken,
      idempotencyKey: gpsKey,
      body: gpsPayload,
      expectedUpdatedAt: gpsVersion,
    });
    const gpsReplay = await requestJson('/api/admin/gps-settings', {
      method: 'PUT',
      token: adminToken,
      idempotencyKey: gpsKey,
      body: gpsPayload,
      expectedUpdatedAt: gpsVersion,
    });
    const gpsConflict = await requestJson('/api/admin/gps-settings', {
      method: 'PUT',
      token: adminToken,
      idempotencyKey: gpsKey,
      body: { username: `gps-drift-${suffix}`, password: 'gps-secret' },
      expectedUpdatedAt: gpsVersion,
    });
    assert.equal(gpsFirst.status, 200);
    assert.equal(gpsReplay.body.replayed, true);
    assert.equal(gpsConflict.status, 409);

    const llmRead = await requestJson('/api/admin/llm-settings', { token: adminToken });
    const llmVersion = typeof llmRead.body.updatedAt === 'string' ? String(llmRead.body.updatedAt) : undefined;
    const llmForbidden = await requestJson('/api/admin/llm-settings', {
      method: 'PUT',
      token: managerToken,
      idempotencyKey: `q23-llm-forbidden-${suffix}`,
      body: { provider: 'minimax', minimaxApiKey: 'not-allowed' },
      expectedUpdatedAt: llmVersion,
    });
    assert.equal(llmForbidden.status, 403);

    const llmKey = `q23-llm-${suffix}`;
    const llmPayload = { provider: 'minimax', minimaxApiKey: `llm-${suffix}` };
    const llmFirst = await requestJson('/api/admin/llm-settings', {
      method: 'PUT',
      token: adminToken,
      idempotencyKey: llmKey,
      body: llmPayload,
      expectedUpdatedAt: llmVersion,
    });
    const llmReplay = await requestJson('/api/admin/llm-settings', {
      method: 'PUT',
      token: adminToken,
      idempotencyKey: llmKey,
      body: llmPayload,
      expectedUpdatedAt: llmVersion,
    });
    assert.equal(llmFirst.status, 200);
    assert.equal(llmReplay.body.replayed, true);

    const faqForbidden = await requestJson('/api/admin/faq-entries', {
      method: 'POST',
      token: managerToken,
      idempotencyKey: `q23-faq-forbidden-${suffix}`,
      body: { question: 'Forbidden?', answer: 'No.' },
    });
    assert.equal(faqForbidden.status, 403);

    const faqKey = `q23-faq-create-${suffix}`;
    const faqPayload = {
      question: `Q23 FAQ ${suffix}?`,
      answer: 'Answer',
      requiredTerms: ['phạt'],
    };
    const [faqCreateA, faqCreateB] = await Promise.all([
      requestJson('/api/admin/faq-entries', {
        method: 'POST',
        token: adminToken,
        idempotencyKey: faqKey,
        body: faqPayload,
      }),
      requestJson('/api/admin/faq-entries', {
        method: 'POST',
        token: adminToken,
        idempotencyKey: faqKey,
        body: faqPayload,
      }),
    ]);
    assert.equal(faqCreateA.status, 201);
    assert.equal(faqCreateB.status, 201);
    const faqEntry = (faqCreateA.body.entry ?? faqCreateB.body.entry) as Record<string, unknown>;
    const faqId = Number(faqEntry.id);
    createdFaqEntryIds.add(faqId);
    const faqVersion = String(faqEntry.updatedAt);

    const faqUpdateKey = `q23-faq-update-${suffix}`;
    const faqUpdate = await requestJson(`/api/admin/faq-entries/${faqId}`, {
      method: 'PUT',
      token: adminToken,
      idempotencyKey: faqUpdateKey,
      expectedUpdatedAt: faqVersion,
      body: { answer: 'Answer updated' },
    });
    const faqStale = await requestJson(`/api/admin/faq-entries/${faqId}`, {
      method: 'PUT',
      token: adminToken,
      idempotencyKey: `q23-faq-stale-${suffix}`,
      expectedUpdatedAt: faqVersion,
      body: { answer: 'Answer stale' },
    });
    assert.equal(faqUpdate.status, 200);
    assert.equal(faqStale.status, 409);

    const faqDeleteKey = `q23-faq-delete-${suffix}`;
    const faqDelete = await requestJson(`/api/admin/faq-entries/${faqId}`, {
      method: 'DELETE',
      token: adminToken,
      idempotencyKey: faqDeleteKey,
      expectedUpdatedAt: String((faqUpdate.body.entry as Record<string, unknown>).updatedAt),
    });
    const faqDeleteReplay = await requestJson(`/api/admin/faq-entries/${faqId}`, {
      method: 'DELETE',
      token: adminToken,
      idempotencyKey: faqDeleteKey,
      expectedUpdatedAt: String((faqUpdate.body.entry as Record<string, unknown>).updatedAt),
    });
    assert.equal(faqDelete.status, 200);
    assert.equal(faqDeleteReplay.body.replayed, true);
  });

  test('config custom routes and tire lifecycle enforce replay, version, and slot concurrency', async () => {
    const salaryDefaultRead = await requestJson('/api/salary-periods/default', { token: adminToken });
    const salaryDefaultBody = salaryDefaultRead.body ?? {};
    const salaryDefaultVersion = salaryDefaultBody && typeof salaryDefaultBody.updatedAt === 'string'
      ? String(salaryDefaultBody.updatedAt)
      : undefined;
    const salaryDefaultKey = `q23-salary-default-${suffix}`;
    const salaryDefaultPayload = { defaultStartDay: 26, defaultEndDay: 25 };
    const salaryDefaultFirst = await requestJson('/api/salary-periods/default', {
      method: 'PUT',
      token: adminToken,
      idempotencyKey: salaryDefaultKey,
      expectedUpdatedAt: salaryDefaultVersion,
      body: salaryDefaultPayload,
    });
    const salaryDefaultReplay = await requestJson('/api/salary-periods/default', {
      method: 'PUT',
      token: adminToken,
      idempotencyKey: salaryDefaultKey,
      expectedUpdatedAt: salaryDefaultVersion,
      body: salaryDefaultPayload,
    });
    assert.equal(salaryDefaultFirst.status, 201);
    assert.equal(salaryDefaultReplay.status, 200);
    assert.equal(salaryDefaultFirst.body.replayed, false);
    assert.equal(salaryDefaultReplay.body.replayed, true);
    expectPendingGovernance(salaryDefaultFirst.body);
    const salaryDefaultUnchanged = await requestJson('/api/salary-periods/default', { token: adminToken });
    assert.deepEqual(salaryDefaultUnchanged.body, salaryDefaultRead.body);
    const salaryDefaultChecked = await checkAction(
      Number(salaryDefaultFirst.body.id),
      Number(salaryDefaultFirst.body.version),
    );
    assert.equal(salaryDefaultChecked.status, 200);
    const salaryDefaultApproved = await approveAction(
      Number(salaryDefaultFirst.body.id),
      Number(salaryDefaultChecked.body.version),
    );
    assert.equal(salaryDefaultApproved.status, 200);
    const salaryDefaultAfterApproval = await requestJson('/api/salary-periods/default', { token: adminToken });
    assert.equal(salaryDefaultAfterApproval.body.defaultStartDay, salaryDefaultPayload.defaultStartDay);
    assert.equal(salaryDefaultAfterApproval.body.defaultEndDay, salaryDefaultPayload.defaultEndDay);

    const overrideKey = `q23-salary-override-${suffix}`;
    const overridePayload = {
      month: 12,
      year: 2099,
      startDate: '2099-11-26',
      endDate: '2099-12-25',
      label: `Q23 ${suffix}`,
    };
    const [overrideA, overrideB] = await Promise.all([
      requestJson('/api/salary-periods', {
        method: 'POST',
        token: adminToken,
        idempotencyKey: overrideKey,
        body: overridePayload,
      }),
      requestJson('/api/salary-periods', {
        method: 'POST',
        token: adminToken,
        idempotencyKey: overrideKey,
        body: overridePayload,
      }),
    ]);
    assert.deepEqual(
      [overrideA.status, overrideB.status].sort((left, right) => left - right),
      [200, 201],
    );
    assert.deepEqual(
      [overrideA.body.replayed, overrideB.body.replayed].sort(),
      [false, true],
    );
    const overrideCreateAction = overrideA.body.replayed ? overrideB.body : overrideA.body;
    expectPendingGovernance(overrideCreateAction);
    const overrideListBeforeApproval = await requestJson('/api/salary-periods', { token: adminToken });
    assert.equal(
      Array.isArray(overrideListBeforeApproval.body.items)
        ? overrideListBeforeApproval.body.items.some((item) => (
          item
          && typeof item === 'object'
          && item.month === overridePayload.month
          && item.year === overridePayload.year
        ))
        : false,
      false,
    );
    const overrideChecked = await checkAction(
      Number(overrideCreateAction.id),
      Number(overrideCreateAction.version),
    );
    assert.equal(overrideChecked.status, 200);
    const overrideApproved = await approveAction(
      Number(overrideCreateAction.id),
      Number(overrideChecked.body.version),
    );
    assert.equal(overrideApproved.status, 200);
    const overrideListAfterApproval = await requestJson('/api/salary-periods', { token: adminToken });
    const approvedOverride = Array.isArray(overrideListAfterApproval.body.items)
      ? overrideListAfterApproval.body.items.find((item) => (
        item
        && typeof item === 'object'
        && item.month === overridePayload.month
        && item.year === overridePayload.year
      ))
      : undefined;
    assert.ok(approvedOverride && typeof approvedOverride === 'object');
    const overrideId = Number(approvedOverride.id);
    createdSalaryOverrideIds.add(overrideId);
    const overrideVersion = String(approvedOverride.updatedAt);

    const overrideConflict = await requestJson('/api/salary-periods', {
      method: 'POST',
      token: adminToken,
      idempotencyKey: overrideKey,
      body: { ...overridePayload, label: `Drift ${suffix}` },
    });
    assert.equal(overrideConflict.status, 409);

    const overrideUpdateKey = `q23-salary-override-update-${suffix}`;
    const overrideUpdate = await requestJson(`/api/salary-periods/${overrideId}`, {
      method: 'PUT',
      token: adminToken,
      idempotencyKey: overrideUpdateKey,
      expectedUpdatedAt: overrideVersion,
      body: { ...overridePayload, label: `Q23 Updated ${suffix}` },
    });
    assert.equal(overrideUpdate.status, 201);
    expectPendingGovernance(overrideUpdate.body);
    const overrideUnchangedBeforeApproval = await requestJson('/api/salary-periods', { token: adminToken });
    const overrideBeforeUpdateApproval = Array.isArray(overrideUnchangedBeforeApproval.body.items)
      ? overrideUnchangedBeforeApproval.body.items.find((item) => (
        item
        && typeof item === 'object'
        && Number(item.id) === overrideId
      ))
      : undefined;
    assert.equal(overrideBeforeUpdateApproval?.label, overridePayload.label);
    const overrideUpdateChecked = await checkAction(Number(overrideUpdate.body.id), Number(overrideUpdate.body.version));
    assert.equal(overrideUpdateChecked.status, 200);
    const overrideUpdateApproved = await approveAction(
      Number(overrideUpdate.body.id),
      Number(overrideUpdateChecked.body.version),
    );
    assert.equal(overrideUpdateApproved.status, 200);
    const overrideListAfterUpdate = await requestJson('/api/salary-periods', { token: adminToken });
    const updatedOverride = Array.isArray(overrideListAfterUpdate.body.items)
      ? overrideListAfterUpdate.body.items.find((item) => (
        item
        && typeof item === 'object'
        && Number(item.id) === overrideId
      ))
      : undefined;
    assert.equal(updatedOverride?.label, `Q23 Updated ${suffix}`);

    const overrideDeleteKey = `q23-salary-override-delete-${suffix}`;
    const overrideDelete = await requestJson(`/api/salary-periods/${overrideId}`, {
      method: 'DELETE',
      token: adminToken,
      idempotencyKey: overrideDeleteKey,
      expectedUpdatedAt: String(updatedOverride?.updatedAt),
    });
    assert.equal(overrideDelete.status, 201);
    expectPendingGovernance(overrideDelete.body);
    const overrideStillPresent = await requestJson('/api/salary-periods', { token: adminToken });
    assert.equal(
      Array.isArray(overrideStillPresent.body.items)
        ? overrideStillPresent.body.items.some((item) => (
          item
          && typeof item === 'object'
          && Number(item.id) === overrideId
        ))
        : false,
      true,
    );
    const overrideDeleteChecked = await checkAction(Number(overrideDelete.body.id), Number(overrideDelete.body.version));
    assert.equal(overrideDeleteChecked.status, 200);
    const overrideDeleteApproved = await approveAction(
      Number(overrideDelete.body.id),
      Number(overrideDeleteChecked.body.version),
    );
    assert.equal(overrideDeleteApproved.status, 200);
    const overrideListAfterDelete = await requestJson('/api/salary-periods', { token: adminToken });
    assert.equal(
      Array.isArray(overrideListAfterDelete.body.items)
        ? overrideListAfterDelete.body.items.some((item) => (
          item
          && typeof item === 'object'
          && Number(item.id) === overrideId
        ))
        : false,
      false,
    );

    const templateKey = `q23-template-${suffix}`;
    const templatePayload = { name: `Q23 Template ${suffix}` };
    const [templateA, templateB] = await Promise.all([
      requestJson('/api/debit-note-templates', {
        method: 'POST',
        token: adminToken,
        idempotencyKey: templateKey,
        body: templatePayload,
      }),
      requestJson('/api/debit-note-templates', {
        method: 'POST',
        token: adminToken,
        idempotencyKey: templateKey,
        body: templatePayload,
      }),
    ]);
    assert.equal(templateA.status, 201);
    assert.equal(templateB.status, 201);
    assert.deepEqual(
      [templateA.body.replayed, templateB.body.replayed].sort(),
      [false, true],
    );
    const templateCreateAction = templateA.body.replayed ? templateB.body : templateA.body;
    expectPendingGovernance(templateCreateAction);
    const templateListBeforeApproval = await requestJson('/api/debit-note-templates', { token: adminToken });
    assert.equal(
      Array.isArray(templateListBeforeApproval.body.items)
        ? templateListBeforeApproval.body.items.some((item) => (
          item
          && typeof item === 'object'
          && item.name === templatePayload.name
        ))
        : false,
      false,
    );
    const templateChecked = await checkAction(
      Number(templateCreateAction.id),
      Number(templateCreateAction.version),
    );
    assert.equal(templateChecked.status, 200);
    const templateApproved = await approveAction(
      Number(templateCreateAction.id),
      Number(templateChecked.body.version),
    );
    assert.equal(templateApproved.status, 200);
    const templateListAfterApproval = await requestJson('/api/debit-note-templates', { token: adminToken });
    const approvedTemplate = Array.isArray(templateListAfterApproval.body.items)
      ? templateListAfterApproval.body.items.find((item) => (
        item
        && typeof item === 'object'
        && item.name === templatePayload.name
      ))
      : undefined;
    assert.ok(approvedTemplate && typeof approvedTemplate === 'object');
    const templateId = Number(approvedTemplate.id);
    createdDebitTemplateIds.add(templateId);
    const templateVersion = String(approvedTemplate.updatedAt);

    const templateConflict = await requestJson('/api/debit-note-templates', {
      method: 'POST',
      token: adminToken,
      idempotencyKey: templateKey,
      body: { name: `Q23 Template Drift ${suffix}` },
    });
    assert.equal(templateConflict.status, 409);

    const templateUpdateKey = `q23-template-update-${suffix}`;
    const templateUpdate = await requestJson(`/api/debit-note-templates/${templateId}`, {
      method: 'PUT',
      token: adminToken,
      idempotencyKey: templateUpdateKey,
      expectedUpdatedAt: templateVersion,
      body: { ...templatePayload, name: `Q23 Template Updated ${suffix}` },
    });
    assert.equal(templateUpdate.status, 200);
    expectPendingGovernance(templateUpdate.body);
    const templateBeforeUpdateApproval = await requestJson(`/api/debit-note-templates/${templateId}`, { token: adminToken });
    assert.equal(templateBeforeUpdateApproval.body.name, templatePayload.name);
    const templateUpdateChecked = await checkAction(Number(templateUpdate.body.id), Number(templateUpdate.body.version));
    assert.equal(templateUpdateChecked.status, 200);
    const templateUpdateApproved = await approveAction(
      Number(templateUpdate.body.id),
      Number(templateUpdateChecked.body.version),
    );
    assert.equal(templateUpdateApproved.status, 200);
    const templateAfterUpdate = await requestJson(`/api/debit-note-templates/${templateId}`, { token: adminToken });
    assert.equal(templateAfterUpdate.body.name, `Q23 Template Updated ${suffix}`);

    const templateDeleteKey = `q23-template-delete-${suffix}`;
    const templateDelete = await requestJson(`/api/debit-note-templates/${templateId}`, {
      method: 'DELETE',
      token: adminToken,
      idempotencyKey: templateDeleteKey,
      expectedUpdatedAt: String(templateAfterUpdate.body.updatedAt),
    });
    assert.equal(templateDelete.status, 200);
    expectPendingGovernance(templateDelete.body);
    const templateStillPresent = await requestJson(`/api/debit-note-templates/${templateId}`, { token: adminToken });
    assert.equal(templateStillPresent.status, 200);
    const templateDeleteChecked = await checkAction(Number(templateDelete.body.id), Number(templateDelete.body.version));
    assert.equal(templateDeleteChecked.status, 200);
    const templateDeleteApproved = await approveAction(
      Number(templateDelete.body.id),
      Number(templateDeleteChecked.body.version),
    );
    assert.equal(templateDeleteApproved.status, 200);
    const templateAfterDelete = await requestJson(`/api/debit-note-templates/${templateId}`, { token: adminToken });
    assert.equal(templateAfterDelete.status, 404);

    const [truck] = await db.insert(s.trucks).values({
      licensePlate: `51C${Date.now().toString().slice(-6)}`,
      status: 'ACTIVE',
    }).returning();
    createdTruckIds.add(truck.id);
    const [trailer] = await db.insert(s.trailers).values({
      licensePlate: `51R${Date.now().toString().slice(-6)}`,
      type: TrailerType.FT20,
      status: 'ACTIVE',
    }).returning();
    createdTrailerIds.add(trailer.id);
    const [tire] = await db.insert(s.tires).values({
      serial: `Q23-TIRE-${suffix}`,
      status: 'IN_STOCK',
      cost: '0',
    }).returning();
    createdTireIds.add(tire.id);

    const tireForbidden = await requestJson(`/api/fleet/tires/${tire.id}/install`, {
      method: 'POST',
      token: driverToken,
      idempotencyKey: `q23-tire-forbidden-${suffix}`,
      body: { truckId: truck.id, position: 'A1' },
      expectedUpdatedAt: tire.updatedAt.toISOString(),
    });
    assert.equal(tireForbidden.status, 403);

    const tireInstallKey = `q23-tire-install-${suffix}`;
    const tireInstallPayload = { truckId: truck.id, position: 'A1' };
    const tireInstallMissingVersion = await requestJson(`/api/fleet/tires/${tire.id}/install`, {
      method: 'POST',
      token: adminToken,
      idempotencyKey: `q23-tire-install-missing-version-${suffix}`,
      body: tireInstallPayload,
    });
    assert.equal(tireInstallMissingVersion.status, 428);

    const tireInstall = await requestJson(`/api/fleet/tires/${tire.id}/install`, {
      method: 'POST',
      token: adminToken,
      idempotencyKey: tireInstallKey,
      body: tireInstallPayload,
      expectedUpdatedAt: tire.updatedAt.toISOString(),
    });
    const tireInstallReplay = await requestJson(`/api/fleet/tires/${tire.id}/install`, {
      method: 'POST',
      token: adminToken,
      idempotencyKey: tireInstallKey,
      body: tireInstallPayload,
      expectedUpdatedAt: tire.updatedAt.toISOString(),
    });
    const tireInstallConflict = await requestJson(`/api/fleet/tires/${tire.id}/install`, {
      method: 'POST',
      token: adminToken,
      idempotencyKey: tireInstallKey,
      body: { truckId: truck.id, position: 'A2' },
      expectedUpdatedAt: tire.updatedAt.toISOString(),
    });
    assert.equal(tireInstall.status, 200);
    assert.equal(tireInstallReplay.body.replayed, true);
    assert.equal(tireInstallConflict.status, 409);

    const tireTransferMissingVersion = await requestJson(`/api/fleet/tires/${tire.id}/transfer`, {
      method: 'POST',
      token: adminToken,
      idempotencyKey: `q23-tire-transfer-missing-version-${suffix}`,
      body: { trailerId: trailer.id, position: 'B1' },
    });
    assert.equal(tireTransferMissingVersion.status, 428);

    const tireTransferStale = await requestJson(`/api/fleet/tires/${tire.id}/transfer`, {
      method: 'POST',
      token: adminToken,
      idempotencyKey: `q23-tire-transfer-stale-${suffix}`,
      body: { trailerId: trailer.id, position: 'B1' },
      expectedUpdatedAt: tire.updatedAt.toISOString(),
    });
    assert.equal(tireTransferStale.status, 409);

    const tireRemoveKey = `q23-tire-remove-${suffix}`;
    const tireRemoveMissingVersion = await requestJson(`/api/fleet/tires/${tire.id}/remove`, {
      method: 'POST',
      token: adminToken,
      idempotencyKey: `q23-tire-remove-missing-version-${suffix}`,
      body: {},
    });
    assert.equal(tireRemoveMissingVersion.status, 428);

    const tireRemove = await requestJson(`/api/fleet/tires/${tire.id}/remove`, {
      method: 'POST',
      token: adminToken,
      idempotencyKey: tireRemoveKey,
      expectedUpdatedAt: String(tireInstall.body.updatedAt),
      body: {},
    });
    const tireRemoveReplay = await requestJson(`/api/fleet/tires/${tire.id}/remove`, {
      method: 'POST',
      token: adminToken,
      idempotencyKey: tireRemoveKey,
      expectedUpdatedAt: String(tireInstall.body.updatedAt),
      body: {},
    });
    assert.equal(tireRemove.status, 200);
    assert.equal(tireRemoveReplay.body.replayed, true);

    const tireDisposeKey = `q23-tire-dispose-${suffix}`;
    const tireDisposeMissingVersion = await requestJson(`/api/fleet/tires/${tire.id}/dispose`, {
      method: 'POST',
      token: adminToken,
      idempotencyKey: `q23-tire-dispose-missing-version-${suffix}`,
      body: { reason: 'Mòn' },
    });
    assert.equal(tireDisposeMissingVersion.status, 428);

    const tireDispose = await requestJson(`/api/fleet/tires/${tire.id}/dispose`, {
      method: 'POST',
      token: adminToken,
      idempotencyKey: tireDisposeKey,
      expectedUpdatedAt: String(tireRemove.body.updatedAt),
      body: { reason: 'Mòn' },
    });
    assert.equal(tireDispose.status, 200);

    const concurrentTires = await db.insert(s.tires).values([
      { serial: `Q23-TIRE-RACE-A-${suffix}`, status: 'IN_STOCK', cost: '0' },
      { serial: `Q23-TIRE-RACE-B-${suffix}`, status: 'IN_STOCK', cost: '0' },
    ]).returning();
    concurrentTires.forEach((row) => createdTireIds.add(row.id));
    const [raceA, raceB] = await Promise.all(concurrentTires.map((row, index) =>
      requestJson(`/api/fleet/tires/${row.id}/install`, {
        method: 'POST',
        token: adminToken,
        idempotencyKey: `q23-tire-slot-race-${index}-${suffix}`,
        expectedUpdatedAt: row.updatedAt.toISOString(),
        body: { truckId: truck.id, position: 'RACE-SLOT' },
      })));
    assert.deepEqual(
      [raceA.status, raceB.status].sort((a, b) => a - b),
      [200, 409],
    );
  });
});

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });

  if (createdDebitTemplateIds.size > 0) {
    await db.delete(s.debitNoteTemplates).where(inArray(s.debitNoteTemplates.id, [...createdDebitTemplateIds]));
  }
  if (createdFaqEntryIds.size > 0) {
    await db.delete(s.faqEntries).where(inArray(s.faqEntries.id, [...createdFaqEntryIds]));
  }
  if (createdSalaryOverrideIds.size > 0) {
    await db.delete(s.salaryPeriods).where(inArray(s.salaryPeriods.id, [...createdSalaryOverrideIds]));
  }
  if (originalSalaryDefault) {
    const [currentDefault] = await db.select().from(s.salaryPeriods)
      .where(eq(s.salaryPeriods.isDefault, true))
      .limit(1);
    if (currentDefault) {
      await db.update(s.salaryPeriods).set({
        defaultStartDay: originalSalaryDefault.defaultStartDay,
        defaultEndDay: originalSalaryDefault.defaultEndDay,
        month: originalSalaryDefault.month,
        year: originalSalaryDefault.year,
        startDate: originalSalaryDefault.startDate,
        endDate: originalSalaryDefault.endDate,
        label: originalSalaryDefault.label,
        updatedAt: new Date(),
      }).where(eq(s.salaryPeriods.id, currentDefault.id));
    }
  } else {
    await db.delete(s.salaryPeriods).where(eq(s.salaryPeriods.isDefault, true));
  }
  if (createdTireIds.size > 0) {
    await db.delete(s.tires).where(inArray(s.tires.id, [...createdTireIds]));
  }
  if (createdTrailerIds.size > 0) {
    await db.delete(s.trailers).where(inArray(s.trailers.id, [...createdTrailerIds]));
  }
  if (createdTruckIds.size > 0) {
    await db.delete(s.trucks).where(inArray(s.trucks.id, [...createdTruckIds]));
  }
  if (createdBusinessUnitIds.size > 0) {
    await db.delete(s.businessUnits).where(inArray(s.businessUnits.id, [...createdBusinessUnitIds]));
  }
  if (idempotencyKeys.size > 0) {
    await db.delete(s.idempotencyKeys)
      .where(inArray(s.idempotencyKeys.idempotencyKey, [...idempotencyKeys]));
  }
  if (createdUserIds.size > 0) {
    await db.delete(s.governanceActions)
      .where(inArray(s.governanceActions.makerId, [...createdUserIds]));
    const userIds = [...createdUserIds];
    await db.delete(s.userShipmentLinks).where(inArray(s.userShipmentLinks.userId, userIds));
    await db.delete(s.userBusinessUnitLinks).where(inArray(s.userBusinessUnitLinks.userId, userIds));
    await db.delete(s.userCustomerLinks).where(inArray(s.userCustomerLinks.userId, userIds));
    await db.delete(s.drivers).where(inArray(s.drivers.userId, userIds));
    await db.delete(s.users).where(inArray(s.users.id, userIds));
  }

  await saveAppSettings(originalAppSettings);
  await restorePrefix('gps.%', originalGpsRows);
  await restorePrefix('llm.%', originalLlmRows);
  invalidateGpsSettings();
  invalidatePortalSession();
  invalidateGpsProvider();
  invalidateLlmSettings();
  invalidateActiveProvider();

  await disconnectRedis();
  await client.end();
});
