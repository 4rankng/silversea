import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { eq, inArray } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import { db, client } from '../db';
import * as s from '../db/schema';
import { config } from '../config';
import { initEnforcer } from '../casbin/enforcer';
import { authMiddleware } from '../middleware/auth';
import { casbinAuthz, requireRoles } from '../middleware/casbin';
import { globalErrorHandler } from '../middleware/errorHandler';
import { createShipment } from '../services/shipment.service';
import { createUser } from '../services/user.service';
import portalRoutes from '../routes/portal/index';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const customerIds: number[] = [];
const userIds: number[] = [];
const documentIds: number[] = [];
let customerToken: string;
let multiCustomerToken: string;
let unmappedCustomerToken: string;
let server: http.Server;
let baseUrl: string;
let ownCustomerId: number;
let ownCustomerName: string;
let ownPendingId: number;
let ownSentId: number;
let foreignPendingId: number;
let multiCustomerId: number;
let multiShipmentId: number;
let multiPendingId: number;

async function createCustomer(name: string) {
  const [customer] = await db.insert(s.customers).values({ name: `${name} ${suffix}` }).returning();
  customerIds.push(customer.id);
  return customer;
}

async function createDocument(customerId: number, status: 'SENT' | 'PENDING_CONFIRM') {
  const month = String(7 + documentIds.length).padStart(2, '0');
  const [document] = await db.insert(s.billingDocuments).values({
    type: 'DEBIT_NOTE',
    entityType: 'CUSTOMER',
    entityId: customerId,
    entityName: `Customer ${customerId}`,
    rangeFrom: `2026-${month}-01`,
    rangeTo: `2026-${month}-28`,
    totalInclVat: '1000000',
    debitNoteStatus: status,
  }).returning();
  documentIds.push(document.id);
  await db.insert(s.billingDocumentLines).values({
    documentId: document.id,
    sourceType: 'ADHOC',
    sourceId: null,
    lineType: 'ADHOC',
    typeLabel: 'Cước vận chuyển',
    unit: 'lần',
    description: 'Tuyến kiểm thử',
    baseAmount: '1000000',
    sortOrder: 0,
  });
  return document;
}

async function request(
  path: string,
  init: { method?: string; token?: string } = {},
) {
  const response = await fetch(`${baseUrl}/api/portal${path}`, {
    method: init.method ?? 'GET',
    headers: init.token ? { Authorization: `Bearer ${init.token}` } : undefined,
  });
  const contentType = response.headers.get('content-type') ?? '';
  const body = contentType.includes('application/pdf')
    ? Buffer.from(await response.arrayBuffer())
    : await response.json().catch(() => ({}));
  return { status: response.status, contentType, body };
}

before(async () => {
  await initEnforcer();
  const app = express();
  app.use(express.json());
  app.use(
    '/api/portal',
    authMiddleware,
    casbinAuthz('customer_portal'),
    requireRoles(Role.CUSTOMER),
    portalRoutes,
  );
  app.use(globalErrorHandler);
  await new Promise<void>((resolve) => {
    server = http.createServer(app);
    server.listen(0, () => {
      baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });

  const ownCustomer = await createCustomer('Portal own');
  ownCustomerId = ownCustomer.id;
  ownCustomerName = ownCustomer.name;
  const foreignCustomer = await createCustomer('Portal foreign');
  const multiCustomer = await createCustomer('Portal multi');
  multiCustomerId = multiCustomer.id;
  const [user] = await db.insert(s.users).values({
    username: `portal-customer-${suffix}`,
    passwordHash: await bcrypt.hash('admin123', 10),
    role: Role.CUSTOMER,
    customerId: ownCustomer.id,
  }).returning();
  userIds.push(user.id);
  customerToken = jwt.sign(
    { userId: user.id, username: user.username, role: user.role, customerId: ownCustomer.id },
    config.jwtSecret,
  );

  const [unmappedUser] = await db.insert(s.users).values({
    username: `portal-customer-unmapped-${suffix}`,
    passwordHash: await bcrypt.hash('admin123', 10),
    role: Role.CUSTOMER,
  }).returning();
  userIds.push(unmappedUser.id);
  unmappedCustomerToken = jwt.sign(
    { userId: unmappedUser.id, username: unmappedUser.username, role: unmappedUser.role },
    config.jwtSecret,
  );

  const multiUser = await createUser({
    username: `portal-customer-multi-${suffix}`,
    password: 'admin123',
    role: Role.CUSTOMER,
    customerIds: [ownCustomer.id, multiCustomer.id],
  });
  userIds.push(multiUser.id);
  multiCustomerToken = jwt.sign(
    {
      userId: multiUser.id,
      username: multiUser.username,
      role: multiUser.role,
      customerId: multiUser.customerId ?? undefined,
      customerIds: multiUser.customerIds,
    },
    config.jwtSecret,
  );

  ownPendingId = (await createDocument(ownCustomer.id, 'PENDING_CONFIRM')).id;
  await db.update(s.billingDocumentLines)
    .set({ amountOverride: '1250000' })
    .where(eq(s.billingDocumentLines.documentId, ownPendingId));
  await db.insert(s.billingDocumentLines).values({
    documentId: ownPendingId,
    sourceType: 'ADHOC',
    sourceId: null,
    lineType: 'ADHOC',
    typeLabel: 'Khoản nội bộ đã loại',
    unit: 'lần',
    description: 'Không được lộ ra cổng khách hàng',
    baseAmount: '9999999',
    amountOverride: '8888888',
    excluded: true,
    sortOrder: 99,
  });
  ownSentId = (await createDocument(ownCustomer.id, 'SENT')).id;
  foreignPendingId = (await createDocument(foreignCustomer.id, 'PENDING_CONFIRM')).id;
  multiPendingId = (await createDocument(multiCustomer.id, 'PENDING_CONFIRM')).id;
  multiShipmentId = (await createShipment({ customerId: multiCustomer.id })).id;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (documentIds.length > 0) {
    await db.delete(s.billingDocumentLines).where(inArray(s.billingDocumentLines.documentId, documentIds));
    await db.delete(s.billingDocuments).where(inArray(s.billingDocuments.id, documentIds));
  }
  if (multiShipmentId) {
    await db.delete(s.customerEmailLogs).where(eq(s.customerEmailLogs.shipmentId, multiShipmentId));
    await db.delete(s.shipments).where(eq(s.shipments.id, multiShipmentId));
  }
  if (userIds.length > 0) await db.delete(s.users).where(inArray(s.users.id, userIds));
  if (customerIds.length > 0) await db.delete(s.customers).where(inArray(s.customers.id, customerIds));
  await client.end();
});

describe('CUSTOMER portal HTTP security contract', () => {
  test('list is paginated summary-only data', async () => {
    const response = await request('/debit-notes?page=1&limit=1', { token: customerToken });
    assert.equal(response.status, 200);
    const body = response.body as { items: Array<Record<string, unknown>>; total: number; page: number; limit: number };
    assert.equal(body.items.length, 1);
    assert.equal(body.total, 2);
    assert.equal(body.page, 1);
    assert.equal(body.limit, 1);
    assert.ok(!('lines' in body.items[0]));
  });

  test('foreign debit-note detail, action, and export all return 404', async () => {
    const [detail, action, exported] = await Promise.all([
      request(`/debit-notes/${foreignPendingId}`, { token: customerToken }),
      request(`/debit-notes/${foreignPendingId}/confirm`, { method: 'POST', token: customerToken }),
      request(`/debit-notes/${foreignPendingId}/export?format=pdf`, { token: customerToken }),
    ]);
    assert.deepEqual([detail.status, action.status, exported.status], [404, 404, 404]);
  });

  test('customer-scope endpoint exposes linked customer choices', async () => {
    const response = await request('/customer-scope', { token: multiCustomerToken });
    assert.equal(response.status, 200);
    const body = response.body as {
      primaryCustomerId: number | null;
      customers: Array<{ id: number; name: string }>;
    };
    assert.equal(body.primaryCustomerId, ownCustomerId);
    assert.deepEqual(body.customers.map((item) => item.id).sort((a, b) => a - b), [ownCustomerId, multiCustomerId]);
  });

  test('selected customerId scopes list and statement routes to that customer only', async () => {
    const shipments = await request(`/shipments?customerId=${multiCustomerId}`, { token: multiCustomerToken });
    assert.equal(shipments.status, 200);
    const shipmentBody = shipments.body as { items: Array<{ id: number }>; total: number };
    assert.equal(shipmentBody.total, 1);
    assert.equal(shipmentBody.items[0].id, multiShipmentId);

    const debitNotes = await request(`/debit-notes?customerId=${multiCustomerId}`, { token: multiCustomerToken });
    assert.equal(debitNotes.status, 200);
    const debitNoteBody = debitNotes.body as { items: Array<{ id: number }>; total: number };
    assert.equal(debitNoteBody.total, 1);
    assert.equal(debitNoteBody.items[0].id, multiPendingId);

    const detail = await request(`/debit-notes/${multiPendingId}?customerId=${multiCustomerId}`, { token: multiCustomerToken });
    assert.equal(detail.status, 200);

    const statement = await request(`/statement?customerId=${multiCustomerId}`, { token: multiCustomerToken });
    assert.equal(statement.status, 200);
    const statementBody = statement.body as { customer: { id: number } };
    assert.equal(statementBody.customer.id, multiCustomerId);

    const exported = await request(`/statement/export?format=pdf&customerId=${multiCustomerId}`, { token: multiCustomerToken });
    assert.equal(exported.status, 200);
    assert.match(exported.contentType, /^application\/pdf/);
  });

  test('detail and mutation routes are bound to the explicitly selected customer', async () => {
    const [
      shipmentWrongScope,
      detailWrongScope,
      confirmWrongScope,
      exportWrongScope,
    ] = await Promise.all([
      request(`/shipments/${multiShipmentId}?customerId=${ownCustomerId}`, { token: multiCustomerToken }),
      request(`/debit-notes/${multiPendingId}?customerId=${ownCustomerId}`, { token: multiCustomerToken }),
      request(`/debit-notes/${multiPendingId}/confirm?customerId=${ownCustomerId}`, { method: 'POST', token: multiCustomerToken }),
      request(`/debit-notes/${multiPendingId}/export?format=pdf&customerId=${ownCustomerId}`, { token: multiCustomerToken }),
    ]);
    assert.deepEqual(
      [shipmentWrongScope.status, detailWrongScope.status, confirmWrongScope.status, exportWrongScope.status],
      [404, 404, 404, 404],
    );
  });

  test('own debit-note detail omits internal creator/template/source fields', async () => {
    const response = await request(`/debit-notes/${ownPendingId}`, { token: customerToken });
    assert.equal(response.status, 200);
    const body = response.body as Record<string, unknown> & { lines: Array<Record<string, unknown>> };
    assert.ok(!('createdBy' in body));
    assert.ok(!('debitNoteTemplateId' in body));
    assert.ok(!('debitNoteTemplateSnapshot' in body));
    assert.equal(body.lines.length, 1);
    assert.ok(!('sourceId' in body.lines[0]));
    assert.ok(!('renderData' in body.lines[0]));
    assert.ok(!('baseAmount' in body.lines[0]));
    assert.ok(!('amountOverride' in body.lines[0]));
    assert.ok(!('excluded' in body.lines[0]));
    assert.equal(body.lines[0].amount, 1250000);
  });

  test('non-pending note cannot be confirmed', async () => {
    const response = await request(`/debit-notes/${ownSentId}/confirm`, {
      method: 'POST',
      token: customerToken,
    });
    assert.equal(response.status, 409);
  });

  test('PDF export returns real authenticated PDF bytes', async () => {
    const response = await request(`/debit-notes/${ownPendingId}/export?format=pdf`, {
      token: customerToken,
    });
    assert.equal(response.status, 200);
    assert.match(response.contentType, /^application\/pdf/);
    assert.equal((response.body as Buffer).subarray(0, 5).toString('ascii'), '%PDF-');
  });

  test('statement PDF export is scoped and returns real PDF bytes', async () => {
    const response = await request('/statement/export?format=pdf', { token: customerToken });
    assert.equal(response.status, 200);
    assert.match(response.contentType, /^application\/pdf/);
    assert.equal((response.body as Buffer).subarray(0, 5).toString('ascii'), '%PDF-');
  });

  test('mapped customer with no ledger activity receives a real empty statement', async () => {
    const response = await request('/statement', { token: customerToken });
    assert.equal(response.status, 200);
    const body = response.body as {
      customer: { id: number; name: string };
      ledgerRows: unknown[];
      totalOutstanding: number;
    };
    assert.equal(body.customer.id, ownCustomerId);
    assert.equal(body.customer.name, ownCustomerName);
    assert.equal(body.ledgerRows.length, 0);
    assert.equal(body.totalOutstanding, 0);
  });

  test('statement reports an account configuration error when the customer link is missing', async () => {
    const response = await request('/statement', { token: unmappedCustomerToken });
    assert.equal(response.status, 409);
    assert.equal((response.body as { error: string }).error, 'Tài khoản khách hàng chưa được liên kết');
  });

  test('statement export is blocked when the customer link is missing', async () => {
    const response = await request('/statement/export?format=pdf', { token: unmappedCustomerToken });
    assert.equal(response.status, 409);
    assert.equal((response.body as { error: string }).error, 'Tài khoản khách hàng chưa được liên kết');
  });

  test('concurrent confirmation accepts exactly one request', async () => {
    const responses = await Promise.all([
      request(`/debit-notes/${ownPendingId}/confirm`, { method: 'POST', token: customerToken }),
      request(`/debit-notes/${ownPendingId}/confirm`, { method: 'POST', token: customerToken }),
    ]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
    const successful = responses.find((response) => response.status === 200);
    assert.ok(successful);
    const body = successful.body as Record<string, unknown> & { lines: Array<Record<string, unknown>> };
    assert.equal(body.lines.length, 1);
    assert.equal(body.lines[0].amount, 1250000);
    assert.ok(!('baseAmount' in body.lines[0]));
    assert.ok(!('amountOverride' in body.lines[0]));
    assert.ok(!('excluded' in body.lines[0]));
  });

  test('concurrent dispute accepts exactly one request', async () => {
    const pendingId = (await createDocument(ownCustomerId, 'PENDING_CONFIRM')).id;
    const responses = await Promise.all([
      request(`/debit-notes/${pendingId}/dispute`, { method: 'POST', token: customerToken }),
      request(`/debit-notes/${pendingId}/dispute`, { method: 'POST', token: customerToken }),
    ]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
    const successful = responses.find((response) => response.status === 200);
    assert.equal((successful?.body as { debitNoteStatus?: string }).debitNoteStatus, 'REJECTED');
  });
});
