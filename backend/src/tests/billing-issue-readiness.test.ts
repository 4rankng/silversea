import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { inArray } from 'drizzle-orm';
import { db, client } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import { requestBillingDocumentIssue } from '../services/billing-document-governance.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const customerIds: number[] = [];
const userIds: number[] = [];
const routeIds: number[] = [];
const tripIds: number[] = [];
const documentIds: number[] = [];
const lockIds: number[] = [];

let makerCache: Promise<{ id: number }> | null = null;
function maker() {
  makerCache ??= db.insert(s.users)
    .values({ username: `issue-gate-${suffix}`, passwordHash: 'x', role: 'ACCOUNTANT', status: 'ACTIVE' })
    .returning()
    .then(([u]) => { userIds.push(u.id); return u; });
  return makerCache;
}

async function makeCustomer(label: string) {
  const [customer] = await db.insert(s.customers)
    .values({ name: `Khach hang ${label} ${suffix}` })
    .returning();
  customerIds.push(customer.id);
  return customer;
}

async function makeTrip(customerId: number, opts: { recovered?: boolean } = {}) {
  const [route] = await db.insert(s.routes).values({ name: `Issue-gate route ${suffix}-${routeIds.length}` }).returning();
  routeIds.push(route.id);
  const [trip] = await db.insert(s.trips).values({
    customerId,
    routeId: route.id,
    departureDate: '2026-07-10',
    status: 'COMPLETED',
    ...(opts.recovered ? { podRecoveredAt: new Date('2026-07-20T08:00:00Z'), podRecoveredBy: 1 } : {}),
  }).returning();
  tripIds.push(trip.id);
  return trip;
}

async function makeDraftDocument(customer: { id: number; name: string }, rangeFrom = '2026-07-01', rangeTo = '2026-07-31') {
  const [document] = await db.insert(s.billingDocuments).values({
    type: 'DEBIT_NOTE',
    entityType: 'CUSTOMER',
    entityId: customer.id,
    entityName: customer.name,
    rangeFrom,
    rangeTo,
    totalInclVat: '0',
    debitNoteStatus: 'DRAFT',
  }).returning();
  documentIds.push(document.id);
  return document;
}

async function addAdhocLine(documentId: number, gross: string, label = 'Phí dịch vụ', order = 0) {
  const [line] = await db.insert(s.billingDocumentLines).values({
    documentId,
    sourceType: 'ADHOC',
    sourceId: null,
    lineType: 'ADHOC',
    typeLabel: label,
    unit: 'lần',
    description: 'Dòng trình bày kiểm thử',
    baseAmount: gross,
    grossAmount: gross,
    netAmount: gross,
    sortOrder: order,
  }).returning();
  return line;
}

async function addTripLine(documentId: number, tripId: number, gross: string) {
  const [line] = await db.insert(s.billingDocumentLines).values({
    documentId,
    sourceType: 'TRIP',
    sourceId: tripId,
    lineType: 'FREIGHT',
    typeLabel: 'Cước vận tải',
    unit: 'chuyến',
    description: 'Dòng chuyến kiểm thử',
    baseAmount: '0',
    amountOverride: gross,
    grossAmount: gross,
    netAmount: gross,
    sortOrder: 0,
  }).returning();
  return line;
}

async function addClosedPeriodLock(customerId: number) {
  const [lock] = await db.insert(s.periodLocks).values({
    domain: 'DEBIT_NOTE',
    scopeType: 'CUSTOMER',
    scopeId: customerId,
    cycle: 'MONTHLY',
    periodKey: '2026-07',
    periodStart: '2026-07-01',
    periodEnd: '2026-07-31',
    status: 'CLOSED',
    closedBy: (await maker()).id,
  }).returning();
  lockIds.push(lock.id);
  return lock;
}

async function issue(documentId: number) {
  return requestBillingDocumentIssue({
    documentId,
    expectedVersion: 1,
    reason: 'Kiem thu phat hanh',
    makerId: (await maker()).id,
    makerRole: 'ACCOUNTANT',
  });
}

function reasonTexts(err: unknown): string[] {
  const details = (err as { details?: Array<{ message?: string }> }).details;
  return (details ?? []).map((item) => item.message ?? '').filter(Boolean);
}

describe('billing issue readiness gate (QuyTrinhO2C 7.2)', () => {
  after(async () => {
    if (documentIds.length) await db.delete(s.billingDocumentLines).where(inArray(s.billingDocumentLines.documentId, documentIds));
    if (lockIds.length) await db.delete(s.periodLocks).where(inArray(s.periodLocks.id, lockIds));
    if (documentIds.length) await db.delete(s.billingDocuments).where(inArray(s.billingDocuments.id, documentIds));
    if (tripIds.length) await db.delete(s.trips).where(inArray(s.trips.id, tripIds));
    if (routeIds.length) await db.delete(s.routes).where(inArray(s.routes.id, routeIds));
    if (customerIds.length) await db.delete(s.customers).where(inArray(s.customers.id, customerIds));
    if (userIds.length) await db.delete(s.users).where(inArray(s.users.id, userIds));
    await client.end();
  });
  test('blocks issue with the goods reason when the document has no lines', async () => {
    const customer = await makeCustomer('no-lines');
    const document = await makeDraftDocument(customer);
    await assert.rejects(issue(document.id), (err: unknown) => {
      assert.ok(err instanceof ApiError);
      assert.equal((err as ApiError).statusCode, 409);
      assert.deepEqual(reasonTexts(err), ['Bảng kê chưa có dòng trình bày hàng hóa.']);
      return true;
    });
  });

  test('blocks issue with a per-line price reason when a line has no amount', async () => {
    const customer = await makeCustomer('no-price');
    const document = await makeDraftDocument(customer);
    await addAdhocLine(document.id, '150000', 'Cuoc van tai', 0);
    await addAdhocLine(document.id, '0', 'Phi boc xep', 1);
    await assert.rejects(issue(document.id), (err: unknown) => {
      const reasons = reasonTexts(err);
      assert.equal(reasons.length, 1);
      assert.match(reasons[0]!, /Phi boc xep/);
      assert.match(reasons[0]!, /chưa có giá/);
      assert.ok(!reasons.some((r) => r.includes('dòng trình bày')));
      return true;
    });
  });

  test('blocks issue with the original-document reason when a source trip has no paper receipt', async () => {
    const customer = await makeCustomer('no-receipt');
    const trip = await makeTrip(customer.id);
    const recovered = await makeTrip(customer.id, { recovered: true });
    const document = await makeDraftDocument(customer);
    await addTripLine(document.id, trip.id, '250000');
    await addTripLine(document.id, recovered.id, '260000');
    await assert.rejects(issue(document.id), (err: unknown) => {
      const reasons = reasonTexts(err);
      assert.equal(reasons.length, 1, JSON.stringify({ message: (err as ApiError).message, details: (err as { details?: unknown }).details }));
      assert.match(reasons[0]!, /chưa nhận chứng từ gốc/);
      assert.ok(reasons[0]!.includes(String(trip.id)));
      return true;
    });
  });

  test('collects the closed period as its own reason alongside other missing conditions', async () => {
    const customer = await makeCustomer('locked');
    const trip = await makeTrip(customer.id);
    const document = await makeDraftDocument(customer);
    await addTripLine(document.id, trip.id, '0');
    await addClosedPeriodLock(customer.id);
    await assert.rejects(issue(document.id), (err: unknown) => {
      const reasons = reasonTexts(err);
      assert.equal(reasons.length, 3);
      assert.ok(reasons.some((r) => r.includes('chưa có giá')));
      assert.ok(reasons.some((r) => r.includes('chưa nhận chứng từ gốc')));
      assert.ok(reasons.some((r) => r.includes('đã khóa')));
      return true;
    });
  });

  test('issues an eligible document unchanged', async () => {
    const customer = await makeCustomer('eligible');
    const document = await makeDraftDocument(customer);
    await addAdhocLine(document.id, '500000', 'Phí dịch vụ', 0);
    const result = await issue(document.id);
    assert.ok(result);
  });
});
