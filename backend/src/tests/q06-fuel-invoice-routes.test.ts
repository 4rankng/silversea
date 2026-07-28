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
import { config } from '../config';
import { initEnforcer } from '../casbin/enforcer';
import { authMiddleware } from '../middleware/auth';
import { casbinAuthz } from '../middleware/casbin';
import { globalErrorHandler } from '../middleware/errorHandler';
import financialRoutes from '../routes/financial';

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

let server: http.Server;
let baseUrl: string;
let managerToken: string;
let accountantToken: string;
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
  const [trip] = await db.insert(s.trips).values({
    tripCode: `Q06-${suffix}-${createdTripIds.length}`.slice(0, 50),
    customerId: customer.id,
    routeId: route.id,
    cargoTypeId: cargo.id,
    status: 'COMPLETED',
    departureDate: '2026-07-20',
    carrierType: 'OWN',
    truckId,
    fuelSupplierId: supplierId,
    totalFuelCost: '2200000',
  }).returning();
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
  const [expense] = await db.insert(s.tripExpenses).values({
    tripId: opts.tripId,
    expenseType: opts.expenseType,
    buyAmount: opts.buyAmount ?? '2200000',
    sellAmount: '0',
    supplierId: opts.supplierId,
    expenseDate: opts.expenseDate ?? '2026-07-20',
    invoiceNumber: opts.invoiceNumber ?? null,
    declarationNumber: opts.declarationNumber ?? null,
    invoiceDate: '2026-07-20',
    approvalStatus: opts.approvalStatus ?? 'APPROVED',
  }).returning();
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

async function request(path: string, init: { method?: string; token: string; body?: unknown }) {
  const headers: Record<string, string> = { Authorization: `Bearer ${init.token}` };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${baseUrl}${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const body = await response.json().catch(() => ({}));
  if (body?.id && typeof body.id === 'number' && !createdFuelInvoiceIds.includes(body.id)) {
    createdFuelInvoiceIds.push(body.id);
  }
  return { status: response.status, body };
}

before(async () => {
  await initEnforcer();
  const manager = await mkUser(Role.MANAGER);
  const accountant = await mkUser(Role.ACCOUNTANT);
  const driver = await mkUser(Role.DRIVER);
  const customer = await mkUser(Role.CUSTOMER);

  managerToken = sign(manager);
  accountantToken = sign(accountant);
  driverToken = sign(driver);
  customerToken = sign(customer);

  const app = express();
  app.use(express.json());
  app.use('/api', authMiddleware, casbinAuthz('financial'), financialRoutes);
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
    if (createdExpensePhotoIds.length > 0) {
      await db.delete(s.tripExpensePhotos).where(inArray(s.tripExpensePhotos.id, createdExpensePhotoIds));
    }
    if (createdFuelInvoiceIds.length > 0) {
      await db.delete(s.fuelInvoices).where(inArray(s.fuelInvoices.id, createdFuelInvoiceIds));
    }
    if (createdExpenseIds.length > 0) {
      await db.delete(s.tripExpenses).where(inArray(s.tripExpenses.id, createdExpenseIds));
    }
    if (createdTripIds.length > 0) {
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

  test('approval requires a linked approved fuel expense on the same trip and supplier', async () => {
    const supplier = await mkSupplier();
    const truck = await mkTruck();
    const trip = await mkTrip(supplier.id, truck.id);
    const pendingFuelExpense = await mkExpense({
      tripId: trip.id,
      supplierId: supplier.id,
      expenseType: 'FUEL_DIESEL',
      expenseDate: '2026-07-21',
      approvalStatus: 'PENDING',
    });

    const created = await request('/api/finance/fuel-invoices', {
      method: 'POST',
      token: accountantToken,
      body: {
        supplierId: supplier.id,
        invoiceNumber: `HD-Q06-B-${suffix}`,
        invoiceDate: '2026-07-21',
        totalLiters: 100,
        unitPrice: 22000,
        allocations: [{
          tripId: trip.id,
          truckId: truck.id,
          voucherReference: `PXD-Q06-B-${suffix}`,
          voucherDate: '2026-07-21',
          liters: 100,
        }],
      },
    });
    assert.equal(created.status, 201);

    const missingEvidence = await request(`/api/finance/fuel-invoices/${created.body.id}/approve`, {
      method: 'POST',
      token: managerToken,
      body: {},
    });
    assert.equal(missingEvidence.status, 400);
    assert.match(String(missingEvidence.body.error), /chưa liên kết chi phí nhiên liệu thực tế đã duyệt/i);

    const pendingLinkUpdate = await request(`/api/finance/fuel-invoices/${created.body.id}`, {
      method: 'PUT',
      token: accountantToken,
      body: {
        supplierId: supplier.id,
        invoiceNumber: `HD-Q06-B-${suffix}`,
        invoiceDate: '2026-07-21',
        totalLiters: 100,
        unitPrice: 22000,
        allocations: [{
          tripId: trip.id,
          truckId: truck.id,
          tripExpenseId: pendingFuelExpense.id,
          voucherReference: `PXD-Q06-B-${suffix}`,
          voucherDate: '2026-07-21',
          liters: 100,
        }],
      },
    });
    assert.equal(pendingLinkUpdate.status, 400);
    assert.match(String(pendingLinkUpdate.body.error), /chưa ở trạng thái APPROVED/i);
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
    assert.match(String(wrongLiters.body.error), /không khớp chi phí nhiên liệu đã duyệt/i);

    const wrongReference = await request(`/api/finance/fuel-invoices/${created.body.id}`, {
      method: 'PUT',
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
          voucherReference: `PXD-Q06-C-${suffix}-WRONG`,
          voucherDate: '2026-07-22',
          liters: 100,
        }],
      },
    });
    assert.equal(wrongReference.status, 400);
    assert.match(String(wrongReference.body.error), /phải khớp chứng từ đã duyệt/i);
  });

  test('approval revalidates no-photo authority when linked expense has no invoice or declaration reference', async () => {
    const supplier = await mkSupplier();
    const truck = await mkTruck();
    const trip = await mkTrip(supplier.id, truck.id);
    const approvedFuelExpense = await mkExpense({
      tripId: trip.id,
      supplierId: supplier.id,
      expenseType: 'FUEL_DIESEL',
      expenseDate: '2026-07-23',
      approvalStatus: 'APPROVED',
    });
    const expensePhoto = await mkExpensePhoto(approvedFuelExpense.id);

    const created = await request('/api/finance/fuel-invoices', {
      method: 'POST',
      token: accountantToken,
      body: {
        supplierId: supplier.id,
        invoiceNumber: `HD-Q06-D-${suffix}`,
        invoiceDate: '2026-07-23',
        totalLiters: 100,
        unitPrice: 22000,
        allocations: [{
          tripId: trip.id,
          truckId: truck.id,
          tripExpenseId: approvedFuelExpense.id,
          voucherReference: `PXD-Q06-D-${suffix}`,
          voucherDate: '2026-07-23',
          liters: 100,
        }],
      },
    });
    assert.equal(created.status, 201);

    await db.delete(s.tripExpensePhotos).where(eq(s.tripExpensePhotos.id, expensePhoto.id));
    createdExpensePhotoIds.splice(createdExpensePhotoIds.indexOf(expensePhoto.id), 1);

    const approved = await request(`/api/finance/fuel-invoices/${created.body.id}/approve`, {
      method: 'POST',
      token: managerToken,
      body: {},
    });
    assert.equal(approved.status, 400);
    assert.match(String(approved.body.error), /chưa có số hóa đơn\/tờ khai và cũng chưa có ảnh phiếu bơm hoặc chứng từ/i);
  });
});
