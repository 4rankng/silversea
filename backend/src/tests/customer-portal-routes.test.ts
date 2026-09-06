import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { eq, inArray } from 'drizzle-orm';
import {
  CustomerAccountType,
  Role,
  TripPodFileType,
  TripPodStatus,
  TripStatus,
} from '@tingting/shared';
import { db, client } from '../db';
import * as s from '../db/schema';
import { insertTripComposite } from '../services/trip-composite.service';
import { config } from '../config';
import { initEnforcer } from '../casbin/enforcer';
import { authMiddleware } from '../middleware/auth';
import { casbinAuthz, requireRoles } from '../middleware/casbin';
import { globalErrorHandler } from '../middleware/errorHandler';
import { createShipment } from '../services/shipment.service';
import { createUser } from '../services/user.service';
import portalRoutes from '../routes/portal/index';
import { disconnectRedis } from '../lib/redis';
import { storageService } from '../services/storage.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const customerIds: number[] = [];
const userIds: number[] = [];
const documentIds: number[] = [];
const routeIds: number[] = [];
const cargoTypeIds: number[] = [];
const shipmentIds: number[] = [];
const fulfillmentIds: number[] = [];
const tripIds: number[] = [];
const driverIds: number[] = [];
const podSubmissionIds: number[] = [];
const podFileIds: number[] = [];
const podStorageKeys: string[] = [];
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
let multiShipmentPodFileId: number;

async function createCustomer(name: string) {
  const [customer] = await db.insert(s.customers).values({ name: `${name} ${suffix}` }).returning();
  customerIds.push(customer.id);
  return customer;
}

function samplePdfBuffer(label: string): Buffer {
  return Buffer.from(`%PDF-1.4\n% portal ${label}\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n`, 'utf8');
}

async function createDocument(customerId: number, status: 'SENT' | 'PENDING_CONFIRM') {
  const month = String((7 + documentIds.length) % 12 || 12).padStart(2, '0');
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
  init: { method?: string; token?: string; idempotencyKey?: string; body?: unknown } = {},
) {
  const url = new URL(`/api/portal${path}`, baseUrl);
  const headers: Record<string, string> = {};
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.idempotencyKey) headers['Idempotency-Key'] = init.idempotencyKey;
  const payload = init.body === undefined ? '' : JSON.stringify(init.body);
  if (init.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(payload).toString();
  }
  return new Promise<{ status: number; contentType: string; body: unknown }>((resolve, reject) => {
    const req = http.request({
      host: url.hostname,
      port: Number(url.port),
      path: `${url.pathname}${url.search}`,
      method: init.method ?? 'GET',
      agent: false,
      headers: {
        ...headers,
        Connection: 'close',
      },
    }, (response) => {
      const contentType = response.headers['content-type'] ?? '';
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      response.on('end', () => {
        const raw = Buffer.concat(chunks);
        const body = String(contentType).includes('application/pdf')
          ? raw
          : raw.length > 0
            ? JSON.parse(raw.toString('utf8'))
            : {};
        resolve({
          status: response.statusCode ?? 0,
          contentType: String(contentType),
          body,
        });
      });
    });
    req.on('error', reject);
    if (init.body !== undefined) {
      req.write(payload);
    }
    req.end();
  });
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
    customerAccountType: CustomerAccountType.CORPORATE_GROUP,
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
  multiShipmentId = (await createShipment({ customerId: multiCustomer.id, cargoMode: 'LCL' })).id;
  shipmentIds.push(multiShipmentId);
  await db.update(s.shipments)
    .set({ tradeDirection: 'IMPORT', blNumber: `BL-PORTAL-${suffix}`.slice(0, 100), bookingRef: null })
    .where(eq(s.shipments.id, multiShipmentId));

  const [route] = await db.insert(s.routes).values({
    name: `Portal pod route ${suffix}`,
  }).returning();
  routeIds.push(route.id);

  const [cargoType] = await db.insert(s.cargoTypes).values({
    name: `Portal pod cargo ${suffix}`,
  }).returning();
  cargoTypeIds.push(cargoType.id);

  const [driverUser] = await db.insert(s.users).values({
    username: `portal-driver-${suffix}`,
    passwordHash: 'x',
    role: Role.DRIVER,
    status: 'ACTIVE',
  }).returning();
  userIds.push(driverUser.id);

  const [driver] = await db.insert(s.drivers).values({
    userId: driverUser.id,
    name: `Portal POD Driver ${suffix}`,
    status: 'ACTIVE',
  }).returning();
  driverIds.push(driver.id);

  const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
    shipmentId: multiShipmentId,
    fulfillmentType: 'LCL_SHIPMENT',
    cargoMode: 'LCL',
    dispatchClassification: 'LCL',
    sourceShipmentVersion: 1,
    siteSnapshot: {},
  }).returning();
  fulfillmentIds.push(fulfillment.id);

  const trip = await insertTripComposite(db, {
    tripCode: `PORTAL-POD-${suffix}`.slice(0, 50),
    customerId: multiCustomer.id,
    routeId: route.id,
    cargoTypeId: cargoType.id,
    shipmentId: multiShipmentId,
    fulfillmentId: fulfillment.id,
    driverId: driver.id,
    status: TripStatus.COMPLETED,
    departureDate: '2026-08-01',
    revenue: '1000000',
    driverSalary: '100000',
    totalFuelCost: '0',
    carrierType: 'OWN',
  });
  tripIds.push(trip.id);

  const [submission] = await db.insert(s.tripPodSubmissions).values({
    tripId: trip.id,
    fulfillmentId: fulfillment.id,
    submissionVersion: 1,
    sourceTripVersion: trip.version,
    status: TripPodStatus.SUBMITTED,
    submittedBy: driverUser.id,
    submittedAt: new Date(),
  }).returning();
  podSubmissionIds.push(submission.id);

  const storageKey = `test/portal-pod-${suffix}.pdf`;
  await storageService.upload(samplePdfBuffer('multi-shipment'), storageKey);
  podStorageKeys.push(storageKey);

  const [podFile] = await db.insert(s.tripPodFiles).values({
    submissionId: submission.id,
    fileType: TripPodFileType.SIGNED_DELIVERY_NOTE,
    storageKey,
    originalFileName: 'portal-pod.pdf',
    mimeType: 'application/pdf',
    sizeBytes: samplePdfBuffer('multi-shipment').length,
    sha256: 'a'.repeat(64),
    uploadedBy: driverUser.id,
  }).returning();
  podFileIds.push(podFile.id);
  multiShipmentPodFileId = podFile.id;
});

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const storageKey of podStorageKeys) {
    await storageService.delete(storageKey).catch(() => undefined);
  }
  if (podFileIds.length > 0) {
    await db.delete(s.tripPodFiles).where(inArray(s.tripPodFiles.id, podFileIds));
  }
  if (podSubmissionIds.length > 0) {
    await db.delete(s.tripPodSubmissions).where(inArray(s.tripPodSubmissions.id, podSubmissionIds));
  }
  if (tripIds.length > 0) {
    await db.delete(s.tripContainers).where(inArray(s.tripContainers.tripId, tripIds));
    await db.delete(s.tripFinancialState).where(inArray(s.tripFinancialState.tripId, tripIds));
    await db.delete(s.tripCarrierInfo).where(inArray(s.tripCarrierInfo.tripId, tripIds));
    await db.delete(s.trips).where(inArray(s.trips.id, tripIds));
  }
  if (fulfillmentIds.length > 0) {
    await db.delete(s.shipmentFulfillments).where(inArray(s.shipmentFulfillments.id, fulfillmentIds));
  }
  if (documentIds.length > 0) {
    await db.delete(s.billingDocumentDisputes).where(inArray(s.billingDocumentDisputes.documentId, documentIds));
    await db.delete(s.billingDocumentLines).where(inArray(s.billingDocumentLines.documentId, documentIds));
    await db.delete(s.billingDocuments).where(inArray(s.billingDocuments.id, documentIds));
  }
  if (shipmentIds.length > 0) {
    await db.delete(s.customerEmailLogs).where(inArray(s.customerEmailLogs.shipmentId, shipmentIds));
    await db.delete(s.shipmentStatusHistory).where(inArray(s.shipmentStatusHistory.shipmentId, shipmentIds));
    await db.delete(s.shipments).where(inArray(s.shipments.id, shipmentIds));
  }
  if (userIds.length > 0) {
    await db.delete(s.idempotencyKeys).where(inArray(s.idempotencyKeys.createdBy, userIds));
  }
  if (driverIds.length > 0) await db.delete(s.drivers).where(inArray(s.drivers.id, driverIds));
  if (userIds.length > 0) await db.delete(s.users).where(inArray(s.users.id, userIds));
  if (cargoTypeIds.length > 0) await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, cargoTypeIds));
  if (routeIds.length > 0) await db.delete(s.routes).where(inArray(s.routes.id, routeIds));
  if (customerIds.length > 0) await db.delete(s.customers).where(inArray(s.customers.id, customerIds));
  await disconnectRedis();
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
    const shipmentBody = shipments.body as { items: Array<Record<string, unknown> & { id: number }>; total: number };
    assert.equal(shipmentBody.total, 1);
    assert.equal(shipmentBody.items[0].id, multiShipmentId);
    assert.equal(shipmentBody.items[0].blNumber, `BL-PORTAL-${suffix}`.slice(0, 100));
    assert.ok(!('shipmentCode' in shipmentBody.items[0]), 'customer list must not expose the internal shipment code');

    const shipmentDetail = await request(`/shipments/${multiShipmentId}?customerId=${multiCustomerId}`, { token: multiCustomerToken });
    assert.equal(shipmentDetail.status, 200);
    const shipmentDetailBody = shipmentDetail.body as { shipment: Record<string, unknown> };
    assert.equal(shipmentDetailBody.shipment.blNumber, `BL-PORTAL-${suffix}`.slice(0, 100));
    assert.ok(!('shipmentCode' in shipmentDetailBody.shipment), 'customer detail must not expose the internal shipment code');

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

  test('shipment POD downloads respect the selected customer scope', async () => {
    const [downloaded, wrongScope] = await Promise.all([
      request(`/shipments/${multiShipmentId}/pod-files/${multiShipmentPodFileId}?customerId=${multiCustomerId}`, {
        token: multiCustomerToken,
      }),
      request(`/shipments/${multiShipmentId}/pod-files/${multiShipmentPodFileId}?customerId=${ownCustomerId}`, {
        token: multiCustomerToken,
      }),
    ]);

    assert.equal(downloaded.status, 200);
    assert.match(downloaded.contentType, /^application\/pdf/);
    assert.equal((downloaded.body as Buffer).subarray(0, 5).toString('ascii'), '%PDF-');

    assert.equal(wrongScope.status, 404);
    assert.equal((wrongScope.body as { error: string }).error, 'Không tìm thấy lô hàng');
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
      idempotencyKey: `portal-confirm-non-pending-${suffix}-${ownSentId}`,
      body: { expectedVersion: 1 },
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

  test('statement exposes outstanding debit-note obligations even when the customer ledger is empty', async () => {
    const response = await request('/statement', { token: customerToken });
    assert.equal(response.status, 200);
    const body = response.body as {
      customer: { id: number; name: string };
      ledgerRows: unknown[];
      totalOutstanding: number;
      unpaidTrips: Array<{ outstanding: number }>;
    };
    assert.equal(body.customer.id, ownCustomerId);
    assert.equal(body.customer.name, ownCustomerName);
    assert.equal(body.ledgerRows.length, 0);
    assert.equal(body.totalOutstanding, 2_000_000);
    assert.equal(body.unpaidTrips.length, 2);
    assert.deepEqual(body.unpaidTrips.map((item) => item.outstanding), [1_000_000, 1_000_000]);
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

  test('confirm rejects missing idempotency headers before mutating the note', async () => {
    const responses = await Promise.all([
      request(`/debit-notes/${ownPendingId}/confirm`, { method: 'POST', token: customerToken }),
      request(`/debit-notes/${ownPendingId}/confirm`, { method: 'POST', token: customerToken }),
    ]);
    assert.deepEqual(responses.map((response) => response.status), [400, 400]);
    for (const response of responses) {
      assert.match(String((response.body as { error?: string }).error ?? ''), /Idempotency-Key.*bắt buộc/i);
    }
    const detail = await request(`/debit-notes/${ownPendingId}`, { token: customerToken });
    assert.equal(detail.status, 200);
    assert.equal((detail.body as { debitNoteStatus: string }).debitNoteStatus, 'PENDING_CONFIRM');
  });

  test('dispute rejects missing idempotency headers before mutating the note', async () => {
    const pendingId = (await createDocument(ownCustomerId, 'PENDING_CONFIRM')).id;
    const responses = await Promise.all([
      request(`/debit-notes/${pendingId}/dispute`, { method: 'POST', token: customerToken }),
      request(`/debit-notes/${pendingId}/dispute`, { method: 'POST', token: customerToken }),
    ]);
    assert.deepEqual(responses.map((response) => response.status), [400, 400]);
    for (const response of responses) {
      assert.match(String((response.body as { error?: string }).error ?? ''), /Idempotency-Key.*bắt buộc/i);
    }
    const detail = await request(`/debit-notes/${pendingId}`, { token: customerToken });
    assert.equal(detail.status, 200);
    assert.equal((detail.body as { debitNoteStatus: string }).debitNoteStatus, 'PENDING_CONFIRM');
  });

  test('idempotent confirm replays the original portal snapshot after status changes', async () => {
    const pendingId = (await createDocument(ownCustomerId, 'PENDING_CONFIRM')).id;
    const key = `portal-confirm-${suffix}-${pendingId}`;

    const first = await request(`/debit-notes/${pendingId}/confirm`, {
      method: 'POST',
      token: customerToken,
      idempotencyKey: key,
      body: { expectedVersion: 1 },
    });
    const replay = await request(`/debit-notes/${pendingId}/confirm`, {
      method: 'POST',
      token: customerToken,
      idempotencyKey: key,
      body: { expectedVersion: 1 },
    });

    assert.equal(first.status, 200);
    assert.equal(replay.status, 200);
    assert.equal((first.body as { replayed?: boolean }).replayed, false);
    assert.equal((replay.body as { replayed?: boolean }).replayed, true);
    assert.deepEqual(
      { ...(replay.body as Record<string, unknown>), replayed: false },
      first.body as Record<string, unknown>,
    );
  });

  test('concurrent confirm and dispute have one versioned winner and preserve dispute evidence', async () => {
    const pendingId = (await createDocument(ownCustomerId, 'PENDING_CONFIRM')).id;
    const [confirm, dispute] = await Promise.all([
      request(`/debit-notes/${pendingId}/confirm`, {
        method: 'POST',
        token: customerToken,
        idempotencyKey: `portal-confirm-race-${suffix}-${pendingId}`,
        body: { expectedVersion: 1 },
      }),
      request(`/debit-notes/${pendingId}/dispute`, {
        method: 'POST',
        token: customerToken,
        idempotencyKey: `portal-dispute-race-${suffix}-${pendingId}`,
        body: {
          expectedVersion: 1,
          reason: 'Khách hàng yêu cầu đối chiếu lại khoản nâng hạ',
          evidenceRefs: ['customer-upload://evidence-1'],
        },
      }),
    ]);
    assert.deepEqual([confirm.status, dispute.status].sort(), [200, 409]);

    const detail = await request(`/debit-notes/${pendingId}`, { token: customerToken });
    assert.equal(detail.status, 200);
    const finalStatus = (detail.body as { debitNoteStatus: string }).debitNoteStatus;
    assert.ok(finalStatus === 'CONFIRMED' || finalStatus === 'REJECTED');

    const disputeRows = await db.select().from(s.billingDocumentDisputes)
      .where(eq(s.billingDocumentDisputes.documentId, pendingId));
    if (finalStatus === 'REJECTED') {
      assert.equal(disputeRows.length, 1);
      assert.equal(disputeRows[0]!.reason, 'Khách hàng yêu cầu đối chiếu lại khoản nâng hạ');
      assert.deepEqual(disputeRows[0]!.evidenceRefs, ['customer-upload://evidence-1']);
    } else {
      assert.equal(disputeRows.length, 0);
    }
  });
});
