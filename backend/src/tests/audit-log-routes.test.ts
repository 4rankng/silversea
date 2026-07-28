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
let server: http.Server;
let baseUrl: string;
let adminToken: string;
let managerToken: string;
let accountantToken: string;
let accountantId: number;

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
  accountantId = accountant.id;
  adminToken = sign(admin);
  managerToken = sign(manager);
  accountantToken = sign(accountant);

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
      body: { period: '2026-07', bankAccount: '0123456789' },
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
  if (createdCustomerIds.length > 0) {
    await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
  }
  if (createdUserIds.length > 0) {
    await db.delete(s.users).where(inArray(s.users.id, createdUserIds));
  }
  await client.end();
});

describe('audit-log route accountant scope', () => {
  test('ACCOUNTANT sees only finance and salary audit rows', async () => {
    const response = await request(`?search=${encodeURIComponent(marker)}`, { method: 'GET', token: accountantToken });
    assert.equal(response.status, 200);

    const actions = response.body.items.map((item: { action: string }) => item.action).sort();
    assert.deepEqual(actions, ['DRIVER_SALARY_RECORDED', 'ENTITY_CREATED', 'PAYMENT_RECEIVED']);
    assert.ok(response.body.items.every((item: { category: string }) => item.category === 'finance'));
  });

  test('ACCOUNTANT redacts sensitive payload and IP fields', async () => {
    const response = await request(`?search=${encodeURIComponent(marker)}`, { method: 'GET', token: accountantToken });
    assert.equal(response.status, 200);
    const paymentRow = response.body.items.find((item: { action: string }) => item.action === 'PAYMENT_RECEIVED');
    const billingRow = response.body.items.find((item: { action: string }) => item.action === 'ENTITY_CREATED');
    assert.ok(paymentRow);
    assert.ok(billingRow);
    assert.equal(paymentRow.ipAddress, null);
    assert.equal(paymentRow.path, '');
    assert.equal(paymentRow.method, '');
    assert.equal(paymentRow.payload.path, undefined);
    assert.equal(paymentRow.payload.method, undefined);
    assert.equal(paymentRow.payload.body, undefined);
    assert.equal(paymentRow.payload.statusCode, 201);
    assert.equal(paymentRow.payload.event, 'PAYMENT_RECEIVED');
    assert.equal(billingRow.category, 'finance');
    assert.equal(billingRow.payload.path, undefined);
    assert.equal(billingRow.payload.statusCode, 201);
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

  test('ACCOUNTANT with explicit customer assignments sees only matching customer-bound finance rows', async () => {
    const assignmentMarker = `o02-assigned-${suffix}`;
    const customers = await db.insert(s.customers).values([
      { name: `O02 assigned ${suffix}` },
      { name: `O02 outside ${suffix}` },
    ]).returning();
    createdCustomerIds.push(...customers.map((customer) => customer.id));
    await db.insert(s.userCustomerLinks).values({
      userId: accountantId,
      customerId: customers[0]!.id,
    });
    accountantToken = sign({
      id: accountantId,
      username: `audit-accountant-${suffix}`,
      role: Role.ACCOUNTANT,
      customerIds: [customers[0]!.id],
    });

    await insertAuditLog({
      userId: createdUserIds[0]!,
      actorName: 'Assigned payment',
      message: `Thanh toán trong phạm vi ${assignmentMarker}`,
      entityType: 'payments',
      entityId: 501,
      payload: {
        event: 'PAYMENT_RECEIVED',
        method: 'POST',
        path: '/api/payments/receive',
        statusCode: 201,
        body: { customerId: customers[0]!.id, amount: 100000 },
      },
    });
    await insertAuditLog({
      userId: createdUserIds[0]!,
      actorName: 'Outside payment',
      message: `Thanh toán ngoài phạm vi ${assignmentMarker}`,
      entityType: 'payments',
      entityId: 502,
      payload: {
        event: 'PAYMENT_RECEIVED',
        method: 'POST',
        path: '/api/payments/receive',
        statusCode: 201,
        body: { customerId: customers[1]!.id, amount: 200000 },
      },
    });

    const response = await request(
      `?search=${encodeURIComponent(assignmentMarker)}`,
      { method: 'GET', token: accountantToken },
    );
    assert.equal(response.status, 200);
    assert.equal(response.body.items.length, 1);
    assert.match(response.body.items[0].message, /trong phạm vi/);
  });
});
