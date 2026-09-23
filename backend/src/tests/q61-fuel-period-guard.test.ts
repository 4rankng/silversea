// Card 20260922_61 RBAC follow-up (QA rung): the fuel-period entry is the
// ACCOUNTANT's (ruling 8) — the route guard gains ACCOUNTANT next to ADMIN,
// matching the decide endpoint. Ketoan must be able to POST a period.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { eq, inArray, sql } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { Role } from '@tingting/shared';
import { config } from '../config';
import { initEnforcer } from '../casbin/enforcer';
import { authMiddleware } from '../middleware/auth';
import { casbinAuthz } from '../middleware/casbin';
import catalogRouter from '../routes/config/catalog-crud.routes';
import { globalErrorHandler } from '../middleware/errorHandler';
import { disconnectRedis } from '../lib/redis';

const suffix = `${Date.now()}-q61guard`;
const createdUserIds: number[] = [];
const createdPeriodIds: number[] = [];
let server: http.Server;
let baseUrl: string;
let adminToken: string;
let accountantToken: string;
let dispatcherToken: string;

function sign(user: { id: number; username: string | null; role: Role | string }) {
  return jwt.sign(
    { userId: user.id, username: user.username ?? `user-${user.id}`, role: user.role as Role },
    config.jwtSecret,
  );
}

async function mkUser(username: string, role: Role) {
  const [user] = await db.insert(s.users).values({
    username, passwordHash: await bcrypt.hash('Abc123', 10), role, status: 'ACTIVE',
  }).returning();
  createdUserIds.push(user.id);
  return user;
}

function request(path: string, init: { method?: string; token: string; body?: unknown; idempotencyKey?: string }) {
  return fetch(`${baseUrl}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${init.token}`,
      'Content-Type': 'application/json',
      ...(init.idempotencyKey ? { 'Idempotency-Key': init.idempotencyKey } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
}

before(async () => {
  // Purge any orphan left at this run's fixture date by an earlier run (its
  // approvals reference the period, so clear them first).
  const fixtureDate = new Date(Date.now() + 200 * 86_400_000).toISOString().slice(0, 10);
  await db.delete(s.quotationFuelApprovals).where(
    inArray(s.quotationFuelApprovals.fuelPricePeriodId,
      db.select({ id: s.fuelPricePeriods.id }).from(s.fuelPricePeriods)
        .where(eq(s.fuelPricePeriods.effectiveFrom, fixtureDate))),
  );
  await db.delete(s.fuelPricePeriods).where(eq(s.fuelPricePeriods.effectiveFrom, fixtureDate));
  await initEnforcer();
  const app = express();
  app.use(express.json());
  app.use('/api', authMiddleware, casbinAuthz('config'), catalogRouter);
  app.use(globalErrorHandler);
  await new Promise<void>((resolve) => {
    server = http.createServer(app);
    server.listen(0, () => {
      baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
  adminToken = sign(await mkUser(`q61g-admin-${suffix}`, Role.ADMIN));
  accountantToken = sign(await mkUser(`q61g-ketoan-${suffix}`, Role.ACCOUNTANT));
  dispatcherToken = sign(await mkUser(`q61g-dieuvan-${suffix}`, Role.DISPATCHER));
});

describe('fuel-period entry guard (card 20260922_61 RBAC)', () => {
  test('ketoan (ACCOUNTANT) can POST a fuel period', async () => {
    const response = await request('/api/fuel-price-periods', {
      method: 'POST',
      token: accountantToken,
      idempotencyKey: `q61g-${suffix}-1`,
      body: { unitPrice: 29940, effectiveFrom: new Date(Date.now() + 200 * 86_400_000).toISOString().slice(0, 10) },
    });
    if (response.status !== 201) {
      const body = await response.clone().text();
      console.log('[q61g-debug] ketoan POST status:', response.status, 'body:', body.slice(0, 200));
    }
    assert.equal(response.status, 201);
    const body = await response.json() as { id: number };
    createdPeriodIds.push(body.id);
  });

  test('DISPATCHER is rejected from period entry', async () => {
    const response = await request('/api/fuel-price-periods', {
      method: 'POST',
      token: dispatcherToken,
      idempotencyKey: `q61g-${suffix}-2`,
      body: { unitPrice: 29940, effectiveFrom: '2026-10-12' },
    });
    assert.equal(response.status, 403);
  });
});

after(async () => {
  try {
    // Spawn's approval rows reference the periods — clear them FIRST or the
    // FK blocks the period delete and orphans accumulate across runs.
    const fixtureDate = new Date(Date.now() + 200 * 86_400_000).toISOString().slice(0, 10);
    await db.delete(s.quotationFuelApprovals).where(
      inArray(s.quotationFuelApprovals.fuelPricePeriodId,
        db.select({ id: s.fuelPricePeriods.id }).from(s.fuelPricePeriods)
          .where(eq(s.fuelPricePeriods.effectiveFrom, fixtureDate))),
    );
    await db.delete(s.fuelPricePeriods).where(eq(s.fuelPricePeriods.effectiveFrom, fixtureDate));
    await db.delete(s.users).where(inArray(s.users.id, createdUserIds));
  } catch { /* best-effort */ }
  server?.close();
  await client.end();
  await disconnectRedis();
});
