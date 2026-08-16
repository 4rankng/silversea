import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { inArray } from 'drizzle-orm';

import { Role } from '@tingting/shared';
import { initEnforcer } from '../casbin/enforcer';
import { config } from '../config';
import { db, client } from '../db';
import * as s from '../db/schema';
import { authMiddleware } from '../middleware/auth';
import { casbinAuthz } from '../middleware/casbin';
import { globalErrorHandler } from '../middleware/errorHandler';
import { auditLogRouter } from '../routes/config';
import { ApiError } from '../errors';
import { queryAuditLogs } from '../services/audit-query.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const marker = `o02-audit-${suffix}`;
const createdUserIds: number[] = [];
const createdAuditLogIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdBusinessUnitIds: number[] = [];
const createdRouteIds: number[] = [];
const createdCargoTypeIds: number[] = [];
const createdTripIds: number[] = [];
const createdTripExpenseIds: number[] = [];
const createdBillingDocumentIds: number[] = [];
const createdDebtOffsetIds: number[] = [];
const createdCreditOverrideIds: number[] = [];
const createdPaymentReceiptIds: number[] = [];
const createdSupplierIds: number[] = [];
let server: http.Server;
let baseUrl: string;
let adminToken: string;
let managerToken: string;
let accountantToken: string;
let adminId: number;
let accountantId: number;
let scopedRouteId: number;
let scopedCargoTypeId: number;

async function mkUser(username: string, role: Role) {
  const [user] = await db.insert(s.users).values({
    username,
    passwordHash: await bcrypt.hash('admin123', 10),
    role,
  }).returning();
  createdUserIds.push(user.id);
  return user;
}

function sign(user: {
  id: number;
  username: string | null;
  role: Role | string;
  customerIds?: number[];
}) {
  return jwt.sign(
    {
      userId: user.id,
      username: user.username ?? `user-${user.id}`,
      role: user.role as Role,
      ...(user.customerIds ? { customerIds: user.customerIds } : {}),
    },
    config.jwtSecret,
  );
}

async function insertAuditLog(params: {
  userId: number;
  actorName: string;
  message: string;
  entityType: string;
  entityId: number;
  ipAddress?: string;
  payload: Record<string, unknown>;
}) {
  const [row] = await db.insert(s.auditLogs).values({
    userId: params.userId,
    actorName: params.actorName,
    message: params.message,
    entityType: params.entityType,
    entityId: params.entityId,
    ipAddress: params.ipAddress ?? '10.0.0.8',
    payload: params.payload,
  }).returning();
  createdAuditLogIds.push(row.id);
  return row;
}

async function setAccountantScope(customerIds: number[]) {
  await db.delete(s.userCustomerLinks).where(inArray(s.userCustomerLinks.userId, [accountantId]));
  if (customerIds.length > 0) {
    await db.insert(s.userCustomerLinks).values(
      customerIds.map((customerId) => ({ userId: accountantId, customerId })),
    );
  }
  accountantToken = sign({
    id: accountantId,
    username: `audit-accountant-${suffix}`,
    role: Role.ACCOUNTANT,
    ...(customerIds.length > 0 ? { customerIds } : {}),
  });
}

async function insertCustomer(name: string) {
  const [customer] = await db.insert(s.customers).values({ name }).returning();
  createdCustomerIds.push(customer.id);
  return customer;
}

async function insertBusinessUnit(name: string) {
  const [unit] = await db.insert(s.businessUnits).values({
    code: `O02-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    name,
    status: 'ACTIVE',
  }).returning();
  createdBusinessUnitIds.push(unit.id);
  return unit;
}

async function insertTrip(customerId: number) {
  const [trip] = await db.insert(s.trips).values({
    tripCode: `O02-TRIP-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    customerId,
    routeId: scopedRouteId,
    cargoTypeId: scopedCargoTypeId,
    departureDate: '2026-07-28',
    createdBy: adminId,
  }).returning();
  createdTripIds.push(trip.id);
  return trip;
}

async function insertTripExpense(tripId: number) {
  const [expense] = await db.insert(s.tripExpenses).values({
    tripId,
    createdBy: adminId,
    expenseType: 'LIFT',
    buyAmount: '125000',
    sellAmount: '0',
    approvalStatus: 'APPROVED',
    note: `O02 expense ${suffix}`,
  }).returning();
  createdTripExpenseIds.push(expense.id);
  return expense;
}

async function insertBillingDocument(customerId: number) {
  const [document] = await db.insert(s.billingDocuments).values({
    type: 'DEBIT_NOTE',
    entityType: 'CUSTOMER',
    entityId: customerId,
    entityName: `Customer ${customerId}`,
    rangeFrom: '2026-07-01',
    rangeTo: '2026-07-31',
    createdBy: adminId,
    totalInclVat: '2500000',
    debitNoteStatus: 'DRAFT',
  }).returning();
  createdBillingDocumentIds.push(document.id);
  return document;
}

async function insertSupplier(name: string) {
  const [supplier] = await db.insert(s.suppliers).values({
    name,
    status: 'ACTIVE',
  }).returning();
  createdSupplierIds.push(supplier.id);
  return supplier;
}

async function insertDebtOffset(customerId: number, supplierId: number) {
  const [offset] = await db.insert(s.debtOffsets).values({
    customerId,
    supplierId,
    amount: '350000',
    offsetDate: '2026-07-28',
    approvalStatus: 'PENDING',
    createdBy: adminId,
  }).returning();
  createdDebtOffsetIds.push(offset.id);
  return offset;
}

async function insertCreditOverride(customerId: number) {
  const [request] = await db.insert(s.creditOverrideRequests).values({
    customerId,
    scopeType: 'EXPIRY',
    status: 'PENDING',
    requiredTier: 'FINANCE_TIER_1',
    reason: `O02 override ${suffix}`,
    requestedBy: adminId,
    requestedRole: Role.ADMIN,
    proposedAmount: '4000000',
    outstandingAmount: '2000000',
    approvedCommitmentAmount: '0',
    totalExposure: '2000000',
    creditLimit: '10000000',
    warningThreshold: '0.80',
    overLimitAmount: '1000000',
    overLimitRatio: '0.10',
    repeatException: false,
    expiresAt: new Date('2026-08-31T00:00:00.000Z'),
  }).returning();
  createdCreditOverrideIds.push(request.id);
  return request;
}

async function insertPaymentReceipt(customerId: number) {
  const [receipt] = await db.insert(s.paymentReceipts).values({
    receiptId: `O02-RCPT-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    customerId,
    receivedAmount: '900000',
    allocatedTotal: '900000',
    unappliedAmount: '0',
    refundedAmount: '0',
    allocationMethod: 'EXPLICIT',
    requestHash: `o02-${Math.random().toString(36).slice(2, 12)}`,
    createdBy: adminId,
  }).returning();
  createdPaymentReceiptIds.push(receipt.id);
  return receipt;
}

async function request(path = '', init: { token: string } & RequestInit) {
  const response = await fetch(`${baseUrl}/api/audit-logs${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${init.token}`,
      ...(init.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

before(async () => {
  await initEnforcer();

  const app = express();
  app.use(express.json());
  app.use('/api/audit-logs', authMiddleware, casbinAuthz('audit_logs'), auditLogRouter);
  app.use(globalErrorHandler);
  await new Promise<void>((resolve) => {
    server = http.createServer(app);
    server.listen(0, () => {
      baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });

  const admin = await mkUser(`audit-admin-${suffix}`, Role.ADMIN);
  const manager = await mkUser(`audit-manager-${suffix}`, Role.MANAGER);
  const accountant = await mkUser(`audit-accountant-${suffix}`, Role.ACCOUNTANT);
  adminId = admin.id;
  accountantId = accountant.id;
  adminToken = sign(admin);
  managerToken = sign(manager);
  accountantToken = sign(accountant);

  const [route] = await db.insert(s.routes).values({
    name: `O02 route ${suffix}`,
  }).returning();
  createdRouteIds.push(route.id);
  scopedRouteId = route.id;

  const [cargoType] = await db.insert(s.cargoTypes).values({
    name: `O02 cargo ${suffix}`,
  }).returning();
  createdCargoTypeIds.push(cargoType.id);
  scopedCargoTypeId = cargoType.id;

  await insertAuditLog({
    userId: admin.id,
    actorName: 'Admin Audit',
    message: `Đã ghi nhận thanh toán chuyến ${marker}`,
    entityType: 'payments',
    entityId: 101,
    ipAddress: '203.0.113.1',
    payload: {
      event: 'PAYMENT_RECEIVED',
      method: 'POST',
      path: '/api/payments/receive',
      statusCode: 201,
      body: { receiptNumber: 'PT-101', amount: 1250000 },
    },
  });
  await insertAuditLog({
    userId: manager.id,
    actorName: 'Manager Payroll',
    message: `Đã ghi nhận bảng lương tháng 07 ${marker}`,
    entityType: 'salary-periods',
    entityId: 202607,
    ipAddress: '203.0.113.2',
    payload: {
      event: 'DRIVER_SALARY_RECORDED',
      method: 'POST',
      path: '/api/salary/close',
      statusCode: 200,
      body: {
        period: '2026-07',
        bankAccount: '0123456789',
        businessUnitId: 9_001,
        credentials: { accessToken: 'must-not-leak' },
      },
    },
  });
  await insertAuditLog({
    userId: admin.id,
    actorName: 'Admin Billing',
    message: `Đã tạo chứng từ công nợ ${marker}`,
    entityType: 'finance',
    entityId: 401,
    ipAddress: '203.0.113.7',
    payload: {
      event: 'ENTITY_CREATED',
      method: 'POST',
      path: '/api/finance/billing-documents',
      statusCode: 201,
      body: { documentNumber: 'BD-401', totalAmount: 2500000 },
    },
  });
  await insertAuditLog({
    userId: admin.id,
    actorName: 'Admin Login',
    message: `Đăng nhập thành công ${marker}`,
    entityType: 'auth',
    entityId: 1,
    ipAddress: '198.51.100.9',
    payload: {
      event: 'USER_LOGIN',
      method: 'POST',
      path: '/api/auth/login',
      statusCode: 200,
      body: { identifier: 'admin', password: 'must-not-leak' },
    },
  });
  await insertAuditLog({
    userId: admin.id,
    actorName: 'Admin Config',
    message: `Đã cập nhật cài đặt ứng dụng ${marker}`,
    entityType: 'app-settings',
    entityId: 1,
    ipAddress: '198.51.100.10',
    payload: {
      event: 'ENTITY_UPDATED',
      method: 'PUT',
      path: '/api/config/app-settings',
      statusCode: 200,
      body: { resendApiKey: 'secret' },
    },
  });
  await insertAuditLog({
    userId: manager.id,
    actorName: 'Ops Manager',
    message: `Đã điều vận chuyến TRP-01 ${marker}`,
    entityType: 'trips',
    entityId: 301,
    ipAddress: '198.51.100.11',
    payload: {
      event: 'TRIP_DISPATCHED',
      method: 'POST',
      path: '/api/trips/301/dispatch',
      statusCode: 200,
    },
  });
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (createdAuditLogIds.length > 0) {
    await db.delete(s.auditLogs).where(inArray(s.auditLogs.id, createdAuditLogIds));
  }
  if (createdTripExpenseIds.length > 0) {
    await db.delete(s.tripExpenses).where(inArray(s.tripExpenses.id, createdTripExpenseIds));
  }
  if (createdTripIds.length > 0) {
    await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
  }
  if (createdPaymentReceiptIds.length > 0) {
    await db.delete(s.paymentReceipts).where(inArray(s.paymentReceipts.id, createdPaymentReceiptIds));
  }
  if (createdBillingDocumentIds.length > 0) {
    await db.delete(s.billingDocuments).where(inArray(s.billingDocuments.id, createdBillingDocumentIds));
  }
  if (createdDebtOffsetIds.length > 0) {
    await db.delete(s.debtOffsets).where(inArray(s.debtOffsets.id, createdDebtOffsetIds));
  }
  if (createdCreditOverrideIds.length > 0) {
    await db.delete(s.creditOverrideRequests).where(inArray(s.creditOverrideRequests.id, createdCreditOverrideIds));
  }
  if (createdSupplierIds.length > 0) {
    await db.delete(s.suppliers).where(inArray(s.suppliers.id, createdSupplierIds));
  }
  if (createdCustomerIds.length > 0) {
    await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
  }
  if (createdBusinessUnitIds.length > 0) {
    await db.delete(s.businessUnits).where(inArray(s.businessUnits.id, createdBusinessUnitIds));
  }
  if (createdRouteIds.length > 0) {
    await db.delete(s.routes).where(inArray(s.routes.id, createdRouteIds));
  }
  if (createdCargoTypeIds.length > 0) {
    await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, createdCargoTypeIds));
  }
  if (createdUserIds.length > 0) {
    await db.delete(s.users).where(inArray(s.users.id, createdUserIds));
  }
  await client.end();
});

describe('audit-log route accountant scope', () => {
  test('ACCOUNTANT without explicit assignments sees only safe non-customer finance rows', async () => {
    await setAccountantScope([]);
    const response = await request(`?search=${encodeURIComponent(marker)}`, { method: 'GET', token: accountantToken });
    assert.equal(response.status, 200);

    const actions = response.body.items.map((item: { action: string }) => item.action).sort();
    assert.deepEqual(actions, ['DRIVER_SALARY_RECORDED']);
    assert.ok(response.body.items.every((item: { category: string }) => item.category === 'finance'));
  });

  test('ACCOUNTANT redacts non-customer operational rows and hides unrelated business-unit details', async () => {
    await setAccountantScope([]);
    const response = await request(`?search=${encodeURIComponent(marker)}`, { method: 'GET', token: accountantToken });
    assert.equal(response.status, 200);
    assert.equal(response.body.items.length, 1);
    const salaryRow = response.body.items[0];
    assert.equal(salaryRow.action, 'DRIVER_SALARY_RECORDED');
    assert.equal(salaryRow.ipAddress, null);
    assert.equal(salaryRow.path, '');
    assert.equal(salaryRow.method, '');
    assert.equal(salaryRow.payload.path, undefined);
    assert.equal(salaryRow.payload.method, undefined);
    assert.equal(salaryRow.payload.body, undefined);
    assert.equal(salaryRow.payload.statusCode, 200);
    assert.equal(salaryRow.payload.event, 'DRIVER_SALARY_RECORDED');
    assert.equal(salaryRow.payload.credentials, undefined);
    assert.equal(salaryRow.payload.businessUnitId, undefined);
  });

  test('ACCOUNTANT category filters cannot widen into auth/config rows', async () => {
    const authResponse = await request(`?category=auth&search=${encodeURIComponent(marker)}`, { method: 'GET', token: accountantToken });
    const configResponse = await request(`?category=config&search=${encodeURIComponent(marker)}`, { method: 'GET', token: accountantToken });
    assert.equal(authResponse.status, 200);
    assert.equal(configResponse.status, 200);
    assert.deepEqual(authResponse.body.items, []);
    assert.deepEqual(configResponse.body.items, []);
  });

  test('ADMIN and MANAGER keep the existing broad read surface', async () => {
    const adminResponse = await request(`?search=${encodeURIComponent(marker)}`, { method: 'GET', token: adminToken });
    const managerResponse = await request(`?search=${encodeURIComponent(marker)}`, { method: 'GET', token: managerToken });

    assert.equal(adminResponse.status, 200);
    assert.equal(managerResponse.status, 200);
    assert.equal(adminResponse.body.items.length, 6);
    assert.equal(managerResponse.body.items.length, 6);

    const loginRow = adminResponse.body.items.find((item: { action: string }) => item.action === 'USER_LOGIN');
    const billingRow = adminResponse.body.items.find((item: { action: string; path: string }) => item.action === 'ENTITY_CREATED' && item.path === '/api/finance/billing-documents');
    assert.ok(loginRow);
    assert.ok(billingRow);
    assert.equal(loginRow.ipAddress, '198.51.100.9');
    assert.equal(loginRow.path, '/api/auth/login');
    assert.equal(loginRow.method, 'POST');
    assert.equal(loginRow.payload.path, '/api/auth/login');
    assert.equal(billingRow.category, 'finance');
  });

  test('queryAuditLogs fails closed for non-office viewers', async () => {
    await assert.rejects(
      queryAuditLogs({
        page: 1,
        limit: 10,
        search: marker,
        viewer: { userId: 999_999, role: Role.DRIVER },
      }),
      (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.statusCode, 403);
        assert.equal(error.message, 'Vai trò không được xem nhật ký người dùng');
        return true;
      },
    );
  });

  test('ACCOUNTANT resolves every supported customer-scope branch and keeps pagination/count parity', async () => {
    const assignmentMarker = `o02-assigned-${suffix}`;
    const assignedCustomer = await insertCustomer(`O02 assigned ${suffix}`);
    const outsideCustomer = await insertCustomer(`O02 outside ${suffix}`);
    const unrelatedUnit = await insertBusinessUnit(`O02 unrelated unit ${suffix}`);
    const assignedTrip = await insertTrip(assignedCustomer.id);
    const outsideTrip = await insertTrip(outsideCustomer.id);
    const assignedExpense = await insertTripExpense(assignedTrip.id);
    const assignedReceipt = await insertPaymentReceipt(assignedCustomer.id);
    const assignedDocument = await insertBillingDocument(assignedCustomer.id);
    const outsideDocument = await insertBillingDocument(outsideCustomer.id);
    const supplier = await insertSupplier(`O02 supplier ${suffix}`);
    const assignedOffset = await insertDebtOffset(assignedCustomer.id, supplier.id);
    const assignedOverride = await insertCreditOverride(assignedCustomer.id);

    await setAccountantScope([assignedCustomer.id]);
    await insertAuditLog({
      userId: adminId,
      actorName: 'Assigned direct customer',
      message: `Direct customer ${assignmentMarker}`,
      entityType: 'payments',
      entityId: 501,
      payload: {
        event: 'PAYMENT_RECEIVED',
        method: 'POST',
        path: '/api/payments/receive',
        statusCode: 201,
        body: { customerId: assignedCustomer.id, amount: 100000 },
      },
    });
    await insertAuditLog({
      userId: adminId,
      actorName: 'Assigned direct trip',
      message: `Direct trip ${assignmentMarker}`,
      entityType: 'payments',
      entityId: 502,
      payload: {
        event: 'PAYMENT_RECEIVED',
        method: 'POST',
        path: '/api/payments/receive',
        statusCode: 201,
        body: { tripId: assignedTrip.id, amount: 120000 },
      },
    });
    await insertAuditLog({
      userId: adminId,
      actorName: 'Assigned trip entity',
      message: `Trip entity ${assignmentMarker}`,
      entityType: 'trip',
      entityId: assignedTrip.id,
      payload: {
        event: 'ADJUSTMENT_CREATED',
        method: 'POST',
        path: '/api/adjustments',
        statusCode: 201,
      },
    });
    await insertAuditLog({
      userId: adminId,
      actorName: 'Assigned expense entity',
      message: `Expense entity ${assignmentMarker}`,
      entityType: 'trip-expenses',
      entityId: assignedExpense.id,
      payload: {
        event: 'TRIP_EXPENSE_APPROVED',
        method: 'POST',
        path: `/api/expenses/${assignedExpense.id}/approve`,
        statusCode: 200,
      },
    });
    await insertAuditLog({
      userId: adminId,
      actorName: 'Assigned receipt entity',
      message: `Receipt entity ${assignmentMarker}`,
      entityType: 'payments',
      entityId: assignedReceipt.id,
      payload: {
        event: 'PAYMENT_RECEIVED',
        method: 'POST',
        path: '/api/payments/receive',
        statusCode: 201,
      },
    });
    await insertAuditLog({
      userId: adminId,
      actorName: 'Assigned billing entity',
      message: `Billing entity ${assignmentMarker}`,
      entityType: 'billing_document',
      entityId: assignedDocument.id,
      payload: {
        event: 'ENTITY_CREATED',
        method: 'POST',
        path: `/api/finance/billing-documents/${assignedDocument.id}`,
        statusCode: 201,
      },
    });
    await insertAuditLog({
      userId: adminId,
      actorName: 'Assigned debt offset entity',
      message: `Debt offset entity ${assignmentMarker}`,
      entityType: 'debt_offset',
      entityId: assignedOffset.id,
      payload: {
        event: 'ENTITY_CREATED',
        method: 'POST',
        path: `/api/finance/debt-offsets/${assignedOffset.id}/approve`,
        statusCode: 201,
      },
    });
    await insertAuditLog({
      userId: adminId,
      actorName: 'Assigned credit override entity',
      message: `Credit override entity ${assignmentMarker}`,
      entityType: 'credit_override',
      entityId: assignedOverride.id,
      payload: {
        event: 'ENTITY_UPDATED',
        method: 'POST',
        path: `/api/finance/credit-overrides/${assignedOverride.id}/approve`,
        statusCode: 200,
      },
    });
    await insertAuditLog({
      userId: adminId,
      actorName: 'Assigned non-customer salary',
      message: `Salary ${assignmentMarker}`,
      entityType: 'salary-periods',
      entityId: unrelatedUnit.id,
      payload: {
        event: 'DRIVER_SALARY_RECORDED',
        method: 'POST',
        path: '/api/salary/close',
        statusCode: 200,
        body: {
          period: '2026-07',
          businessUnitId: unrelatedUnit.id,
          nested: { password: 'hidden' },
        },
      },
    });
    await insertAuditLog({
      userId: adminId,
      actorName: 'Outside direct customer',
      message: `Outside direct customer ${assignmentMarker}`,
      entityType: 'payments',
      entityId: 503,
      payload: {
        event: 'PAYMENT_RECEIVED',
        method: 'POST',
        path: '/api/payments/receive',
        statusCode: 201,
        body: { customerId: outsideCustomer.id, amount: 200000 },
      },
    });
    await insertAuditLog({
      userId: adminId,
      actorName: 'Outside billing entity',
      message: `Outside billing entity ${assignmentMarker}`,
      entityType: 'billing_document',
      entityId: outsideDocument.id,
      payload: {
        event: 'ENTITY_CREATED',
        method: 'POST',
        path: `/api/finance/billing-documents/${outsideDocument.id}`,
        statusCode: 201,
      },
    });
    await insertAuditLog({
      userId: adminId,
      actorName: 'Outside trip direct',
      message: `Outside trip ${assignmentMarker}`,
      entityType: 'payments',
      entityId: 504,
      payload: {
        event: 'PAYMENT_RECEIVED',
        method: 'POST',
        path: '/api/payments/receive',
        statusCode: 201,
        body: { tripId: outsideTrip.id, amount: 330000 },
      },
    });
    await insertAuditLog({
      userId: adminId,
      actorName: 'Unresolved customer-bound payment',
      message: `Unresolved payment ${assignmentMarker}`,
      entityType: 'payments',
      entityId: 999_999,
      payload: {
        event: 'PAYMENT_RECEIVED',
        method: 'POST',
        path: '/api/payments/receive',
        statusCode: 201,
      },
    });

    const pageOne = await request(
      `?search=${encodeURIComponent(assignmentMarker)}&limit=3&page=1`,
      { method: 'GET', token: accountantToken },
    );
    const pageTwo = await request(
      `?search=${encodeURIComponent(assignmentMarker)}&limit=3&page=2`,
      { method: 'GET', token: accountantToken },
    );
    const pageThree = await request(
      `?search=${encodeURIComponent(assignmentMarker)}&limit=3&page=3`,
      { method: 'GET', token: accountantToken },
    );
    const pageFour = await request(
      `?search=${encodeURIComponent(assignmentMarker)}&limit=3&page=4`,
      { method: 'GET', token: accountantToken },
    );

    for (const response of [pageOne, pageTwo, pageThree, pageFour]) {
      assert.equal(response.status, 200);
      assert.equal(response.body.total, 9);
    }

    const combinedItems = [
      ...pageOne.body.items,
      ...pageTwo.body.items,
      ...pageThree.body.items,
      ...pageFour.body.items,
    ] as Array<{ id: number; message: string; action: string; category: string; path: string; method: string; ipAddress: string | null; payload: Record<string, unknown> }>;
    assert.equal(new Set(combinedItems.map((item) => item.id)).size, 9);
    assert.equal(pageFour.body.items.length, 0);
    assert.ok(combinedItems.every((item) => item.category === 'finance'));

    const messages = combinedItems.map((item) => item.message).sort();
    assert.deepEqual(messages, [
      `Billing entity ${assignmentMarker}`,
      `Credit override entity ${assignmentMarker}`,
      `Debt offset entity ${assignmentMarker}`,
      `Direct customer ${assignmentMarker}`,
      `Direct trip ${assignmentMarker}`,
      `Expense entity ${assignmentMarker}`,
      `Receipt entity ${assignmentMarker}`,
      `Salary ${assignmentMarker}`,
      `Trip entity ${assignmentMarker}`,
    ].sort());

    const salaryRow = combinedItems.find((item) => item.message === `Salary ${assignmentMarker}`);
    assert.ok(salaryRow);
    assert.equal(salaryRow.path, '');
    assert.equal(salaryRow.method, '');
    assert.equal(salaryRow.ipAddress, null);
    assert.equal(salaryRow.payload.body, undefined);
    assert.equal(salaryRow.payload.businessUnitId, undefined);

    const hiddenMessages = [
      `Outside direct customer ${assignmentMarker}`,
      `Outside billing entity ${assignmentMarker}`,
      `Outside trip ${assignmentMarker}`,
      `Unresolved payment ${assignmentMarker}`,
    ];
    for (const hidden of hiddenMessages) {
      assert.ok(!messages.includes(hidden), `${hidden} must stay hidden`);
    }

    await setAccountantScope([outsideCustomer.id]);
    const movedScope = await request(
      `?search=${encodeURIComponent(assignmentMarker)}`,
      { method: 'GET', token: accountantToken },
    );
    assert.equal(movedScope.status, 200);
    assert.deepEqual(
      movedScope.body.items.map((item: { message: string }) => item.message).sort(),
      [
        `Outside billing entity ${assignmentMarker}`,
        `Outside direct customer ${assignmentMarker}`,
        `Outside trip ${assignmentMarker}`,
        `Salary ${assignmentMarker}`,
      ].sort(),
    );

    await setAccountantScope([]);
    const clearedScope = await request(
      `?search=${encodeURIComponent(assignmentMarker)}`,
      { method: 'GET', token: accountantToken },
    );
    assert.equal(clearedScope.status, 200);
    assert.deepEqual(
      clearedScope.body.items.map((item: { message: string }) => item.message),
      [`Salary ${assignmentMarker}`],
    );
  });
});
