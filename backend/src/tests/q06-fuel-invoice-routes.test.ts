import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import { eq, inArray, sql } from 'drizzle-orm';

import { Role } from '@tingting/shared';
import { db, client } from '../db';
import * as s from '../db/schema';
import { insertTripComposite } from '../services/trip-composite.service';
import { config } from '../config';
import { initEnforcer } from '../casbin/enforcer';
import { authMiddleware } from '../middleware/auth';
import { auditLogMiddleware } from '../middleware/audit';
import { casbinAuthz } from '../middleware/casbin';
import { globalErrorHandler } from '../middleware/errorHandler';
import financialRoutes from '../routes/financial';
import { getFuelApReconciliation } from '../services/fuel-ap-recon.service';
import { disconnectRedis } from '../lib/redis';
import { closePeriodLock, getClosedPeriodLock, resolveFuelPeriodAuthority } from '../services/period-lock.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdUserIds: number[] = [];
const createdTripIds: number[] = [];
const createdTruckIds: number[] = [];
const createdSupplierIds: number[] = [];
const createdRouteIds: number[] = [];
const createdCargoTypeIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdExpenseIds: number[] = [];
const createdExpensePhotoIds: number[] = [];
const createdFuelInvoiceIds: number[] = [];
const createdPeriodLockIds: number[] = [];
const idempotencyKeys: string[] = [];
let failpointCounter = 0;

let server: http.Server;
let baseUrl: string;
let managerToken: string;
let accountantToken: string;
let adminToken: string;
let driverToken: string;
let customerToken: string;

async function mkUser(role: Role) {
  const [user] = await db.insert(s.users).values({
    username: `q06-${role.toLowerCase()}-${suffix}-${createdUserIds.length}`,
    passwordHash: 'test',
    role,
    status: 'ACTIVE',
  }).returning();
  createdUserIds.push(user.id);
  return { ...user, role: user.role as Role };
}

async function mkSupplier() {
  const [supplier] = await db.insert(s.suppliers).values({
    name: `Q06 fuel supplier ${suffix}-${createdSupplierIds.length}`,
    isFuelSupplier: true,
  }).returning();
  createdSupplierIds.push(supplier.id);
  return supplier;
}

async function mkTruck() {
  const [truck] = await db.insert(s.trucks).values({
    licensePlate: `Q06-${suffix.slice(-8)}-${createdTruckIds.length}`,
  }).returning();
  createdTruckIds.push(truck.id);
  return truck;
}

async function mkCustomer() {
  const [customer] = await db.insert(s.customers).values({
    name: `Q06 customer ${suffix}-${createdCustomerIds.length}`,
  }).returning();
  createdCustomerIds.push(customer.id);
  return customer;
}

async function mkRoute() {
  const [route] = await db.insert(s.routes).values({
    name: `Q06 route ${suffix}-${createdRouteIds.length}`,
  }).returning();
  createdRouteIds.push(route.id);
  return route;
}

async function mkCargoType() {
  const [cargo] = await db.insert(s.cargoTypes).values({
    name: `Q06 cargo ${suffix}-${createdCargoTypeIds.length}`,
  }).returning();
  createdCargoTypeIds.push(cargo.id);
  return cargo;
}

async function mkTrip(supplierId: number, truckId: number) {
  const customer = await mkCustomer();
  const route = await mkRoute();
  const cargo = await mkCargoType();
  const trip = await insertTripComposite(db, {
    tripCode: `Q06-${suffix}-${createdTripIds.length}`.slice(0, 50),
    customerId: customer.id,
    routeId: route.id,
    cargoTypeId: cargo.id,
    status: 'COMPLETED',
    departureDate: '2026-07-20',
    completedAt: new Date('2026-07-20T05:00:00.000Z'),
    carrierType: 'OWN',
    truckId,
    fuelSupplierId: supplierId,
    totalFuelCost: '2200000',
  });
  createdTripIds.push(trip.id);
  return trip;
}

async function mkExpense(opts: {
  tripId: number;
  supplierId: number;
  expenseType: string;
  buyAmount?: string;
  expenseDate?: string | null;
  invoiceNumber?: string | null;
  declarationNumber?: string | null;
  approvalStatus?: 'PENDING' | 'APPROVED' | 'REJECTED';
}) {
  const [expense] = await db.execute<{ id: number }>(sql`
    insert into trip_expenses (
      trip_id,
      expense_type,
      buy_amount,
      sell_amount,
      supplier_id,
      expense_date,
      invoice_number,
      invoice_date,
      declaration_number,
      approval_status
    ) values (
      ${opts.tripId},
      ${opts.expenseType},
      ${opts.buyAmount ?? '2200000'},
      ${'0'},
      ${opts.supplierId},
      ${opts.expenseDate ?? '2026-07-20'},
      ${opts.invoiceNumber ?? null},
      ${'2026-07-20'},
      ${opts.declarationNumber ?? null},
      ${opts.approvalStatus ?? 'APPROVED'}
    )
    returning id
  `);
  createdExpenseIds.push(expense.id);
  return expense;
}

async function mkExpensePhoto(tripExpenseId: number) {
  const [photo] = await db.insert(s.tripExpensePhotos).values({
    tripExpenseId,
    storageKey: `trip-expense/q06/${suffix}/${createdExpensePhotoIds.length + 1}.jpg`,
  }).returning();
  createdExpensePhotoIds.push(photo.id);
  return photo;
}

function sign(user: { id: number; username: string | null; role: Role | string }) {
  return jwt.sign(
    { userId: user.id, username: user.username ?? `${user.id}`, role: user.role as Role },
    config.jwtSecret,
  );
}

async function request(path: string, init: { method?: string; token: string; body?: unknown; idempotencyKey?: string | null }) {
  const headers: Record<string, string> = { Authorization: `Bearer ${init.token}` };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  const method = init.method ?? 'GET';
  const idempotencyKey = method !== 'GET'
    ? (init.idempotencyKey === null ? null : (init.idempotencyKey ?? `q06-${method}-${idempotencyKeys.length + 1}`))
    : null;
  if (idempotencyKey) {
    headers['Idempotency-Key'] = idempotencyKey;
    if (!idempotencyKeys.includes(idempotencyKey)) {
      idempotencyKeys.push(idempotencyKey);
    }
  }
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const body = await response.json().catch(() => ({}));
  if (body?.id && typeof body.id === 'number') {
    if (
      path.startsWith('/api/finance/fuel-invoices')
      && !path.includes('/corrections')
      && !createdFuelInvoiceIds.includes(body.id)
    ) {
      createdFuelInvoiceIds.push(body.id);
    }
  }
  return { status: response.status, body };
}

async function withMockedNow<T>(isoDateTime: string, run: () => Promise<T>): Promise<T> {
  const realNow = Date.now;
  const fixedNow = new Date(isoDateTime).getTime();
  Date.now = () => fixedNow;
  try {
    return await run();
  } finally {
    Date.now = realNow;
  }
}

async function trackFuelLock(date: string, actorId: number) {
  const lock = await db.transaction((tx) =>
    closePeriodLock(tx, resolveFuelPeriodAuthority(date), actorId, 'Q06 fuel period test'));
  createdPeriodLockIds.push(lock.id);
  return lock;
}

async function withIdempotencyInsertFailure(endpoint: string, idempotencyKey: string, run: () => Promise<void>) {
  failpointCounter += 1;
  const identSuffix = suffix.replace(/[^a-z0-9]+/gi, '_');
  const functionName = `q06_fail_idempotency_insert_${identSuffix}_${failpointCounter}`;
  const triggerName = `q06_fail_idempotency_insert_trg_${identSuffix}_${failpointCounter}`;
  await db.execute(sql.raw(`
    create function "${functionName}"() returns trigger
    language plpgsql
    as $$
    begin
      raise exception 'q06 simulated idempotency insert failure';
    end;
    $$;
  `));
  await db.execute(sql.raw(`
    create trigger "${triggerName}"
    before insert on idempotency_keys
    for each row
    when (new.endpoint = '${endpoint}' and new.idempotency_key = '${idempotencyKey}')
    execute function "${functionName}"();
  `));
  try {
    await run();
  } finally {
    await db.execute(sql.raw(`drop trigger if exists "${triggerName}" on idempotency_keys;`));
    await db.execute(sql.raw(`drop function if exists "${functionName}"();`));
  }
}

before(async () => {
  await initEnforcer();
  const manager = await mkUser(Role.MANAGER);
  const accountant = await mkUser(Role.ACCOUNTANT);
  const admin = await mkUser(Role.ADMIN);
  const driver = await mkUser(Role.DRIVER);
  const customer = await mkUser(Role.CUSTOMER);

  managerToken = sign(manager);
  accountantToken = sign(accountant);
  adminToken = sign(admin);
  driverToken = sign(driver);
  customerToken = sign(customer);

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
});

after(async () => {
  try {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (idempotencyKeys.length > 0) {
      await db.delete(s.idempotencyKeys).where(inArray(s.idempotencyKeys.idempotencyKey, idempotencyKeys));
    }
    if (createdExpensePhotoIds.length > 0) {
      await db.delete(s.tripExpensePhotos).where(inArray(s.tripExpensePhotos.id, createdExpensePhotoIds));
    }
    if (createdFuelInvoiceIds.length > 0) {
      // Late-approval period links key by invoice id since the maker-checker
      // removal; sweep them before the invoices themselves.
      await db.delete(s.fuelPeriodAdjustments).where(inArray(
        s.fuelPeriodAdjustments.fuelInvoiceId,
        createdFuelInvoiceIds,
      ));
    }
    if (createdPeriodLockIds.length > 0) {
      await db.delete(s.periodLocks).where(inArray(s.periodLocks.id, createdPeriodLockIds));
    }
    if (createdFuelInvoiceIds.length > 0) {
      await db.delete(s.fuelInvoices).where(inArray(s.fuelInvoices.id, createdFuelInvoiceIds));
    }
    if (createdExpenseIds.length > 0) {
      await db.delete(s.tripExpenses).where(inArray(s.tripExpenses.id, createdExpenseIds));
    }
    if (createdTripIds.length > 0) {
      await db.delete(s.tripFinancialState).where(inArray(s.tripFinancialState.tripId, createdTripIds));
      await db.delete(s.tripCarrierInfo).where(inArray(s.tripCarrierInfo.tripId, createdTripIds));
      await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
    }
    if (createdTruckIds.length > 0) {
      await db.delete(s.trucks).where(inArray(s.trucks.id, createdTruckIds));
    }
    if (createdCargoTypeIds.length > 0) {
      await db.delete(s.cargoTypes).where(sql`${s.cargoTypes.name} LIKE ${`Q06 cargo ${suffix}%`}`);
    }
    if (createdRouteIds.length > 0) {
      await db.delete(s.routes).where(sql`${s.routes.name} LIKE ${`Q06 route ${suffix}%`}`);
    }
    if (createdCustomerIds.length > 0) {
      await db.delete(s.customers).where(sql`${s.customers.name} LIKE ${`Q06 customer ${suffix}%`}`);
    }
    if (createdSupplierIds.length > 0) {
      await db.delete(s.suppliers).where(inArray(s.suppliers.id, createdSupplierIds));
    }
    if (createdUserIds.length > 0) {
      await db.delete(s.users).where(inArray(s.users.id, createdUserIds));
    }
  } finally {
    await disconnectRedis();
    await client.end();
  }
});

describe('Q06 fuel invoice routes', () => {
  test('manager can list and view but cannot create or edit; driver/customer are denied', async () => {
    const supplier = await mkSupplier();
    const truck = await mkTruck();
    const trip = await mkTrip(supplier.id, truck.id);
    const approvedFuelExpense = await mkExpense({
      tripId: trip.id,
      supplierId: supplier.id,
      expenseType: 'FUEL_DIESEL',
      expenseDate: '2026-07-20',
    });
    await mkExpensePhoto(approvedFuelExpense.id);

    const created = await request('/api/finance/fuel-invoices', {
      method: 'POST',
      token: accountantToken,
      body: {
        supplierId: supplier.id,
        invoiceNumber: `HD-Q06-A-${suffix}`,
        invoiceDate: '2026-07-20',
        totalLiters: 100,
        unitPrice: 22000,
        allocations: [{
          tripId: trip.id,
          truckId: truck.id,
          tripExpenseId: approvedFuelExpense.id,
          voucherReference: `PXD-Q06-A-${suffix}`,
          voucherDate: '2026-07-20',
          liters: 100,
        }],
      },
    });
    assert.equal(created.status, 201);

    const list = await request('/api/finance/fuel-invoices', { token: managerToken });
    assert.equal(list.status, 200);
    assert.ok(Array.isArray(list.body));
    assert.ok(list.body.some((row: { id: number }) => row.id === created.body.id));

    const detail = await request(`/api/finance/fuel-invoices/${created.body.id}`, { token: managerToken });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.id, created.body.id);

    const managerCreate = await request('/api/finance/fuel-invoices', {
      method: 'POST',
      token: managerToken,
      body: {
        supplierId: supplier.id,
        invoiceNumber: `HD-Q06-MGR-${suffix}`,
        invoiceDate: '2026-07-20',
        totalLiters: 10,
        unitPrice: 22000,
        allocations: [],
      },
    });
    assert.equal(managerCreate.status, 403);

    const managerUpdate = await request(`/api/finance/fuel-invoices/${created.body.id}`, {
      method: 'PUT',
      token: managerToken,
      body: {
        expectedVersion: created.body.version,
        supplierId: supplier.id,
        invoiceNumber: `HD-Q06-A-${suffix}`,
        invoiceDate: '2026-07-20',
        totalLiters: 100,
        unitPrice: 22000,
        allocations: [],
      },
    });
    assert.equal(managerUpdate.status, 403);

    for (const token of [driverToken, customerToken]) {
      const denied = await request('/api/finance/fuel-invoices', { token });
      assert.equal(denied.status, 403);
    }
  });

  test('lists more than 50 invoices through a stable cursor without duplicates', async () => {
    const supplier = await mkSupplier();
    const inserted = await db.insert(s.fuelInvoices).values(
      Array.from({ length: 51 }, (_, index) => ({
        supplierId: supplier.id,
        invoiceNumber: `HD-Q06-PAGE-${suffix}-${index}`,
        invoiceDate: '2026-07-21',
        totalLiters: '1',
        unitPrice: '22000',
        totalAmount: '22000',
        approvalStatus: 'PENDING',
      })),
    ).returning({ id: s.fuelInvoices.id });
    createdFuelInvoiceIds.push(...inserted.map((row) => row.id));

    const seenIds: number[] = [];
    let cursor: string | undefined;
    do {
      const page = await request(
        `/api/finance/fuel-invoices?supplierId=${supplier.id}&paginated=true&limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        { token: managerToken },
      );
      assert.equal(page.status, 200, JSON.stringify(page.body));
      assert.ok(Array.isArray(page.body.items));
      assert.ok(page.body.items.length <= 20);
      seenIds.push(...page.body.items.map((row: { id: number }) => row.id));
      cursor = page.body.nextCursor ?? undefined;
    } while (cursor);

    assert.equal(seenIds.length, 51);
    assert.equal(new Set(seenIds).size, 51);
    assert.deepEqual(
      new Set(seenIds),
      new Set(inserted.map((row) => row.id)),
    );

    const legacyList = await request(
      `/api/finance/fuel-invoices?supplierId=${supplier.id}`,
      { token: managerToken },
    );
    assert.equal(legacyList.status, 200, JSON.stringify(legacyList.body));
    assert.ok(Array.isArray(legacyList.body));
    assert.equal(legacyList.body.length, 51);
    assert.deepEqual(
      new Set(legacyList.body.map((row: { id: number }) => row.id)),
      new Set(inserted.map((row) => row.id)),
    );
  });

  test('status pagination scans past newer nonmatching raw invoices', async () => {
    const supplier = await mkSupplier();
    const inserted = await db.insert(s.fuelInvoices).values([
      {
        supplierId: supplier.id,
        invoiceNumber: `HD-Q06-STATUS-${suffix}-approved-1`,
        invoiceDate: '2026-07-21',
        totalLiters: '1',
        unitPrice: '22000',
        totalAmount: '22000',
        approvalStatus: 'APPROVED',
      },
      {
        supplierId: supplier.id,
        invoiceNumber: `HD-Q06-STATUS-${suffix}-approved-2`,
        invoiceDate: '2026-07-21',
        totalLiters: '1',
        unitPrice: '22000',
        totalAmount: '22000',
        approvalStatus: 'APPROVED',
      },
      {
        supplierId: supplier.id,
        invoiceNumber: `HD-Q06-STATUS-${suffix}-rejected`,
        invoiceDate: '2026-07-21',
        totalLiters: '1',
        unitPrice: '22000',
        totalAmount: '22000',
        approvalStatus: 'REJECTED',
      },
      {
        supplierId: supplier.id,
        invoiceNumber: `HD-Q06-STATUS-${suffix}-pending`,
        invoiceDate: '2026-07-21',
        totalLiters: '1',
        unitPrice: '22000',
        totalAmount: '22000',
        approvalStatus: 'PENDING',
      },
    ]).returning({ id: s.fuelInvoices.id });
    createdFuelInvoiceIds.push(...inserted.map((row) => row.id));

    const page = await request(
      `/api/finance/fuel-invoices?supplierId=${supplier.id}&status=RECORDED&paginated=true&limit=2`,
      { token: managerToken },
    );
    assert.equal(page.status, 200, JSON.stringify(page.body));
    assert.deepEqual(
      page.body.items.map((row: { id: number }) => row.id),
      [inserted[1]!.id, inserted[0]!.id],
    );
    assert.equal(page.body.nextCursor, null);
  });

  test('REVERSED pagination uses synthesized effective status across raw pages', async () => {
    const supplier = await mkSupplier();
    const inserted = await db.insert(s.fuelInvoices).values(
      Array.from({ length: 6 }, (_, index) => ({
        supplierId: supplier.id,
        invoiceNumber: `HD-Q06-REVERSED-PAGE-${suffix}-${index}`,
        invoiceDate: '2026-07-21',
        totalLiters: '1',
        unitPrice: '22000',
        totalAmount: '22000',
        approvalStatus: 'APPROVED',
      })),
    ).returning({ id: s.fuelInvoices.id });
    createdFuelInvoiceIds.push(...inserted.map((row) => row.id));
    // 2026-09-11 (maker-checker removal): reversals materialize onto the
    // invoice row itself, so REVERSED is seeded as the row status directly.
    await db.update(s.fuelInvoices).set({ approvalStatus: 'REVERSED' }).where(inArray(
      s.fuelInvoices.id,
      [inserted[4]!.id, inserted[2]!.id, inserted[0]!.id],
    ));

    const firstPage = await request(
      `/api/finance/fuel-invoices?supplierId=${supplier.id}&status=REVERSED&paginated=true&limit=2`,
      { token: managerToken },
    );
    assert.equal(firstPage.status, 200, JSON.stringify(firstPage.body));
    assert.deepEqual(
      firstPage.body.items.map((row: { id: number }) => row.id),
      [inserted[4]!.id, inserted[2]!.id],
    );
    assert.ok(firstPage.body.nextCursor);

    const secondPage = await request(
      `/api/finance/fuel-invoices?supplierId=${supplier.id}&status=REVERSED&paginated=true&limit=2&cursor=${encodeURIComponent(firstPage.body.nextCursor)}`,
      { token: managerToken },
    );
    assert.equal(secondPage.status, 200, JSON.stringify(secondPage.body));
    assert.deepEqual(
      secondPage.body.items.map((row: { id: number }) => row.id),
      [inserted[0]!.id],
    );
    assert.equal(secondPage.body.nextCursor, null);
  });

  test('linkage rejects non-fuel, wrong-trip, mismatched date, mismatched litres, and mismatched reference', async () => {
    const supplier = await mkSupplier();
    const otherSupplier = await mkSupplier();
    const truck = await mkTruck();
    const otherTruck = await mkTruck();
    const trip = await mkTrip(supplier.id, truck.id);
    const otherTrip = await mkTrip(otherSupplier.id, otherTruck.id);
    const approvedFuelExpense = await mkExpense({
      tripId: trip.id,
      supplierId: supplier.id,
      expenseType: 'FUEL_DIESEL',
      expenseDate: '2026-07-22',
      invoiceNumber: `PXD-Q06-C-${suffix}-AUTH`,
      approvalStatus: 'APPROVED',
    });
    const ancillaryExpense = await mkExpense({
      tripId: trip.id,
      supplierId: supplier.id,
      expenseType: 'TOLL',
      approvalStatus: 'APPROVED',
    });
    const wrongTripExpense = await mkExpense({
      tripId: otherTrip.id,
      supplierId: otherSupplier.id,
      expenseType: 'FUEL_DIESEL',
      approvalStatus: 'APPROVED',
    });

    const created = await request('/api/finance/fuel-invoices', {
      method: 'POST',
      token: accountantToken,
      body: {
        supplierId: supplier.id,
        invoiceNumber: `HD-Q06-C-${suffix}`,
        invoiceDate: '2026-07-22',
        totalLiters: 100,
        unitPrice: 22000,
        allocations: [{
          tripId: trip.id,
          truckId: truck.id,
          tripExpenseId: approvedFuelExpense.id,
          voucherReference: `PXD-Q06-C-${suffix}-AUTH`,
          voucherDate: '2026-07-22',
          liters: 100,
        }],
      },
    });
    assert.equal(created.status, 201);

    const wrongType = await request(`/api/finance/fuel-invoices/${created.body.id}`, {
      method: 'PUT',
      token: accountantToken,
      body: {
        expectedVersion: created.body.version,
        supplierId: supplier.id,
        invoiceNumber: `HD-Q06-C-${suffix}`,
        invoiceDate: '2026-07-22',
        totalLiters: 100,
        unitPrice: 22000,
        allocations: [{
          tripId: trip.id,
          truckId: truck.id,
          tripExpenseId: ancillaryExpense.id,
          voucherReference: `PXD-Q06-C-${suffix}-1`,
          voucherDate: '2026-07-22',
          liters: 100,
        }],
      },
    });
    assert.equal(wrongType.status, 400);
    assert.match(String(wrongType.body.error), /không phải chi phí nhiên liệu thực tế/i);

    const wrongTrip = await request(`/api/finance/fuel-invoices/${created.body.id}`, {
      method: 'PUT',
      token: accountantToken,
      body: {
        expectedVersion: created.body.version,
        supplierId: supplier.id,
        invoiceNumber: `HD-Q06-C-${suffix}`,
        invoiceDate: '2026-07-22',
        totalLiters: 100,
        unitPrice: 22000,
        allocations: [{
          tripId: trip.id,
          truckId: truck.id,
          tripExpenseId: wrongTripExpense.id,
          voucherReference: `PXD-Q06-C-${suffix}-2`,
          voucherDate: '2026-07-22',
          liters: 100,
        }],
      },
    });
    assert.equal(wrongTrip.status, 400);
    assert.match(String(wrongTrip.body.error), /không thuộc chuyến/i);

    const wrongDate = await request(`/api/finance/fuel-invoices/${created.body.id}`, {
      method: 'PUT',
      token: accountantToken,
      body: {
        expectedVersion: created.body.version,
        supplierId: supplier.id,
        invoiceNumber: `HD-Q06-C-${suffix}`,
        invoiceDate: '2026-07-22',
        totalLiters: 100,
        unitPrice: 22000,
        allocations: [{
          tripId: trip.id,
          truckId: truck.id,
          tripExpenseId: approvedFuelExpense.id,
          voucherReference: `PXD-Q06-C-${suffix}-AUTH`,
          voucherDate: '2026-07-23',
          liters: 100,
        }],
      },
    });
    assert.equal(wrongDate.status, 400);
    assert.match(String(wrongDate.body.error), /phải trùng ngày chi/i);

    const wrongLiters = await request(`/api/finance/fuel-invoices/${created.body.id}`, {
      method: 'PUT',
      token: accountantToken,
      body: {
        expectedVersion: created.body.version,
        supplierId: supplier.id,
        invoiceNumber: `HD-Q06-C-${suffix}`,
        invoiceDate: '2026-07-22',
        totalLiters: 90,
        unitPrice: 22000,
        allocations: [{
          tripId: trip.id,
          truckId: truck.id,
          tripExpenseId: approvedFuelExpense.id,
          voucherReference: `PXD-Q06-C-${suffix}-AUTH`,
          voucherDate: '2026-07-22',
          liters: 90,
        }],
      },
    });
    assert.equal(wrongLiters.status, 400);
    assert.match(String(wrongLiters.body.error), /không khớp chi phí nhiên liệu đã ghi nhận/i);

    const wrongReference = await request(`/api/finance/fuel-invoices/${created.body.id}`, {
      method: 'PUT',
      token: accountantToken,
      body: {
        expectedVersion: created.body.version,
        supplierId: supplier.id,
        invoiceNumber: `HD-Q06-C-${suffix}`,
        invoiceDate: '2026-07-22',
        totalLiters: 100,
        unitPrice: 22000,
        allocations: [{
          tripId: trip.id,
          truckId: truck.id,
          tripExpenseId: approvedFuelExpense.id,
          voucherReference: `PXD-Q06-C-${suffix}-WRONG`,
          voucherDate: '2026-07-22',
          liters: 100,
        }],
      },
    });
    assert.equal(wrongReference.status, 400);
    assert.match(String(wrongReference.body.error), /phải khớp chứng từ đã lưu/i);
  });

  // KP-152 (approval removal): the two approve-gate scenarios that lived
  // here (unlinked-allocation rejection, no-photo authority revalidation on
  // approve) are properties of the removed approve endpoint — invoices are
  // APPROVED at creation and the correction route carries the evidence
  // checks forward.

  test('Q23 fuel invoice boundary requires a key, rejects stale writes, and replays exact commands (KP-152: approval is at creation)', async () => {
    const supplier = await mkSupplier();
    const truck = await mkTruck();
    const trip = await mkTrip(supplier.id, truck.id);
    const approvedFuelExpense = await mkExpense({
      tripId: trip.id,
      supplierId: supplier.id,
      expenseType: 'FUEL_DIESEL',
      expenseDate: '2026-07-24',
      invoiceNumber: `PXD-Q23-${suffix}-AUTH`,
      approvalStatus: 'APPROVED',
    });

    const missingKey = await request('/api/finance/fuel-invoices', {
      method: 'POST',
      token: accountantToken,
      idempotencyKey: null,
      body: {
        supplierId: supplier.id,
        invoiceNumber: `HD-Q23-MISS-${suffix}`,
        invoiceDate: '2026-07-24',
        totalLiters: 100,
        unitPrice: 22000,
        allocations: [{
          tripId: trip.id,
          truckId: truck.id,
          tripExpenseId: approvedFuelExpense.id,
          voucherReference: `PXD-Q23-${suffix}-AUTH`,
          voucherDate: '2026-07-24',
          liters: 100,
        }],
      },
    });
    assert.equal(missingKey.status, 400);
    assert.match(String(missingKey.body.error), /Idempotency-Key/i);

    const createKey = `q23-fuel-create-${trip.id}`;
    const createBody = {
      supplierId: supplier.id,
      invoiceNumber: `HD-Q23-${suffix}`,
      invoiceDate: '2026-07-24',
      totalLiters: 100,
      unitPrice: 22000,
      allocations: [{
        tripId: trip.id,
        truckId: truck.id,
        tripExpenseId: approvedFuelExpense.id,
        voucherReference: `PXD-Q23-${suffix}-AUTH`,
        voucherDate: '2026-07-24',
        liters: 100,
      }],
    };
    const created = await request('/api/finance/fuel-invoices', {
      method: 'POST',
      token: accountantToken,
      idempotencyKey: createKey,
      body: createBody,
    });
    assert.equal(created.status, 201);

    const replayedCreate = await request('/api/finance/fuel-invoices', {
      method: 'POST',
      token: accountantToken,
      idempotencyKey: createKey,
      body: createBody,
    });
    assert.equal(replayedCreate.status, 201);
    assert.equal(replayedCreate.body.replayed, true);
    assert.equal(replayedCreate.body.id, created.body.id);

    const createDrift = await request('/api/finance/fuel-invoices', {
      method: 'POST',
      token: accountantToken,
      idempotencyKey: createKey,
      body: { ...createBody, note: 'Đổi payload cùng khóa' },
    });
    assert.equal(createDrift.status, 409);
    assert.match(String(createDrift.body.error), /Khóa giao dịch trùng/i);

    const updateKey = `q23-fuel-update-${created.body.id}`;
    const updated = await request(`/api/finance/fuel-invoices/${created.body.id}`, {
      method: 'PUT',
      token: accountantToken,
      idempotencyKey: updateKey,
      body: {
        expectedVersion: created.body.version,
        ...createBody,
        note: 'Cập nhật trước khi duyệt',
      },
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.note, 'Cập nhật trước khi duyệt');

    const replayedUpdate = await request(`/api/finance/fuel-invoices/${created.body.id}`, {
      method: 'PUT',
      token: accountantToken,
      idempotencyKey: updateKey,
      body: {
        expectedVersion: created.body.version,
        ...createBody,
        note: 'Cập nhật trước khi duyệt',
      },
    });
    assert.equal(replayedUpdate.status, 200);
    assert.equal(replayedUpdate.body.replayed, true);
    assert.equal(replayedUpdate.body.id, created.body.id);

    const updateDrift = await request(`/api/finance/fuel-invoices/${created.body.id}`, {
      method: 'PUT',
      token: accountantToken,
      idempotencyKey: updateKey,
      body: {
        expectedVersion: created.body.version,
        ...createBody,
        note: 'Đã đổi ghi chú',
      },
    });
    assert.equal(updateDrift.status, 409);
    assert.match(String(updateDrift.body.error), /Khóa giao dịch trùng/i);

    const staleUpdate = await request(`/api/finance/fuel-invoices/${created.body.id}`, {
      method: 'PUT',
      token: accountantToken,
      body: {
        expectedVersion: created.body.version,
        ...createBody,
        note: 'Phiên bản cũ',
      },
    });
    assert.equal(staleUpdate.status, 409);
    assert.match(String(staleUpdate.body.error), /Vui lòng tải lại/i);

    // KP-152 (approval removal): the approve endpoint is gone — the race
    // scenario is replaced by a 404 pin. The invoice is APPROVED from
    // creation; the idempotency/version boundaries above carry concurrency.
    const approveAttempt = await request(`/api/finance/fuel-invoices/${created.body.id}/approve`, {
      method: 'POST',
      token: managerToken,
      body: { expectedVersion: updated.body.version, reason: 'Đề nghị duyệt hóa đơn A' },
    });
    assert.equal(approveAttempt.status, 404);

    const stored = await request(`/api/finance/fuel-invoices/${created.body.id}`, { token: managerToken });
    assert.equal(stored.body.approvalStatus, 'RECORDED');
  });

  test('adjustment and reversal materialize onto the approved invoice and apply immediately', async () => {
    const supplier = await mkSupplier();
    const truck = await mkTruck();
    const trip = await mkTrip(supplier.id, truck.id);
    const expense = await mkExpense({
      tripId: trip.id,
      supplierId: supplier.id,
      expenseType: 'FUEL_DIESEL',
      expenseDate: '2026-07-25',
      invoiceNumber: `PXD-Q18-${suffix}`,
      approvalStatus: 'APPROVED',
    });
    const invoiceBody = {
      supplierId: supplier.id,
      invoiceNumber: `HD-Q18-${suffix}`,
      invoiceDate: '2026-07-25',
      totalLiters: 100,
      unitPrice: 22000,
      note: 'Hóa đơn gốc đã duyệt',
      allocations: [{
        tripId: trip.id,
        truckId: truck.id,
        tripExpenseId: expense.id,
        voucherReference: `PXD-Q18-${suffix}`,
        voucherDate: '2026-07-25',
        liters: 100,
      }],
    };
    const created = await request('/api/finance/fuel-invoices', {
      method: 'POST',
      token: accountantToken,
      body: invoiceBody,
    });
    assert.equal(created.status, 201);
    // KP-152: APPROVED at creation — no approve call to make.
    const approvedInvoice = await request(`/api/finance/fuel-invoices/${created.body.id}`, {
      token: managerToken,
    });
    assert.equal(approvedInvoice.status, 200);
    assert.equal(approvedInvoice.body.approvalStatus, 'RECORDED');

    const directUpdate = await request(`/api/finance/fuel-invoices/${created.body.id}`, {
      method: 'PUT',
      token: accountantToken,
      body: {
        expectedVersion: approvedInvoice.body.version,
        ...invoiceBody,
        note: 'Sửa ghi chú trực tiếp',
      },
    });
    // KP-152: APPROVED invoices accept ordinary edits (guard removed with the
    // approval flow); the version token carries concurrency.
    assert.equal(directUpdate.status, 200);

    const correctionKey = `q18-fuel-adjust-${created.body.id}`;
    const correctionBody = {
      correctionType: 'ADJUSTMENT',
      expectedVersion: directUpdate.body.version,
      reason: 'Điều chỉnh tổng lít theo biên bản đối soát',
      correctedInvoice: {
        ...invoiceBody,
        totalLiters: 110,
        unitPrice: 20000,
        allocations: invoiceBody.allocations.map(row => ({ ...row, liters: 110 })),
        note: 'Điều chỉnh theo biên bản đối soát',
      },
    };
    const correction = await request(`/api/finance/fuel-invoices/${created.body.id}/corrections`, {
      method: 'POST',
      token: accountantToken,
      idempotencyKey: correctionKey,
      body: correctionBody,
    });
    assert.equal(correction.status, 201);
    // 2026-09-11 (maker-checker removal): the correction applies immediately
    // onto a transient governed action carrying the before/after snapshots.
    assert.equal(correction.body.status, 'APPROVED');
    assert.equal(correction.body.beforeSnapshot.invoice.totalLiters, 100);
    assert.equal(correction.body.afterSnapshot.invoice.totalLiters, 110);

    const correctionReplay = await request(`/api/finance/fuel-invoices/${created.body.id}/corrections`, {
      method: 'POST',
      token: accountantToken,
      idempotencyKey: correctionKey,
      body: correctionBody,
    });
    assert.equal(correctionReplay.status, 201);
    assert.equal(correctionReplay.body.replayed, true);
    assert.equal(correctionReplay.body.id, correction.body.id);

    // The staged check/approve calls are gone; the correction above already
    // applied atomically.

    const effective = await request(`/api/finance/fuel-invoices/${created.body.id}`, {
      token: managerToken,
    });
    assert.equal(effective.status, 200);
    // Corrected values are materialized: the row itself now carries them.
    assert.equal(Number(effective.body.totalLiters), 110);
    assert.equal(effective.body.note, 'Điều chỉnh theo biên bản đối soát');
    const adjustedReconciliation = await getFuelApReconciliation({
      from: '2026-07-25',
      to: '2026-07-25',
      supplierId: supplier.id,
    });
    assert.equal(adjustedReconciliation.totals.invoicedFuelCost, 2_200_000,
      'recon reads allocation lines, which stay at the corrected 100L x 22000');

    const [materializedRow] = await db.select().from(s.fuelInvoices)
      .where(eq(s.fuelInvoices.id, created.body.id));
    assert.equal(Number(materializedRow.totalLiters), 110);
    assert.equal(materializedRow.note, 'Điều chỉnh theo biên bản đối soát');
    assert.equal(materializedRow.approvalStatus, 'RECORDED');

    const staleCorrection = await request(`/api/finance/fuel-invoices/${created.body.id}/corrections`, {
      method: 'POST',
      token: accountantToken,
      body: {
        correctionType: 'REVERSAL',
        expectedVersion: approvedInvoice.body.version,
        reason: 'Phiên bản nguồn cũ',
      },
    });
    assert.equal(staleCorrection.status, 409);
    assert.match(String(staleCorrection.body.error), /tải lại/i);

    const reversal = await request(`/api/finance/fuel-invoices/${created.body.id}/corrections`, {
      method: 'POST',
      token: accountantToken,
      body: {
        correctionType: 'REVERSAL',
        expectedVersion: effective.body.version,
        reason: 'Hoàn tác hóa đơn do nhà cung cấp hủy chứng từ',
      },
    });
    assert.equal(reversal.status, 201);
    // 2026-09-10 (phê duyệt removed): the reversal applies immediately.
    assert.equal(reversal.body.status, 'APPROVED');

    const reversed = await request(`/api/finance/fuel-invoices/${created.body.id}`, {
      token: managerToken,
    });
    assert.equal(reversed.status, 200);
    assert.equal(reversed.body.approvalStatus, 'REVERSED');
    const reversedReconciliation = await getFuelApReconciliation({
      from: '2026-07-25',
      to: '2026-07-25',
      supplierId: supplier.id,
    });
    assert.equal(reversedReconciliation.totals.invoicedFuelCost, 0,
      'reversed invoices leave the effective APPROVED filter');

    const [reversedRow] = await db.select().from(s.fuelInvoices)
      .where(eq(s.fuelInvoices.id, created.body.id));
    assert.equal(reversedRow.approvalStatus, 'REVERSED');
  });

  // KP-152 (approval removal): the governed late-approval scenario is
  // unconstructable — the approve endpoint that minted the governed action
  // no longer exists. Period authority continues through resolveFuelPeriod
  // Authority/fuel_period_adjustments on the create path (see q06 boundary
  // tests and q21's remaining suites).

  test('fuel invoice create rolls back when idempotency persistence fails after the business callback', async () => {
    const supplier = await mkSupplier();
    const truck = await mkTruck();
    const trip = await mkTrip(supplier.id, truck.id);
    const expense = await mkExpense({
      tripId: trip.id,
      supplierId: supplier.id,
      expenseType: 'FUEL_DIESEL',
      expenseDate: '2026-07-20',
      invoiceNumber: 'PXD-Q23-ROLLBACK',
      approvalStatus: 'APPROVED',
    });
    await mkExpensePhoto(expense.id);

    const invoiceNumber = `HD-Q23-ROLLBACK-${suffix}`.slice(0, 50);
    const createKey = `q23-fuel-fail-${supplier.id}`;

    await withIdempotencyInsertFailure('fuel-invoices.create', createKey, async () => {
      const response = await request('/api/finance/fuel-invoices', {
        method: 'POST',
        token: accountantToken,
        idempotencyKey: createKey,
        body: {
          supplierId: supplier.id,
          invoiceNumber,
          invoiceDate: '2026-07-20',
          totalLiters: 100,
          unitPrice: 22000,
          allocations: [{
            tripId: trip.id,
            truckId: truck.id,
            tripExpenseId: expense.id,
            voucherReference: 'PXD-Q23-ROLLBACK',
            voucherDate: '2026-07-20',
            liters: 100,
          }],
        },
      });
      assert.equal(response.status, 500);
    });

    const storedInvoices = await db.select()
      .from(s.fuelInvoices)
      .where(eq(s.fuelInvoices.invoiceNumber, invoiceNumber));
    assert.equal(storedInvoices.length, 0);

    const storedKeys = await db.select()
      .from(s.idempotencyKeys)
      .where(eq(s.idempotencyKeys.idempotencyKey, createKey));
    assert.equal(storedKeys.length, 0);
  });
});
