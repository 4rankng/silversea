import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import type { AddressInfo } from 'net';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { db, client } from '../db';
import * as s from '../db/schema';
import { eq, and, inArray, isNull } from 'drizzle-orm';
import { Role, TripStatus, FuelMode, LoadingType } from '@tingting/shared';
import { config } from '../config';
import { initEnforcer } from '../casbin/enforcer';
import { initAuditService } from '../services/audit.service';
import { cacheInvalidate, disconnectRedis } from '../lib/redis';


// Import route handlers directly to avoid port conflicts
import authRoutes from '../routes/auth';
import configRoutes from '../routes/config';
import tripRoutes from '../routes/trips';
import financialRoutes from '../routes/financial';
import driverRoutes from '../routes/driver';
import { authMiddleware } from '../middleware/auth';
import { casbinAuthz } from '../middleware/casbin';
import { globalErrorHandler } from '../middleware/errorHandler';

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/driver/me', authMiddleware, casbinAuthz('driver_portal'), driverRoutes);
app.use('/api/trips', authMiddleware, casbinAuthz('trips'), tripRoutes);
app.use('/api', authMiddleware, casbinAuthz('config'), configRoutes);
app.use('/api', authMiddleware, casbinAuthz('financial'), financialRoutes);
app.use(globalErrorHandler);

let server: http.Server;
let baseUrl: string;

let adminToken: string;
let managerToken: string;
let accountantToken: string;
let driverToken: string;

let customerId: number;
let driverId: number;
let truckId: number;
let routeId: number;
let cargoTypeId: number;
let containerTypeId: number;
let adminUserId: number;
let tripId: number;
let allTrucks: typeof s.trucks.$inferSelect[];
let allDrivers: typeof s.drivers.$inferSelect[];

before(async () => {
  await initAuditService();
  await initEnforcer();

  await new Promise<void>((resolve) => {
    server = http.createServer(app);
    server.listen(0, () => {
      const address = server.address() as AddressInfo;
      baseUrl = `http://localhost:${address.port}`;
      resolve();
    });
  });

  // Seed data — create missing entities (fresh CI DB has no data)
  let [adm] = await db.select().from(s.users).where(eq(s.users.username, 'admin')).limit(1);
  if (!adm) {
    [adm] = await db.insert(s.users).values({
      username: 'admin', passwordHash: await bcrypt.hash('admin123', 10), role: Role.ADMIN,
    }).returning();
  }
  let [drvUser] = await db.select().from(s.users).where(eq(s.users.username, 'laixe')).limit(1);
  if (!drvUser) {
    [drvUser] = await db.insert(s.users).values({
      username: 'laixe', passwordHash: await bcrypt.hash('laixe123', 10), role: Role.DRIVER,
    }).returning();
  }
  let [mgrUser] = await db.select().from(s.users).where(eq(s.users.username, 'giamdoc')).limit(1);
  if (!mgrUser) {
    [mgrUser] = await db.insert(s.users).values({
      username: 'giamdoc', passwordHash: await bcrypt.hash('manager123', 10), role: Role.MANAGER,
    }).returning();
  }
  let [acctUser] = await db.select().from(s.users).where(eq(s.users.username, 'ketoan')).limit(1);
  if (!acctUser) {
    [acctUser] = await db.insert(s.users).values({
      username: 'ketoan', passwordHash: await bcrypt.hash('accountant123', 10), role: Role.ACCOUNTANT,
    }).returning();
  }

  let [cust] = await db.select().from(s.customers).limit(1);
  if (!cust) {
    [cust] = await db.insert(s.customers).values({ name: 'Khách hàng E2E' }).returning();
  }
  let [rte] = await db.select().from(s.routes).limit(1);
  if (!rte) {
    [rte] = await db.insert(s.routes).values({ name: 'Hà Nội - Hải Phòng' }).returning();
  }
  let [crg] = await db.select().from(s.cargoTypes).limit(1);
  if (!crg) {
    [crg] = await db.insert(s.cargoTypes).values({ name: 'Hàng khô' }).returning();
  }
  const [fuel] = await db.select().from(s.fuelConfig).limit(1);
  if (!fuel) {
    await db.insert(s.fuelConfig).values({ loadedNorm: '43', emptyNorm: '25', unitPrice: '25000' });
  }
  await cacheInvalidate('config:fuel');
  const [containerType] = await db.select().from(s.containerTypes).limit(1);
  if (!containerType) {
    const [created] = await db.insert(s.containerTypes).values({ code: '40HC', name: "40'HC" }).returning();
    containerTypeId = created.id;
  } else {
    containerTypeId = containerType.id;
  }
  let [trck] = await db.select().from(s.trucks).limit(1);
  if (!trck) {
    [trck] = await db.insert(s.trucks).values({ licensePlate: '51C-12345' }).returning();
  }
  let [drvr] = await db.select().from(s.drivers).where(eq(s.drivers.userId, drvUser.id)).limit(1);
  if (!drvr) {
    [drvr] = await db.insert(s.drivers).values({ name: 'Lái xe E2E', userId: drvUser.id }).returning();
  }

  customerId = cust.id;
  routeId = rte.id;
  cargoTypeId = crg.id;
  adminUserId = adm.id;

  // Cancel stale IN_TRANSIT trips left from previous test runs / seed data
  // so that free trucks/drivers are always available for this test run.
  await db.update(s.trips)
    .set({ status: TripStatus.CANCELED, updatedAt: new Date() })
    .where(eq(s.trips.status, TripStatus.IN_TRANSIT));

  const activeTrips = await db.select({ truckId: s.trips.truckId, driverId: s.trips.driverId })
    .from(s.trips).where(eq(s.trips.status, TripStatus.IN_TRANSIT));
  const busyTrucks = new Set(activeTrips.map((t) => t.truckId));
  const busyDrivers = new Set(activeTrips.map((t) => t.driverId));
  allTrucks = await db.select().from(s.trucks).where(isNull(s.trucks.deletedAt));
  allDrivers = await db.select().from(s.drivers).where(isNull(s.drivers.deletedAt));
  const freeTruck = allTrucks.find(t => !busyTrucks.has(t.id));
  const freeDriver = allDrivers.find(d => !busyDrivers.has(d.id));
  truckId = freeTruck?.id ?? trck.id;
  driverId = freeDriver?.id ?? drvr.id;

  adminToken = jwt.sign({ userId: adm.id, username: adm.username, role: Role.ADMIN }, config.jwtSecret);
  managerToken = jwt.sign({ userId: mgrUser.id, username: mgrUser.username, role: Role.MANAGER }, config.jwtSecret);
  accountantToken = jwt.sign({ userId: acctUser.id, username: acctUser.username, role: Role.ACCOUNTANT }, config.jwtSecret);
  driverToken = jwt.sign({ userId: drvUser.id, username: drvUser.username, role: Role.DRIVER }, config.jwtSecret);
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await client.end();
  await disconnectRedis();
});

interface TestFetchOptions {
  method?: string;
  body?: string;
  token?: string;
  headers?: Record<string, string>;
}

async function testFetch(urlPath: string, options: TestFetchOptions = {}) {
  const { method, body, token, headers: optHeaders } = options;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...optHeaders,
  };
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    body,
    headers,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 1: Authentication & User Accounts (All Buttons & Guards)
// ─────────────────────────────────────────────────────────────────────────────
test('E2E — Auth flow (Login, Me, User List, Create, Delete)', async () => {
  // Test 1.1: Authentication credentials validation
  const loginRes = await testFetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier: 'admin', password: 'admin123' })
  });
  assert.strictEqual(loginRes.status, 200);
  assert.ok(loginRes.data.token);
  assert.equal(Object.hasOwn(loginRes.data.user, 'workflowRolloutMode'), false);

  // Test 1.2: Authenticated /me profile fetching
  const meRes = await testFetch('/api/auth/me', { token: adminToken });
  assert.strictEqual(meRes.status, 200);
  assert.strictEqual(meRes.data.username, 'admin');
  assert.equal(Object.hasOwn(meRes.data, 'workflowRolloutMode'), false);

  // Test 1.3: User CRUD - Create User
  const newUserUsername = `user_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const newUserPhone = '09' + Math.floor(10000000 + Math.random() * 90000000).toString();
  const createRes = await testFetch('/api/auth/users', {
    method: 'POST',
    token: adminToken,
    headers: { 'Idempotency-Key': `comprehensive-user-create-${newUserUsername}` },
    body: JSON.stringify({
      username: newUserUsername,
      email: `${newUserUsername}@nepo.vn`,
      phone: newUserPhone,
      password: 'password123',
      role: Role.ACCOUNTANT
    })
  });
  assert.strictEqual(createRes.status, 201);
  const createdUserId = createRes.data.id;
  assert.ok(createdUserId);

  // Test 1.4: User list retrieval
  const listRes = await testFetch('/api/auth/users', { token: adminToken });
  assert.strictEqual(listRes.status, 200);
  assert.ok(listRes.data.items.some((u: { id: number }) => u.id === createdUserId));

  // Test 1.5: User deletion
  const deleteRes = await testFetch(`/api/auth/users/${createdUserId}`, {
    method: 'DELETE',
    token: adminToken,
    headers: {
      'Idempotency-Key': `comprehensive-user-delete-${createdUserId}`,
      'If-Unmodified-Since': String(createRes.data.updatedAt),
    },
  });
  assert.strictEqual(deleteRes.status, 200);
});

// Regression: duplicate username must surface as a clean 409, not a 500.
// Drizzle wraps the underlying postgres-js error so the SQLSTATE 23505 lives on
// `err.cause.code`, not `err.code`. The global error handler must read both —
// otherwise the second create below returns HTTP 500 ("Lỗi máy chủ") and the
// user sees a generic server error instead of a field-specific conflict.
test('E2E — Duplicate username yields 409 (not 500) with field message', async () => {
  const dupUsername = `dup_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const baseBody = {
    username: dupUsername, password: 'password123', role: Role.ACCOUNTANT,
    fullName: 'Dup Test', email: `${dupUsername}@nepo.vn`,
  };
  const first = await testFetch('/api/auth/users', {
    method: 'POST',
    token: adminToken,
    headers: { 'Idempotency-Key': `comprehensive-dup-user-first-${dupUsername}` },
    body: JSON.stringify(baseBody),
  });
  assert.strictEqual(first.status, 201);
  const createdId = first.data.id;

  // Same username, different email/phone so the only conflict is the username.
  const second = await testFetch('/api/auth/users', {
    method: 'POST',
    token: adminToken,
    headers: { 'Idempotency-Key': `comprehensive-dup-user-second-${dupUsername}` },
    body: JSON.stringify({ ...baseBody, email: `alt-${dupUsername}@nepo.vn` }),
  });
  assert.strictEqual(second.status, 409);
  assert.match(String(second.data.error), /username|đã tồn tại/i);

  // Clean up so the row doesn't leak into other tests / the users list.
  await testFetch(`/api/auth/users/${createdId}`, {
    method: 'DELETE',
    token: adminToken,
    headers: {
      'Idempotency-Key': `comprehensive-dup-user-delete-${createdId}`,
      'If-Unmodified-Since': String(first.data.updatedAt),
    },
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 2: Catalog Tables Configurations (Config Pages)
// ─────────────────────────────────────────────────────────────────────────────
test('E2E — Catalog endpoints CRUD reads & listings', async () => {
  const catalogs = [
    'trucks', 'customers', 'routes', 'cargo-types',
    'pricing-tables', 'road-allowances', 'fuel-config', 'penalty-reasons',
    'cap-table', 'management-fees'
  ];

  for (const cat of catalogs) {
    const res = await testFetch(`/api/${cat}`, { token: adminToken });
    assert.strictEqual(res.status, 200, `Catalog /api/${cat} listing should return 200`);
    assert.ok(res.data, `Catalog /api/${cat} must return response body`);
  }
});

test('E2E — Customer duplicate guard blocks create and update conflicts', async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const duplicateName = `KH trùng ${suffix}`;
  const duplicateTaxCode = `DUP${Date.now().toString().slice(-8)}`;
  const secondTaxCode = `${duplicateTaxCode}9`.slice(0, 20);
  const [seedA] = await db.insert(s.customers).values({
    name: duplicateName,
    taxCode: duplicateTaxCode,
    status: 'ACTIVE',
  }).returning();
  const [seedB] = await db.insert(s.customers).values({
    name: `${duplicateName} khác`,
    taxCode: secondTaxCode,
    status: 'ACTIVE',
  }).returning();

  const secondCreate = await testFetch('/api/customers', {
    method: 'POST',
    token: adminToken,
    headers: { 'Idempotency-Key': `customer-duplicate-conflict-${suffix}` },
    body: JSON.stringify({
      name: duplicateName,
      taxCode: duplicateTaxCode,
      status: 'ACTIVE',
    }),
  });
  assert.strictEqual(secondCreate.status, 409);
  assert.match(String(secondCreate.data.error || ''), /đã tồn tại/i);

  const conflictingUpdate = await testFetch(`/api/customers/${seedB.id}`, {
    method: 'PUT',
    token: adminToken,
    headers: {
      'Idempotency-Key': `customer-duplicate-update-${suffix}`,
      'If-Unmodified-Since': seedB.updatedAt.toISOString(),
    },
    body: JSON.stringify({
      taxCode: duplicateTaxCode,
    }),
  });
  assert.strictEqual(conflictingUpdate.status, 409);
  assert.match(String(conflictingUpdate.data.error || ''), /mã số thuế.*đã tồn tại/i);
  await db.delete(s.customers).where(inArray(s.customers.id, [seedA.id, seedB.id]));
});

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 3: Complete Trip Operations & Reassignments
// ─────────────────────────────────────────────────────────────────────────────
test('E2E — Trip dispatch lifecycle (Create, Reassign, Pre-departure, Dispatch, Actuals, Lock, Cancel Guard)', async () => {
  // Do not retain an arbitrary catalog row selected during the global before
  // hook: other suites legitimately create and remove their own customers.
  // This flow owns a fresh customer at the moment it starts.
  const [flowCustomer] = await db.insert(s.customers).values({
    name: `Khách hàng E2E tổng hợp ${Date.now()}`,
  }).returning({ id: s.customers.id });
  customerId = flowCustomer.id;

  // 1. Create a trip (CREATED status)
  const createRes = await testFetch('/api/trips', {
    method: 'POST',
    token: managerToken,
    headers: { 'Idempotency-Key': `comprehensive-trip-create-${Date.now()}` },
    body: JSON.stringify({
      customerId,
      routeId,
      truckId,
      driverId,
      cargoTypeId,
      containerTypeId,
      departureDate: '2026-06-10',
      notes: 'Comprehensive E2E test trip'
    })
  });
  if (createRes.status !== 201) console.log('CREATE TRIP FAIL:', createRes, { truckId, driverId, customerId, routeId, cargoTypeId });
  assert.strictEqual(createRes.status, 201);
  assert.strictEqual(createRes.data.status, TripStatus.CREATED);
  tripId = createRes.data.id;

  // 2. Reassign truck/driver
  const currentActive = await db.select({ truckId: s.trips.truckId, driverId: s.trips.driverId })
    .from(s.trips).where(eq(s.trips.status, TripStatus.IN_TRANSIT));
  const curBusyTrucks = new Set(currentActive.map((t) => t.truckId));
  const curBusyDrivers = new Set(currentActive.map((t) => t.driverId));
  const currentTrucks = await db.select().from(s.trucks).where(isNull(s.trucks.deletedAt));
  const currentDrivers = await db.select().from(s.drivers).where(isNull(s.drivers.deletedAt));
  const altTruck = currentTrucks.find(t => !curBusyTrucks.has(t.id) && t.id !== truckId)
    || currentTrucks.find(t => !curBusyTrucks.has(t.id))
    || currentTrucks.find(t => t.id === truckId)!;
  const altDriver = currentDrivers.find(d => !curBusyDrivers.has(d.id) && d.id !== driverId)
    || currentDrivers.find(d => !curBusyDrivers.has(d.id))
    || currentDrivers.find(d => d.id === driverId)!;
  const reassignRes = await testFetch(`/api/trips/${tripId}/reassign`, {
    method: 'PATCH',
    token: managerToken,
    headers: { 'Idempotency-Key': `comprehensive-trip-reassign-${tripId}` },
    body: JSON.stringify({
      truckId: altTruck.id,
      driverId: altDriver.id
    })
  });
  if (reassignRes.status !== 200) console.log('REASSIGN FAIL:', reassignRes, 'altTruck:', altTruck.id, 'altDriver:', altDriver.id, 'busyTrucks:', [...curBusyTrucks], 'busyDrivers:', [...curBusyDrivers]);
  assert.strictEqual(reassignRes.status, 200);

  // 3. Update Pre-departure figures (AUTO mode, standard estimates)
  const preDepartureRes = await testFetch(`/api/trips/${tripId}/pre-departure`, {
    method: 'PUT',
    token: managerToken,
    headers: { 'Idempotency-Key': `comprehensive-trip-predeparture-${tripId}` },
    body: JSON.stringify({
      version: reassignRes.data.version,
      fuelMode: FuelMode.AUTO,
      legs: [{ sequence: 1, origin: 'Hà Nội', destination: 'Hải Phòng', km: 120, loadingType: LoadingType.HANG }],
      fuelSupplementLiters: 0,
      tollsDiscount: 0,
      tollsAddition: 0,
      tollsStations: 2,
      hasReturnCargo: false,
      driverSalary: 450000,
      revenue: 4000000,
    })
  });
  assert.strictEqual(preDepartureRes.status, 200);
  // 4. Dispatch the trip (CREATED -> IN_TRANSIT)
  const dispatchRes = await testFetch(`/api/trips/${tripId}/dispatch`, {
    method: 'POST',
    token: managerToken,
    headers: { 'Idempotency-Key': `comprehensive-trip-dispatch-${tripId}` },
    body: JSON.stringify({
      expectedVersion: preDepartureRes.data.version,
    }),
  });
  if (dispatchRes.status !== 200) console.log('DISPATCH FAIL:', dispatchRes);
  assert.strictEqual(dispatchRes.status, 200);
  assert.strictEqual(dispatchRes.data.status, TripStatus.IN_TRANSIT);
  const dispatchedVersion = dispatchRes.data.version;

  // 5. Upload confirmation photo (mocking photo insertion to bypass photo completion gate)
  await db.insert(s.tripPhotos).values({
    tripId,
    type: 'CONTAINER',
    storageKey: 'mock-e2e-dispatch-container.jpg',
    uploadedBy: adminUserId,
  });

  // 5b. O2C POD-recovery gate: record paper POD recovery before completion
  // (the governed close path requires podRecoveredAt on the trip).
  const podRecoveredRes = await testFetch(`/api/trips/${tripId}/pod-recovered`, {
    method: 'POST',
    token: accountantToken,
    headers: { 'Idempotency-Key': `comprehensive-trip-pod-recovered-${tripId}` },
    body: JSON.stringify({ expectedVersion: dispatchedVersion }),
  });
  assert.strictEqual(podRecoveredRes.status, 200);

  // 6. Submit actual operational figures (IN_TRANSIT -> COMPLETED)
  const actualsRes = await testFetch(`/api/trips/${tripId}/actuals`, {
    method: 'PUT',
    token: managerToken,
    headers: { 'Idempotency-Key': `comprehensive-trip-actuals-${tripId}` },
    body: JSON.stringify({
      version: podRecoveredRes.data.version,
      fuelMode: FuelMode.AUTO,
      legs: [{ sequence: 1, origin: 'Hà Nội', destination: 'Hải Phòng', km: 120, loadingType: LoadingType.HANG }],
      fuelSupplementLiters: 5, // supplementary liters
      fuelSupplementReason: 'Kẹt xe đường tránh kéo dài',
      tollsDiscount: 0,
      tollsAddition: 0,
      tollsStations: 2,
      hasReturnCargo: false,
      driverSalary: 500000,
      revenue: 4500000,
    })
  });
  assert.strictEqual(actualsRes.status, 200);
  // B2: saving actuals no longer auto-completes the trip — it stays IN_TRANSIT
  // until an explicit completion call (POST /complete). Photos are optional.
  assert.strictEqual(actualsRes.data.status, TripStatus.IN_TRANSIT);

  // 6b. Explicit completion (B2): IN_TRANSIT -> COMPLETED via dedicated endpoint.
  const completeRes = await testFetch(`/api/trips/${tripId}/complete`, {
    method: 'POST',
    token: managerToken,
    headers: { 'Idempotency-Key': `comprehensive-trip-complete-${tripId}` },
    body: JSON.stringify({
      expectedVersion: actualsRes.data.version,
      governanceReason: 'Hoàn thành chuyến kiểm thử E2E theo quy trình quản trị',
    }),
  });
  assert.strictEqual(completeRes.status, 202);
  assert.strictEqual(completeRes.data.actionKind, 'TRIP_FINANCIAL_CLOSE');

  const checkCloseRes = await testFetch(`/api/governance-actions/${completeRes.data.id}/check`, {
    method: 'POST',
    token: accountantToken,
    headers: { 'Idempotency-Key': `comprehensive-trip-complete-check-${completeRes.data.id}` },
    body: JSON.stringify({ expectedVersion: completeRes.data.version }),
  });
  assert.strictEqual(checkCloseRes.status, 200);

  const approveCloseRes = await testFetch(`/api/governance-actions/${completeRes.data.id}/approve`, {
    method: 'POST',
    token: adminToken,
    headers: { 'Idempotency-Key': `comprehensive-trip-complete-approve-${completeRes.data.id}` },
    body: JSON.stringify({ expectedVersion: checkCloseRes.data.version }),
  });
  assert.strictEqual(approveCloseRes.status, 200);

  const [completedTrip] = await db.select({ status: s.trips.status, version: s.trips.version })
    .from(s.trips).where(eq(s.trips.id, tripId)).limit(1);
  assert.strictEqual(completedTrip.status, TripStatus.COMPLETED);

  // 7. O2C: the separate /lock milestone is gone — COMPLETED is the single
  // terminal/posting state. A direct cancel of a COMPLETED trip is funneled
  // into the governed request path: without a governance reason it is rejected.
  const cancelRes = await testFetch(`/api/trips/${tripId}/cancel`, {
    method: 'POST',
    token: managerToken,
    headers: { 'Idempotency-Key': `comprehensive-trip-cancel-${tripId}` },
    body: JSON.stringify({ expectedVersion: completedTrip.version }),
  });
  assert.strictEqual(cancelRes.status, 400); // governed reason required to cancel a completed trip
});

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 4: Financial Accounting & Ledger Statements
// ─────────────────────────────────────────────────────────────────────────────
test('E2E — Financial operations (P&L, profit sharing, ledger, statements, receipts)', async () => {
  // 1. Fetch P&L Dashboard
  const pnlRes = await testFetch('/api/reports/pnl?month=5&year=2026', { token: adminToken });
  assert.strictEqual(pnlRes.status, 200);
  assert.ok(pnlRes.data.totalRevenue !== undefined);

  // 2. Fetch Dashboard metrics
  const dashboardRes = await testFetch('/api/reports/dashboard', { token: adminToken });
  assert.strictEqual(dashboardRes.status, 200);
  assert.ok(dashboardRes.data.revenue !== undefined);
  assert.ok(dashboardRes.data.executive !== undefined, 'authorized dashboard route must include executive aggregates');

  // 3. Profit distribution snapshotting
  // Seed a partner first to make sure there is capital history to distribute to
  await db.insert(s.capTableHistory).values({
    partnerName: 'Ông Thương',
    percentage: '100',
    effectiveDate: '2026-01-01',
  }).onConflictDoNothing();

  // Clean up any prior distributions for Q2/2026 (idempotency guard returns 409)
  await db.delete(s.distributions)
    .where(and(eq(s.distributions.quarter, 2), eq(s.distributions.year, 2026)));
  await db.delete(s.governanceActions)
    .where(and(
      eq(s.governanceActions.subjectType, 'PROFIT_DISTRIBUTION'),
      eq(s.governanceActions.subjectKey, '2026-Q2'),
      eq(s.governanceActions.actionKind, 'PROFIT_DISTRIBUTION'),
    ));

  const distributeRes = await testFetch('/api/reports/distribute-profit', {
    method: 'POST',
    token: managerToken,
    headers: { 'Idempotency-Key': `comprehensive-distribute-profit-${Date.now()}` },
    body: JSON.stringify({ quarter: 2, year: 2026 })
  });
  assert.strictEqual(distributeRes.status, 201);
  assert.strictEqual(distributeRes.data.actionKind, 'PROFIT_DISTRIBUTION');
  assert.strictEqual(distributeRes.data.status, 'PENDING_CHECK');
  assert.ok(distributeRes.data.subjectKey);

  // 4. Ledger adjustments endpoint
  const [adjustmentTrip] = await db.select({ version: s.trips.version })
    .from(s.trips).where(eq(s.trips.id, tripId)).limit(1);
  const missingAdjustmentVersionRes = await testFetch('/api/adjustments', {
    method: 'POST',
    token: adminToken,
    body: JSON.stringify({
      tripId,
      amount: -100000,
      note: 'Thiếu phiên bản nguồn',
      signedAgreementRef: 'AGR-2026-MISSING-VERSION',
    }),
  });
  assert.strictEqual(missingAdjustmentVersionRes.status, 400);

  const missingReopenVersionRes = await testFetch(`/api/trips/${tripId}/unlock`, {
    method: 'POST',
    token: adminToken,
    headers: { 'Idempotency-Key': `comprehensive-unlock-missing-version-${tripId}` },
    body: JSON.stringify({ reason: 'Thiếu phiên bản nguồn' }),
  });
  assert.strictEqual(missingReopenVersionRes.status, 400);

  const adjustRes = await testFetch('/api/adjustments', {
    method: 'POST',
    token: adminToken,
    headers: { 'Idempotency-Key': `comprehensive-adjustment-${tripId}` },
    body: JSON.stringify({
      tripId: tripId,
      expectedVersion: adjustmentTrip.version,
      amount: -100000, // Negative for adjustment credit note
      note: 'Điều chỉnh chiết khấu cuối tháng',
      signedAgreementRef: 'AGR-2026-001'
    })
  });
  assert.strictEqual(adjustRes.status, 201);

  // 5. Customer FIFO statements
  const stmtRes = await testFetch(`/api/ledger/customers/${customerId}/statement`, { token: adminToken });
  assert.strictEqual(stmtRes.status, 200);
  assert.ok(stmtRes.data.ledgerRows !== undefined);

  // 6. Payment receipts allocation
  const paymentRes = await testFetch('/api/payments/receive', {
    method: 'POST',
    token: adminToken,
    headers: { 'Idempotency-Key': `comprehensive-payment-receive-${Date.now()}` },
    body: JSON.stringify({
      customerId: customerId,
      receiptId: `REC-${Date.now()}`,
      payments: [{ tripId: tripId, amount: 500000 }]
    })
  });
  assert.strictEqual(paymentRes.status, 201);
});

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 5: Driver Interface & Column Filtering
// ─────────────────────────────────────────────────────────────────────────────
test('E2E — Driver portal isolation & earnings summary', async () => {
  // 1. Driver assigned trips DTO fetch
  const tripsRes = await testFetch('/api/driver/me/trips', { token: driverToken });
  assert.strictEqual(tripsRes.status, 200);
  assert.ok(tripsRes.data.items !== undefined);

  // 2. Driver cumulative earnings (requires month/year query params)
  const earningsRes = await testFetch('/api/driver/me/earnings?month=6&year=2026', { token: driverToken });
  assert.strictEqual(earningsRes.status, 200);
  assert.ok(earningsRes.data.baseSalary !== undefined);
  assert.ok(earningsRes.data.tripIncome !== undefined);
  assert.ok(earningsRes.data.netIncome !== undefined);

  // 3. Driver disciplinary penalties list
  const penaltiesRes = await testFetch('/api/driver/me/penalties', { token: driverToken });
  assert.strictEqual(penaltiesRes.status, 200);
  assert.ok(penaltiesRes.data.items !== undefined);
});
