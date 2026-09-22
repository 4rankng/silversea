import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { eq, inArray } from 'drizzle-orm';
import { Role } from '@tingting/shared';

import { db } from '../db';
import * as s from '../db/schema';
import { disconnectRedis } from '../lib/redis';
import { initEnforcer } from '../casbin/enforcer';
import { casbinAuthz } from '../middleware/casbin';
import { globalErrorHandler } from '../middleware/errorHandler';
import shipmentRoutes from '../routes/shipments';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const shipmentIds: number[] = [];
const customerIds: number[] = [];
const routeIds: number[] = [];
const docIds: number[] = [];
const userIds: number[] = [];
let adminId = 0;
let accountantId = 0;
let cusId = 0;
let dispatcherId = 0;
let server: http.Server;
let baseUrl = '';

async function api(method: string, path: string, actorId: number, body?: Record<string, unknown>, idempotencyKey?: string) {
  const key = idempotencyKey ?? `dn-${suffix}-${Math.random()}`;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key, 'X-Test-User-Id': String(actorId) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: Record<string, unknown> = {};
  try { parsed = text ? JSON.parse(text) as Record<string, unknown> : {}; } catch { parsed = { raw: text.slice(0, 120) }; }
  return { status: response.status, body: parsed };
}

async function mkUser(role: Role) {
  const [user] = await db.insert(s.users).values({
    username: `dn-${role.toLowerCase()}-${suffix}-${userIds.length}`,
    passwordHash: 'test-only', role, status: 'ACTIVE',
  }).returning({ id: s.users.id });
  userIds.push(user.id);
  return user.id;
}

async function mkCustomer(name: string) {
  const [row] = await db.insert(s.customers).values({ name }).returning();
  customerIds.push(row.id);
  return row;
}

async function mkLockedLotForCustomer(customerId: number, edd?: string) {
  const [route] = await db.insert(s.routes).values({ name: `DN route ${suffix}-${routeIds.length}` }).returning();
  routeIds.push(route.id);
  const [shipment] = await db.insert(s.shipments).values({ customerId, routeId: route.id, ...(edd ? { expectedDeliveryDate: edd } : {}) }).returning({ id: s.shipments.id, version: s.shipments.version });
  shipmentIds.push(shipment.id);
  const lock = await api('POST', `/api/shipments/${shipment.id}/lock`, cusId, {});
  assert.equal(lock.status, 201, JSON.stringify(lock.body));
  return shipment;
}

async function mkLockedLot(edd?: string) {
  const [customer] = await db.insert(s.customers).values({ name: `DN cust ${suffix}-${customerIds.length}` }).returning();
  customerIds.push(customer.id);
  const [route] = await db.insert(s.routes).values({ name: `DN route ${suffix}-${routeIds.length}` }).returning();
  routeIds.push(route.id);
  const [shipment] = await db.insert(s.shipments).values({ customerId: customer.id, routeId: route.id, ...(edd ? { expectedDeliveryDate: edd } : {}) }).returning({ id: s.shipments.id, version: s.shipments.version });
  shipmentIds.push(shipment.id);
  return shipment;
}

before(async () => {
  await initEnforcer();
  adminId = await mkUser(Role.ADMIN);
  accountantId = await mkUser(Role.ACCOUNTANT);
  cusId = await mkUser(Role.CUS);
  dispatcherId = await mkUser(Role.DISPATCHER);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const header = req.header('X-Test-User-Id');
    if (header) (req as express.Request & { user?: unknown }).user = {
      userId: Number(header),
      username: 'test', email: 'test@x', fullName: 'test',
      role: ([
        [adminId, Role.ADMIN], [accountantId, Role.ACCOUNTANT], [cusId, Role.CUS],
        [dispatcherId, Role.DISPATCHER],
      ] as Array<[number, Role]>).find(([id]) => id === Number(header))?.[1] as Role,
    };
    next();
  });
  app.use('/api/shipments', casbinAuthz('shipments'), shipmentRoutes);
  app.use(globalErrorHandler);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  try {
    await db.delete(s.billingDocumentLines).where(inArray(s.billingDocumentLines.documentId, docIds));
    await db.delete(s.debitNoteLots).where(inArray(s.debitNoteLots.shipmentId, shipmentIds));
    await db.delete(s.billingDocuments).where(inArray(s.billingDocuments.id, docIds));
    await db.delete(s.shipmentCostLocks).where(inArray(s.shipmentCostLocks.shipmentId, shipmentIds));
    await db.delete(s.shipments).where(inArray(s.shipments.id, shipmentIds));
    await db.delete(s.routes).where(inArray(s.routes.id, routeIds));
    await db.delete(s.customers).where(inArray(s.customers.id, customerIds));
    if (userIds.length > 0) await db.delete(s.users).where(inArray(s.users.id, userIds));
  } catch { /* best-effort cleanup */ }
  await disconnectRedis();
});

async function lockLot(shipmentId: number, actorId: number) {
  const result = await api('POST', `/api/shipments/${shipmentId}/lock`, actorId, {});
  assert.equal(result.status, 201, JSON.stringify(result.body));
}

describe('20260918_19 Xuất Debit Note từ snapshot khóa lô', () => {
  test('409 when the lot has no active cost lock', async () => {
    const shipment = await mkLockedLot();
    const result = await api('POST', `/api/shipments/${shipment.id}/debit-note`, cusId, {});
    assert.equal(result.status, 409);
    assert.match(String(result.body.error), /chưa khóa|chưa được khóa/i);
  });

  test('creates the DEBIT_NOTE from the frozen snapshot lines', async () => {
    const shipment = await mkLockedLot();
    await lockLot(shipment.id, cusId);
    const result = await api('POST', `/api/shipments/${shipment.id}/debit-note`, cusId, {});
    assert.equal(result.status, 201, JSON.stringify(result.body));
    const docId = Number(result.body.id);
    docIds.push(docId);
    const [doc] = await db.select().from(s.billingDocuments).where(eq(s.billingDocuments.id, docId));
    assert.equal(doc?.type, 'DEBIT_NOTE');
    assert.ok(doc?.issuedAt, 'the document is issued at creation');
    const lines = await db.select().from(s.billingDocumentLines).where(eq(s.billingDocumentLines.documentId, docId));
    assert.equal(lines.length, 0, 'the empty snapshot yields no fabricated lines');
  });

  test('snapshot values freeze into the document lines', async () => {
    const shipment = await mkLockedLot();
    await lockLot(shipment.id, cusId);
    const [lock] = await db.select().from(s.shipmentCostLocks).where(eq(s.shipmentCostLocks.shipmentId, shipment.id));
    assert.ok(lock);
    const snapshot = lock.costSnapshot as Record<string, unknown>;
    const result = await api('POST', `/api/shipments/${shipment.id}/debit-note`, accountantId, {});
    assert.equal(result.status, 201, JSON.stringify(result.body));
    docIds.push(Number(result.body.id));
    const lines = await db.select().from(s.billingDocumentLines).where(eq(s.billingDocumentLines.documentId, Number(result.body.id)));
    assert.equal(lines.length, 0, 'this fixture snapshot carries no engine values yet — zero lines');
  });

  test('idempotent replay returns the original document', async () => {
    const shipment = await mkLockedLot();
    await lockLot(shipment.id, cusId);
    const key = `dn-replay-${suffix}-${shipment.id}`;
    const first = await api('POST', `/api/shipments/${shipment.id}/debit-note`, cusId, {}, key);
    assert.equal(first.status, 201, JSON.stringify(first.body));
    docIds.push(Number(first.body.id));
    const replay = await api('POST', `/api/shipments/${shipment.id}/debit-note`, cusId, {}, key);
    assert.equal(replay.status, 201);
    assert.equal(replay.body.id, first.body.id, 'replay must return the original document');
    const docs = await db.select().from(s.billingDocuments)
      .where(eq(s.billingDocuments.entityId, (await db.select().from(s.shipments).where(eq(s.shipments.id, shipment.id)))[0]!.customerId!));
    assert.equal(docs.length, 1, 'exactly one document exists for the replay pair');
  });

  test('role gates: CUS/ACCOUNTANT/ADMIN allowed — DISPATCHER 403', async () => {
    // Each allowed actor issues for its own lot: a lot may appear in at most
    // ONE issued debit note, so re-issuing the same lot is no longer the way
    // to exercise the allowed roles.
    for (const actor of [cusId, accountantId, adminId]) {
      const shipment = await mkLockedLot();
      await lockLot(shipment.id, cusId);
      const result = await api('POST', `/api/shipments/${shipment.id}/debit-note`, actor, {});
      assert.notEqual(result.status, 403);
      assert.equal(result.status, 201, JSON.stringify(result.body));
      docIds.push(Number(result.body.id));
    }
    const blockedLot = await mkLockedLot();
    await lockLot(blockedLot.id, cusId);
    const blocked = await api('POST', `/api/shipments/${blockedLot.id}/debit-note`, dispatcherId, {});
    assert.equal(blocked.status, 403);
  });

  test('the same lot cannot be issued twice — the retry names the lot', async () => {
    const shipment = await mkLockedLot();
    await lockLot(shipment.id, cusId);
    const lotCode = `DN-RETRY-${suffix}-${shipment.id}`;
    await db.update(s.shipments).set({ shipmentCode: lotCode }).where(eq(s.shipments.id, shipment.id));
    const first = await api('POST', `/api/shipments/${shipment.id}/debit-note`, cusId, {});
    assert.equal(first.status, 201, JSON.stringify(first.body));
    docIds.push(Number(first.body.id));
    const second = await api('POST', `/api/shipments/${shipment.id}/debit-note`, accountantId, {});
    assert.equal(second.status, 409, JSON.stringify(second.body));
    assert.ok(Array.isArray(second.body.overlappingLotCodes), '409 body carries machine-readable overlappingLotCodes');
    assert.deepEqual(second.body.overlappingLotCodes, [lotCode], 'exactly the issued lot is named');
  });
});

describe('SIS22-ACC-011 frozen customer debt is conserved when issuing', () => {
  const cases = [
    { name: 'negotiated charges replace company cost', snapshot: { freightAuto: '1000000', chiHoTotal: '200000', receivableTotal: '1500000' }, expected: 1500000 },
    { name: 'zero customer charge never reuses company cost', snapshot: { freightAuto: '1000000', chiHoTotal: '200000', receivableTotal: 0 }, expected: 0 },
    { name: 'discount below freight stays nonnegative', snapshot: { freightAuto: '1000000', chiHoTotal: '200000', receivableTotal: '900000' }, expected: 900000 },
    { name: 'only customer charges are known', snapshot: { freightAuto: null, chiHoTotal: '250000', receivableTotal: '150000' }, expected: 150000 },
    { name: 'whole-VND rounding conserves header and lines', snapshot: { freightAuto: '1000000.4', chiHoTotal: '200000', receivableTotal: '1500000.6' }, expected: 1500001 },
    { name: 'legacy missing customer-debt key preserves frozen components', snapshot: { freightAuto: '1000000', chiHoTotal: '200000' }, expected: 1200000 },
  ];
  for (const mode of ['single', 'batch'] as const) {
    for (const scenario of cases) {
      test(`${mode}: ${scenario.name}`, async () => {
        const lot = await mkLockedLot();
        await lockLot(lot.id, accountantId);
        await db.update(s.shipmentCostLocks).set({ costSnapshot: scenario.snapshot })
          .where(eq(s.shipmentCostLocks.shipmentId, lot.id));
        const endpoint = mode === 'single' ? `/api/shipments/${lot.id}/debit-note` : '/api/shipments/debit-notes';
        const payload = mode === 'single' ? {} : { shipmentIds: [lot.id] };
        const key = `sis22-${mode}-${suffix}-${lot.id}`;
        const issued = await api('POST', endpoint, accountantId, payload, key);
        assert.equal(issued.status, 201, JSON.stringify(issued.body));
        const docId = Number(issued.body.id);
        docIds.push(docId);
        const readDocument = async () => {
          const [doc] = await db.select().from(s.billingDocuments).where(eq(s.billingDocuments.id, docId));
          const lines = await db.select().from(s.billingDocumentLines).where(eq(s.billingDocumentLines.documentId, docId));
          return { doc, lines };
        };
        const initial = await readDocument();
        assert.equal(Number(initial.doc.totalInclVat), scenario.expected);
        assert.equal(Number(initial.doc.totalGross), scenario.expected);
        assert.equal(Number(initial.doc.totalNet), scenario.expected);
        assert.equal(Number(initial.doc.totalTax), 0);
        assert.equal(initial.doc.createdBy, accountantId);
        assert.equal(initial.lines.reduce((total, line) => total + Number(line.grossAmount), 0), scenario.expected);
        for (const line of initial.lines) {
          assert.equal(Number(line.netAmount), Number(line.grossAmount));
          assert.equal(Number(line.taxAmount), 0);
          assert.equal(line.vatTreatment, 'EXEMPT');
          assert.equal(Number(line.vatRate), 0);
          assert.ok(Number(line.grossAmount) >= 0);
        }
        // A later source/snapshot change cannot rewrite an issued note on retry.
        await db.update(s.shipmentCostLocks).set({ costSnapshot: { receivableTotal: '9999999' } })
          .where(eq(s.shipmentCostLocks.shipmentId, lot.id));
        const replay = await api('POST', endpoint, accountantId, payload, key);
        assert.equal(replay.status, 201, JSON.stringify(replay.body));
        assert.equal(replay.body.id, docId);
        assert.deepEqual(await readDocument(), initial);
      });
    }
    test(`${mode}: explicit unknown customer debt cannot silently become company cost`, async () => {
      const lot = await mkLockedLot();
      await lockLot(lot.id, accountantId);
      await db.update(s.shipmentCostLocks).set({ costSnapshot: { freightAuto: '1000000', chiHoTotal: '200000', receivableTotal: null } })
        .where(eq(s.shipmentCostLocks.shipmentId, lot.id));
      const result = await api('POST', mode === 'single' ? `/api/shipments/${lot.id}/debit-note` : '/api/shipments/debit-notes',
        accountantId, mode === 'single' ? {} : { shipmentIds: [lot.id] });
      if (result.status === 201) docIds.push(Number(result.body.id));
      assert.equal(result.status, 409, JSON.stringify(result.body));
      assert.match(String(result.body.error), /chưa xác định/i);
      const claims = await db.select().from(s.debitNoteLots).where(eq(s.debitNoteLots.shipmentId, lot.id));
      assert.equal(claims.length, 0, 'denied issue leaves no customer claim');
    });
  }
});

describe('the issuing CUS downloads the Debit Note file', () => {
  test('issue then export returns the xlsx for CUS on the shipments mount', async () => {
    const shipment = await mkLockedLot();
    await lockLot(shipment.id, cusId);
    const issue = await api('POST', `/api/shipments/${shipment.id}/debit-note`, cusId, {});
    assert.equal(issue.status, 201, JSON.stringify(issue.body));
    docIds.push(Number(issue.body.id));
    const response = await fetch(`${baseUrl}/api/shipments/${shipment.id}/debit-note/export?documentId=${issue.body.id}`, {
      headers: { 'X-Test-User-Id': String(cusId) },
    });
    assert.equal(response.status, 200, `the issuing CUS must read the file — got ${response.status}`);
    assert.match(response.headers.get('content-type') ?? '', /spreadsheetml/);
    const buffer = await response.arrayBuffer();
    assert.ok(buffer.byteLength > 100, 'a real file buffer comes back');
  });
});

describe('GỘP THEO KỲ — consolidated debit note per customer per period', () => {
  test('two locked lots, one POST, one document with both lots lines', async () => {
    const customer = await mkCustomer(`Consol ${suffix}`);
    customerIds.push(customer.id);
    const lotA = await mkLockedLotForCustomer(customer.id);
    const lotB = await mkLockedLotForCustomer(customer.id);
    await db.update(s.shipmentCostLocks).set({ costSnapshot: { freightAuto: '1000000', chiHoTotal: '300000' } })
      .where(eq(s.shipmentCostLocks.shipmentId, lotA.id));
    await db.update(s.shipmentCostLocks).set({ costSnapshot: { freightAuto: '800000', chiHoTotal: '200000' } })
      .where(eq(s.shipmentCostLocks.shipmentId, lotB.id));
    const response = await api('POST', '/api/shipments/debit-notes', cusId, { shipmentIds: [lotB.id, lotA.id] });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    const docId = Number(response.body.id);
    docIds.push(docId);
    const lines = await db.select().from(s.billingDocumentLines).where(eq(s.billingDocumentLines.documentId, docId));
    assert.equal(lines.length, 4, 'both lots freight + chi hộ lines land');
    assert.ok(lines.every((line) => line.description.includes('lô SHP-') || line.description.includes(`lô ${''}`)), 'lines carry per-lot grouping');
    assert.equal((await db.select().from(s.billingDocuments).where(eq(s.billingDocuments.id, docId)))[0]?.entityId, customer.id);
  });
  test('replaying the same selection returns the same document', async () => {
    const customer = await mkCustomer(`Consol replay ${suffix}`);
    customerIds.push(customer.id);
    const lotA = await mkLockedLotForCustomer(customer.id);
    const first = await api('POST', '/api/shipments/debit-notes', cusId, { shipmentIds: [lotA.id] });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    const firstId = Number(first.body.id);
    docIds.push(firstId);
    const replay = await api('POST', '/api/shipments/debit-notes', cusId, { shipmentIds: [lotA.id] });
    assert.equal(replay.status, 201);
    assert.equal(Number(replay.body.id), firstId, 'the same selection returns the same document');
  });

  test('mixed customers in one selection are rejected', async () => {
    const lotA = await mkLockedLot();
    const lotB = await mkLockedLot();
    const response = await api('POST', '/api/shipments/debit-notes', cusId, { shipmentIds: [lotA.id, lotB.id] });
    assert.equal(response.status, 409);
    assert.match(String(response.body.error), /cùng một khách hàng/);
  });

  test('a second disjoint selection for the same customer issues its own document', async () => {
    // The old customer+processing-day unique key 409'd this exact flow.
    const customer = await mkCustomer(`Consol disjoint ${suffix}`);
    const lots = [] as Array<{ id: number }>;
    for (let i = 0; i < 4; i++) lots.push(await mkLockedLotForCustomer(customer.id));
    const first = await api('POST', '/api/shipments/debit-notes', cusId, { shipmentIds: [lots[0]!.id, lots[1]!.id] });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    docIds.push(Number(first.body.id));
    const second = await api('POST', '/api/shipments/debit-notes', cusId, { shipmentIds: [lots[2]!.id, lots[3]!.id] });
    assert.equal(second.status, 201, `a disjoint selection must issue its own note — ${JSON.stringify(second.body)}`);
    assert.notEqual(Number(second.body.id), Number(first.body.id), 'the two selections are distinct documents');
  });

  test('an overlapping selection is rejected naming the overlapping lots', async () => {
    const customer = await mkCustomer(`Consol overlap ${suffix}`);
    const lotA = await mkLockedLotForCustomer(customer.id);
    const lotB = await mkLockedLotForCustomer(customer.id);
    const codeA = `DN-OV-A-${suffix}-${lotA.id}`;
    const codeB = `DN-OV-B-${suffix}-${lotB.id}`;
    await db.update(s.shipments).set({ shipmentCode: codeA }).where(eq(s.shipments.id, lotA.id));
    await db.update(s.shipments).set({ shipmentCode: codeB }).where(eq(s.shipments.id, lotB.id));
    const first = await api('POST', '/api/shipments/debit-notes', cusId, { shipmentIds: [lotA.id] });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    docIds.push(Number(first.body.id));
    const second = await api('POST', '/api/shipments/debit-notes', cusId, { shipmentIds: [lotB.id, lotA.id] });
    assert.equal(second.status, 409, JSON.stringify(second.body));
    assert.deepEqual(second.body.overlappingLotCodes, [codeA], 'exactly the already-issued lot is named');
    const customerDocs = await db.select().from(s.billingDocuments).where(eq(s.billingDocuments.entityId, customer.id));
    assert.equal(customerDocs.length, 1, 'the rejected batch half-issued nothing');
  });
});

describe('ruling 2026-09-19 — the note range derives from the selection delivery dates (red-first)', () => {
  test('consolidated range = [min,max] ngày giao hàng of the selection, not the processing day', async () => {
    const customer = await mkCustomer(`Range ${suffix}`);
    const early = await mkLockedLotForCustomer(customer.id, '2026-10-01');
    const late = await mkLockedLotForCustomer(customer.id, '2026-10-10');
    const response = await api('POST', '/api/shipments/debit-notes', cusId, { shipmentIds: [early.id, late.id] });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    const docId = Number(response.body.id);
    docIds.push(docId);
    const [doc] = await db.select().from(s.billingDocuments).where(eq(s.billingDocuments.id, docId));
    assert.equal(doc?.rangeFrom, '2026-10-01');
    assert.equal(doc?.rangeTo, '2026-10-10');
  });

  test('per-lot export stamps the lot delivery date on both ends', async () => {
    const shipment = await mkLockedLot('2026-10-05');
    await lockLot(shipment.id, cusId);
    const result = await api('POST', `/api/shipments/${shipment.id}/debit-note`, cusId, {});
    assert.equal(result.status, 201, JSON.stringify(result.body));
    docIds.push(Number(result.body.id));
    const [doc] = await db.select().from(s.billingDocuments).where(eq(s.billingDocuments.id, Number(result.body.id)));
    assert.equal(doc?.rangeFrom, '2026-10-05');
    assert.equal(doc?.rangeTo, '2026-10-05');
  });

  test('a selection with no delivery dates falls back to the processing day', async () => {
    const customer = await mkCustomer(`Range null ${suffix}`);
    const a = await mkLockedLotForCustomer(customer.id);
    const b = await mkLockedLotForCustomer(customer.id);
    const response = await api('POST', '/api/shipments/debit-notes', cusId, { shipmentIds: [a.id, b.id] });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    docIds.push(Number(response.body.id));
    const [doc] = await db.select().from(s.billingDocuments).where(eq(s.billingDocuments.id, Number(response.body.id)));
    // The processing day is the VN calendar day (card _18 convention):
    // a UTC-date slice diverges from the VN day every VN-evening/
    // UTC-morning window, which is exactly when this pin used to flip red.
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
    assert.equal(doc?.rangeFrom, today);
    assert.equal(doc?.rangeTo, today);
  });

  test('two-range overlap: the issued early range blocks a wider later selection naming the shared lot', async () => {
    const customer = await mkCustomer(`Range overlap ${suffix}`);
    const early = await mkLockedLotForCustomer(customer.id, '2026-10-01');
    const mid = await mkLockedLotForCustomer(customer.id, '2026-10-10');
    const late = await mkLockedLotForCustomer(customer.id, '2026-10-15');
    const codeEarly = `DN-RNG-E-${suffix}-${early.id}`;
    const codeMid = `DN-RNG-M-${suffix}-${mid.id}`;
    await db.update(s.shipments).set({ shipmentCode: codeEarly }).where(eq(s.shipments.id, early.id));
    await db.update(s.shipments).set({ shipmentCode: codeMid }).where(eq(s.shipments.id, mid.id));
    const issued = await api('POST', '/api/shipments/debit-notes', cusId, { shipmentIds: [early.id, mid.id] });
    assert.equal(issued.status, 201, JSON.stringify(issued.body));
    docIds.push(Number(issued.body.id));
    const wider = await api('POST', '/api/shipments/debit-notes', cusId, { shipmentIds: [mid.id, late.id] });
    assert.equal(wider.status, 409, JSON.stringify(wider.body));
    assert.deepEqual(wider.body.overlappingLotCodes, [codeMid], 'the shared lot inside the wider range is named');
  });
});
