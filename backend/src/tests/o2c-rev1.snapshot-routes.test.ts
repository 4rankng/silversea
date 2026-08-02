import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { eq, inArray, sql } from 'drizzle-orm';
import { Role } from '@tingting/shared';

import { db, client } from '../db';
import * as s from '../db/schema';
import { config } from '../config';
import { initEnforcer } from '../casbin/enforcer';
import { authMiddleware } from '../middleware/auth';
import { auditLogMiddleware } from '../middleware/audit';
import { casbinAuthz } from '../middleware/casbin';
import { globalErrorHandler } from '../middleware/errorHandler';
import financialRoutes from '../routes/financial';
import { initAuditService } from '../services/audit.service';
import { initNotificationService } from '../services/notification.service';
import { ArSnapshotService } from '../services/ar-snapshot.service';
import { lockTripFinancialAuthority } from '../services/trip-financial-authority-lock.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdUserIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdSupplierIds: number[] = [];
const createdRouteIds: number[] = [];
const createdCargoTypeIds: number[] = [];
const createdTripIds: number[] = [];
const createdExpenseIds: number[] = [];
const createdAuditLogIds: number[] = [];

let accountantToken: string;
let accountantUserId: number;
let server: http.Server;
let baseUrl: string;

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
    { userId: user.id, username: user.username ?? `${user.id}`, role: user.role as Role },
    config.jwtSecret,
  );
}

async function createDirtyTrip() {
  const fixtureSuffix = `${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const [customer] = await db.insert(s.customers)
    .values({ name: `O2C snapshot route customer ${fixtureSuffix}` })
    .returning();
  const [supplier] = await db.insert(s.suppliers)
    .values({ name: `O2C snapshot route supplier ${fixtureSuffix}` })
    .returning();
  const [route] = await db.insert(s.routes)
    .values({ name: `O2C snapshot route ${fixtureSuffix}` })
    .returning();
  const [cargoType] = await db.insert(s.cargoTypes)
    .values({ name: `O2C snapshot route cargo ${fixtureSuffix}` })
    .returning();
  createdCustomerIds.push(customer.id);
  createdSupplierIds.push(supplier.id);
  createdRouteIds.push(route.id);
  createdCargoTypeIds.push(cargoType.id);

  const [trip] = await db.insert(s.trips).values({
    tripCode: `AP-ROUTE-${fixtureSuffix}`.slice(0, 50),
    customerId: customer.id,
    routeId: route.id,
    cargoTypeId: cargoType.id,
    status: 'COMPLETED',
    departureDate: '2026-08-02',
    completedAt: new Date(),
    carrierType: 'OWN',
    revenue: '2000000',
    arCostHash: null,
    arSnapshotDirty: true,
    arSnapshotChangedAt: new Date(),
    apCostHash: null,
    apSnapshotDirty: true,
    apSnapshotChangedAt: new Date(),
  }).returning();
  createdTripIds.push(trip.id);

  const [expense] = await db.insert(s.tripExpenses).values({
    tripId: trip.id,
    expenseType: 'CHI_HO',
    buyAmount: '150000',
    sellAmount: '180000',
    settlementMethod: 'COMPANY_DIRECT',
    supplierId: supplier.id,
    approvalStatus: 'APPROVED',
  }).returning();
  createdExpenseIds.push(expense.id);

  return { trip };
}

async function waitForAudit(path: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const rows = await db.select({
      id: s.auditLogs.id,
      event: sql<string>`${s.auditLogs.payload}->>'event'`,
      path: sql<string>`${s.auditLogs.payload}->>'path'`,
      statusCode: sql<number>`coalesce((${s.auditLogs.payload}->>'statusCode')::int, 0)`,
    }).from(s.auditLogs)
      .where(eq(s.auditLogs.userId, accountantUserId))
      .orderBy(s.auditLogs.id);
    for (const row of rows) {
      if (!createdAuditLogIds.includes(row.id)) createdAuditLogIds.push(row.id);
    }
    const match = rows.find((row) => row.path === path);
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}

before(async () => {
  const columns = await db.execute(sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'trips'
      AND column_name IN ('ap_cost_hash', 'ap_snapshot_dirty', 'ap_snapshot_changed_at')
  `);
  assert.equal(columns.length, 3, 'Phase 4 trip AP snapshot columns are missing in the dev DB');

  initNotificationService();
  initAuditService();
  await initEnforcer();

  const app = express();
  app.use(express.json());
  app.use('/api', authMiddleware, auditLogMiddleware, casbinAuthz('financial'), financialRoutes);
  app.use(globalErrorHandler);

  await new Promise<void>((resolve) => {
    server = http.createServer(app);
    server.listen(0, () => {
      baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });

  const accountant = await mkUser(`o2c-snapshot-accountant-${suffix}`, Role.ACCOUNTANT);
  accountantUserId = accountant.id;
  accountantToken = sign(accountant);
});

after(async () => {
  if (createdUserIds.length > 0) {
    await db.delete(s.idempotencyKeys).where(inArray(s.idempotencyKeys.createdBy, createdUserIds));
  }
  if (createdAuditLogIds.length > 0) {
    await db.delete(s.auditLogs).where(inArray(s.auditLogs.id, createdAuditLogIds));
  }
  if (createdTripIds.length > 0) {
    await db.delete(s.governanceActions).where(inArray(s.governanceActions.subjectId, createdTripIds));
    await db.delete(s.ledger).where(inArray(s.ledger.txnId, [...createdTripIds, ...createdExpenseIds]));
  }
  if (createdExpenseIds.length > 0) {
    await db.delete(s.tripExpenses).where(inArray(s.tripExpenses.id, createdExpenseIds));
  }
  if (createdTripIds.length > 0) {
    await db.delete(s.tripFinancialPostings).where(inArray(s.tripFinancialPostings.tripId, createdTripIds));
    await db.delete(s.profitabilitySnapshots).where(inArray(s.profitabilitySnapshots.tripId, createdTripIds));
    await db.delete(s.tripPhotos).where(inArray(s.tripPhotos.tripId, createdTripIds));
    await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
  }
  if (createdUserIds.length > 0) {
    await db.delete(s.notifications).where(inArray(s.notifications.userId, createdUserIds));
    await db.delete(s.auditLogs).where(inArray(s.auditLogs.userId, createdUserIds));
    await db.delete(s.users).where(inArray(s.users.id, createdUserIds));
  }
  if (createdSupplierIds.length > 0) {
    await db.delete(s.suppliers).where(inArray(s.suppliers.id, createdSupplierIds));
  }
  if (createdCustomerIds.length > 0) {
    await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
  }
  if (createdRouteIds.length > 0) {
    await db.delete(s.routes).where(inArray(s.routes.id, createdRouteIds));
  }
  if (createdCargoTypeIds.length > 0) {
    await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, createdCargoTypeIds));
  }
  server.closeAllConnections();
  server.close();
  await client.end();
});

describe('financial snapshot routes', () => {
  test('AR recapture validates lifecycle, replays exactly, and is audited', async () => {
    const missingRes = await fetch(`${baseUrl}/api/finance/snapshots/ar/2147483647/recapture`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accountantToken}`,
        'Idempotency-Key': 'ar-recapture-missing',
      },
    });
    assert.equal(missingRes.status, 404);

    const { trip: nonCompletedTrip } = await createDirtyTrip();
    await db.update(s.trips).set({ status: 'IN_TRANSIT' }).where(eq(s.trips.id, nonCompletedTrip.id));
    const invalidLifecycleRes = await fetch(`${baseUrl}/api/finance/snapshots/ar/${nonCompletedTrip.id}/recapture`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accountantToken}`,
        'Idempotency-Key': `ar-recapture-invalid-${nonCompletedTrip.id}`,
      },
    });
    assert.equal(invalidLifecycleRes.status, 409);

    const { trip } = await createDirtyTrip();
    const path = `/api/finance/snapshots/ar/${trip.id}/recapture`;
    const idempotencyKey = `ar-recapture-${trip.id}`;
    const recaptureRes = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accountantToken}`,
        'Idempotency-Key': idempotencyKey,
      },
    });
    assert.equal(recaptureRes.status, 200);
    assert.equal((await recaptureRes.json() as { replayed: boolean }).replayed, false);
    const [captured] = await db.select({
      arCostHash: s.trips.arCostHash,
      arSnapshotDirty: s.trips.arSnapshotDirty,
      arSnapshotChangedAt: s.trips.arSnapshotChangedAt,
    }).from(s.trips).where(eq(s.trips.id, trip.id)).limit(1);
    assert.ok(captured?.arCostHash);
    assert.equal(captured?.arSnapshotDirty, false);

    const replayRes = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accountantToken}`,
        'Idempotency-Key': idempotencyKey,
      },
    });
    assert.equal(replayRes.status, 200);
    assert.equal((await replayRes.json() as { replayed: boolean }).replayed, true);
    const [replayed] = await db.select({
      arSnapshotChangedAt: s.trips.arSnapshotChangedAt,
    }).from(s.trips).where(eq(s.trips.id, trip.id)).limit(1);
    assert.equal(replayed?.arSnapshotChangedAt?.toISOString(), captured?.arSnapshotChangedAt?.toISOString());

    const auditRow = await waitForAudit(path);
    assert.equal(auditRow?.event, 'ENTITY_UPDATED');
    assert.equal(auditRow?.statusCode, 200);
  });

  test('AR recapture serializes behind a financial edit and captures its final hash', async () => {
    const { trip } = await createDirtyTrip();
    let releaseMutation!: () => void;
    let signalLocked!: () => void;
    const mutationGate = new Promise<void>((resolve) => { releaseMutation = resolve; });
    const lockAcquired = new Promise<void>((resolve) => { signalLocked = resolve; });
    const mutation = db.transaction(async (tx) => {
      await lockTripFinancialAuthority(tx, [trip.id]);
      await tx.update(s.trips).set({ totalCost: '765432' }).where(eq(s.trips.id, trip.id));
      await ArSnapshotService.markDirty(trip.id, tx);
      signalLocked();
      await mutationGate;
    });
    await lockAcquired;

    let recaptureSettled = false;
    const recapture = fetch(`${baseUrl}/api/finance/snapshots/ar/${trip.id}/recapture`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accountantToken}`,
        'Idempotency-Key': `ar-recapture-race-${trip.id}`,
      },
    }).finally(() => { recaptureSettled = true; });
    await new Promise((resolve) => setTimeout(resolve, 75));
    assert.equal(recaptureSettled, false, 'recapture must wait for the financial-authority lock');

    releaseMutation();
    await mutation;
    const recaptureRes = await recapture;
    assert.equal(recaptureRes.status, 200);
    const [captured] = await db.select({
      arCostHash: s.trips.arCostHash,
      arSnapshotDirty: s.trips.arSnapshotDirty,
    }).from(s.trips).where(eq(s.trips.id, trip.id)).limit(1);
    assert.ok(captured?.arCostHash);
    assert.equal(captured?.arSnapshotDirty, false);

    await ArSnapshotService.markDirty(trip.id, db);
    const [verified] = await db.select({
      arCostHash: s.trips.arCostHash,
      arSnapshotDirty: s.trips.arSnapshotDirty,
    }).from(s.trips).where(eq(s.trips.id, trip.id)).limit(1);
    assert.equal(verified?.arCostHash, captured?.arCostHash);
    assert.equal(verified?.arSnapshotDirty, false, 'captured hash must match the serialized final cost state');
  });

  test('lists dirty AP trips and recapture writes an audited ENTITY_UPDATED event', async () => {
    const { trip } = await createDirtyTrip();

    const listRes = await fetch(`${baseUrl}/api/finance/snapshots/ap/dirty`, {
      headers: { Authorization: `Bearer ${accountantToken}` },
    });
    assert.equal(listRes.status, 200);
    const listData = await listRes.json() as Array<{ id: number }>;
    assert.ok(listData.some((row) => row.id === trip.id), 'dirty AP trip should be listed');

    const recaptureRes = await fetch(`${baseUrl}/api/finance/snapshots/ap/${trip.id}/recapture`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accountantToken}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `ap-recapture-${trip.id}`,
      },
    });
    assert.equal(recaptureRes.status, 200);
    const recaptureData = await recaptureRes.json() as { replayed: boolean };
    assert.equal(recaptureData.replayed, false);

    const [updated] = await db.select({
      apCostHash: s.trips.apCostHash,
      apSnapshotDirty: s.trips.apSnapshotDirty,
      apSnapshotChangedAt: s.trips.apSnapshotChangedAt,
    }).from(s.trips).where(eq(s.trips.id, trip.id)).limit(1);
    assert.ok(updated?.apCostHash, 'recapture should persist an AP hash');
    assert.equal(updated?.apSnapshotDirty, false);

    const replayRes = await fetch(`${baseUrl}/api/finance/snapshots/ap/${trip.id}/recapture`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accountantToken}`,
        'Idempotency-Key': `ap-recapture-${trip.id}`,
      },
    });
    assert.equal(replayRes.status, 200);
    const replayData = await replayRes.json() as { replayed: boolean };
    assert.equal(replayData.replayed, true);
    const [replayedTrip] = await db.select({
      apSnapshotChangedAt: s.trips.apSnapshotChangedAt,
    }).from(s.trips).where(eq(s.trips.id, trip.id)).limit(1);
    assert.equal(
      replayedTrip?.apSnapshotChangedAt?.toISOString(),
      updated?.apSnapshotChangedAt?.toISOString(),
      'replay must not recapture the snapshot a second time',
    );

    const auditPath = `/api/finance/snapshots/ap/${trip.id}/recapture`;
    const auditRow = await waitForAudit(auditPath);
    assert.ok(auditRow, 'recapture should be audited');
    assert.equal(auditRow?.event, 'ENTITY_UPDATED');
    assert.equal(auditRow?.statusCode, 200);
  });

  test('AP recapture rejects missing and non-completed trips with domain status codes', async () => {
    const missingRes = await fetch(`${baseUrl}/api/finance/snapshots/ap/2147483647/recapture`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accountantToken}`,
        'Idempotency-Key': 'ap-recapture-missing',
      },
    });
    assert.equal(missingRes.status, 404);

    const { trip } = await createDirtyTrip();
    await db.update(s.trips).set({ status: 'IN_TRANSIT' }).where(eq(s.trips.id, trip.id));
    const invalidLifecycleRes = await fetch(`${baseUrl}/api/finance/snapshots/ap/${trip.id}/recapture`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accountantToken}`,
        'Idempotency-Key': `ap-recapture-invalid-${trip.id}`,
      },
    });
    assert.equal(invalidLifecycleRes.status, 409);
  });

  test('lists and audited-recaptures dirty fuel-surcharge snapshots', async () => {
    const { trip } = await createDirtyTrip();
    await db.update(s.trips).set({
      fuelLiters: '100',
      fuelSurchargeSnapshotDirty: true,
      fuelSurchargeSnapshot: {
        currentFuelPrice: 1,
        baseFuelPrice: 1,
        quotaLiters: 100,
        customerSharePct: 1,
        customerId: trip.customerId,
        computedAt: new Date(0).toISOString(),
      },
    }).where(eq(s.trips.id, trip.id));

    const listRes = await fetch(`${baseUrl}/api/finance/snapshots/fuel-surcharge/dirty`, {
      headers: { Authorization: `Bearer ${accountantToken}` },
    });
    assert.equal(listRes.status, 200);
    const listData = await listRes.json() as Array<{ id: number }>;
    assert.ok(listData.some((row) => row.id === trip.id));

    const path = `/api/finance/snapshots/fuel-surcharge/${trip.id}/recapture`;
    const recaptureRes = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accountantToken}`,
        'Idempotency-Key': `fuel-recapture-${trip.id}`,
      },
    });
    assert.equal(recaptureRes.status, 200);
    const [updated] = await db.select({
      fuelSurchargeSnapshot: s.trips.fuelSurchargeSnapshot,
      fuelSurchargeSnapshotDirty: s.trips.fuelSurchargeSnapshotDirty,
    }).from(s.trips).where(eq(s.trips.id, trip.id)).limit(1);
    assert.equal(updated?.fuelSurchargeSnapshotDirty, false);
    assert.notEqual(updated?.fuelSurchargeSnapshot?.computedAt, new Date(0).toISOString());

    const auditRow = await waitForAudit(path);
    assert.equal(auditRow?.event, 'ENTITY_UPDATED');
    assert.equal(auditRow?.statusCode, 200);
  });

  test('fuel-surcharge recapture rejects a changed amount and preserves the dirty snapshot', async () => {
    const { trip } = await createDirtyTrip();
    const historicalComputedAt = new Date(0).toISOString();
    await db.update(s.trips).set({
      fuelLiters: '100',
      fuelSurchargeAmount: '999999',
      fuelSurchargeSnapshotDirty: true,
      fuelSurchargeSnapshot: {
        currentFuelPrice: 1,
        baseFuelPrice: 1,
        quotaLiters: 100,
        customerSharePct: 1,
        customerId: trip.customerId,
        computedAt: historicalComputedAt,
      },
    }).where(eq(s.trips.id, trip.id));

    const recaptureRes = await fetch(
      `${baseUrl}/api/finance/snapshots/fuel-surcharge/${trip.id}/recapture`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accountantToken}`,
          'Idempotency-Key': `fuel-recapture-changed-${trip.id}`,
        },
      },
    );
    assert.equal(recaptureRes.status, 409);
    const [unchanged] = await db.select({
      fuelSurchargeAmount: s.trips.fuelSurchargeAmount,
      fuelSurchargeSnapshot: s.trips.fuelSurchargeSnapshot,
      fuelSurchargeSnapshotDirty: s.trips.fuelSurchargeSnapshotDirty,
    }).from(s.trips).where(eq(s.trips.id, trip.id)).limit(1);
    assert.equal(unchanged?.fuelSurchargeAmount, '999999');
    assert.equal(unchanged?.fuelSurchargeSnapshot?.computedAt, historicalComputedAt);
    assert.equal(unchanged?.fuelSurchargeSnapshotDirty, true);
  });
});
