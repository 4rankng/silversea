import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import express from 'express';
import { inArray } from 'drizzle-orm';
import { Role, TxnType } from '@tingting/shared';
import { client, db } from '../db';
import * as s from '../db/schema';
import { disconnectRedis } from '../lib/redis';
import { globalErrorHandler } from '../middleware/errorHandler';
import configRoutes from '../routes/config';

// Server-side sorting for the partner catalog lists (/customers, /suppliers):
// whitelist-only sortBy/sortDir, nulls-last in both directions, stable id
// tiebreaker, and scalar-subquery parity for the ledger-derived columns
// (customers "debt", suppliers "payable") that the pages otherwise compute
// client-side from the ledger/payables endpoints.

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
// Independent token for the linked-customer fixtures: must not contain (or be
// contained in) `suffix`, because the list calls scope by ILIKE %token%.
const linkedToken = `lk${Date.now() + 1}-${Math.random().toString(36).slice(2, 10)}`;

let server: http.Server;
let baseUrl = '';

// Sorted by construction below; every list call scopes to the shared suffix
// token via `search`, so dev-database rows outside the fixtures never enter
// the ordering assertions.
const customerIds: number[] = [];
const supplierIds: number[] = [];
const linkedCustomerIds: number[] = [];
const ledgerIds: number[] = [];
let actorId = 0;

async function get(path: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { 'X-Test-Actor': '0' },
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

function itemNames(body: Record<string, unknown>): string[] {
  return (body.items as Array<{ name: string }>).map((row) => row.name);
}

before(async () => {
  const [actor] = await db.insert(s.users).values({
    username: `partner-sort-${suffix}`,
    passwordHash: 'x',
    role: Role.MANAGER,
    status: 'ACTIVE',
  }).returning({ id: s.users.id });
  actorId = actor!.id;

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = {
      userId: actorId,
      username: `partner-sort-${suffix}`,
      email: null,
      fullName: null,
      role: Role.MANAGER,
    };
    next();
  });
  app.use('/api', configRoutes);
  app.use(globalErrorHandler);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // Customers: alphabetical operational names, one NULL credit limit (nulls-last
  // proof) and a ledger mix where excluding carrier-payable postings decides
  // the debt ranking (A would outrank B without the exclusion).
  const customers = await db.insert(s.customers).values([
    { name: `Alpha ${suffix}`, shortName: `A ${suffix}`, creditLimit: '300000000', taxCode: `A${suffix}`.slice(0, 20) },
    { name: `Bravo ${suffix}`, shortName: `B ${suffix}`, creditLimit: null, taxCode: null },
    { name: `Charlie ${suffix}`, shortName: `C ${suffix}`, creditLimit: '100000000', taxCode: null },
  ]).returning({ id: s.customers.id });
  customerIds.push(...customers.map((row) => row.id));

  // Charlie owes the most (1.2M), Alpha 500k (the 900k VENDOR_PAYMENT posting
  // must NOT count as customer debt), Bravo has no ledger rows (0).
  const customerLedger = await db.insert(s.ledger).values([
    { txnType: TxnType.TRIP_REVENUE, entityType: 'CUSTOMER', entityId: customerIds[0]!, debit: '500000', credit: '0', balance: '500000' },
    { txnType: TxnType.VENDOR_PAYMENT, entityType: 'CUSTOMER', entityId: customerIds[0]!, debit: '900000', credit: '0', balance: '1400000' },
    { txnType: TxnType.TRIP_REVENUE, entityType: 'CUSTOMER', entityId: customerIds[2]!, debit: '1500000', credit: '300000', balance: '1200000' },
  ]).returning({ id: s.ledger.id });
  ledgerIds.push(...customerLedger.map((row) => row.id));

  // Linked customers for the suppliers' "KH liên kết" label sort. Their names
  // deliberately avoid the customers-fixture search token — the /customers list
  // call scopes by `search` and must return exactly the three sorting rows.
  const linked = await db.insert(s.customers).values([
    { name: `Zulu Linked ${linkedToken}`, shortName: '' },
    { name: `Yankee Linked ${linkedToken}`, shortName: '' },
  ]).returning({ id: s.customers.id });
  linkedCustomerIds.push(...linked.map((row) => row.id));

  // Suppliers: Alpha links to Yankee (label sorts before Zulu), Bravo is
  // unlinked (NULL label → sorts last both directions), Charlie links to Zulu.
  // Payables: Alpha 800k owed, Bravo net-negative (clamped to 0, matching the
  // summary's >0-only projection), Charlie none.
  const suppliers = await db.insert(s.suppliers).values([
    { name: `Alpha NCC ${suffix}`, shortName: '', contactPerson: 'An', phone: '0900000001', taxCode: 'TAXA', linkedCustomerId: linkedCustomerIds[1]! },
    { name: `Bravo NCC ${suffix}`, shortName: '', contactPerson: 'Binh', phone: '0900000002', taxCode: 'TAXB', linkedCustomerId: null },
    { name: `Charlie NCC ${suffix}`, shortName: '', contactPerson: 'Cuc', phone: '0900000003', taxCode: 'TAXC', linkedCustomerId: linkedCustomerIds[0]! },
  ]).returning({ id: s.suppliers.id });
  supplierIds.push(...suppliers.map((row) => row.id));

  const supplierLedger = await db.insert(s.ledger).values([
    { txnType: TxnType.VENDOR_EXPENSE, entityType: 'VENDOR', entityId: supplierIds[0]!, debit: '0', credit: '800000', balance: '800000' },
    { txnType: TxnType.VENDOR_EXPENSE, entityType: 'VENDOR', entityId: supplierIds[1]!, debit: '0', credit: '200000', balance: '200000' },
    { txnType: TxnType.VENDOR_PAYMENT, entityType: 'VENDOR', entityId: supplierIds[1]!, debit: '700000', credit: '0', balance: '-500000' },
  ]).returning({ id: s.ledger.id });
  ledgerIds.push(...supplierLedger.map((row) => row.id));
});

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  if (ledgerIds.length > 0) {
    await db.delete(s.ledger).where(inArray(s.ledger.id, ledgerIds));
  }
  if (supplierIds.length > 0) {
    await db.delete(s.suppliers).where(inArray(s.suppliers.id, supplierIds));
  }
  const customerRows = [...customerIds, ...linkedCustomerIds];
  if (customerRows.length > 0) {
    await db.delete(s.customers).where(inArray(s.customers.id, customerRows));
  }
  if (actorId > 0) {
    await db.delete(s.users).where(inArray(s.users.id, [actorId]));
  }
  await disconnectRedis();
  await client.end();
});

describe('partner catalog list sorting (customers + suppliers)', () => {
  it('sorts customers by operational name asc and desc', async () => {
    const asc = await get(`/api/customers?search=${encodeURIComponent(suffix)}&sortBy=name&sortDir=asc`);
    assert.equal(asc.status, 200);
    assert.deepEqual(itemNames(asc.body), [
      `Alpha ${suffix}`,
      `Bravo ${suffix}`,
      `Charlie ${suffix}`,
    ]);

    const desc = await get(`/api/customers?search=${encodeURIComponent(suffix)}&sortBy=name&sortDir=desc`);
    assert.equal(desc.status, 200);
    assert.deepEqual(itemNames(desc.body), [
      `Charlie ${suffix}`,
      `Bravo ${suffix}`,
      `Alpha ${suffix}`,
    ]);
  });

  it('sorts customers by credit limit with NULLs last in both directions', async () => {
    const asc = await get(`/api/customers?search=${encodeURIComponent(suffix)}&sortBy=creditLimit&sortDir=asc`);
    assert.equal(asc.status, 200);
    // 100M (Charlie) → 300M (Alpha) → NULL (Bravo) despite ascending order.
    assert.deepEqual(itemNames(asc.body), [
      `Charlie ${suffix}`,
      `Alpha ${suffix}`,
      `Bravo ${suffix}`,
    ]);

    const desc = await get(`/api/customers?search=${encodeURIComponent(suffix)}&sortBy=creditLimit&sortDir=desc`);
    assert.equal(desc.status, 200);
    assert.deepEqual(itemNames(desc.body), [
      `Alpha ${suffix}`,
      `Charlie ${suffix}`,
      `Bravo ${suffix}`,
    ]);
  });

  it('sorts customers by debt, excluding carrier-payable postings like the page debt map', async () => {
    const desc = await get(`/api/customers?search=${encodeURIComponent(suffix)}&sortBy=debt&sortDir=desc`);
    assert.equal(desc.status, 200);
    // Charlie 1.2M → Alpha 500k (900k VENDOR_PAYMENT excluded) → Bravo 0.
    assert.deepEqual(itemNames(desc.body), [
      `Charlie ${suffix}`,
      `Alpha ${suffix}`,
      `Bravo ${suffix}`,
    ]);

    const asc = await get(`/api/customers?search=${encodeURIComponent(suffix)}&sortBy=debt&sortDir=asc`);
    assert.equal(asc.status, 200);
    assert.deepEqual(itemNames(asc.body), [
      `Bravo ${suffix}`,
      `Alpha ${suffix}`,
      `Charlie ${suffix}`,
    ]);
  });

  it('sorts suppliers by contact and linked-customer label (NULL last)', async () => {
    const contactDesc = await get(`/api/suppliers?search=${encodeURIComponent(suffix)}&sortBy=contactPerson&sortDir=desc`);
    assert.equal(contactDesc.status, 200);
    assert.deepEqual(itemNames(contactDesc.body), [
      `Charlie NCC ${suffix}`,
      `Bravo NCC ${suffix}`,
      `Alpha NCC ${suffix}`,
    ]);

    const linkedAsc = await get(`/api/suppliers?search=${encodeURIComponent(suffix)}&sortBy=linkedCustomer&sortDir=asc`);
    assert.equal(linkedAsc.status, 200);
    // Alpha→Yankee… < Charlie→Zulu… < Bravo (unlinked, NULL last).
    assert.deepEqual(itemNames(linkedAsc.body), [
      `Alpha NCC ${suffix}`,
      `Charlie NCC ${suffix}`,
      `Bravo NCC ${suffix}`,
    ]);
  });

  it('sorts suppliers by payable with the summary clamp at zero', async () => {
    const desc = await get(`/api/suppliers?search=${encodeURIComponent(suffix)}&sortBy=payable&sortDir=desc`);
    assert.equal(desc.status, 200);
    // Alpha 800k; Bravo net −500k clamps to 0 and ties with Charlie's 0,
    // resolved by the id tiebreaker (insertion order).
    assert.deepEqual(itemNames(desc.body), [
      `Alpha NCC ${suffix}`,
      `Bravo NCC ${suffix}`,
      `Charlie NCC ${suffix}`,
    ]);

    const asc = await get(`/api/suppliers?search=${encodeURIComponent(suffix)}&sortBy=payable&sortDir=asc`);
    assert.equal(asc.status, 200);
    assert.deepEqual(itemNames(asc.body), [
      `Bravo NCC ${suffix}`,
      `Charlie NCC ${suffix}`,
      `Alpha NCC ${suffix}`,
    ]);
  });

  it('rejects unknown sortBy values and ignores sortDir without sortBy', async () => {
    const bad = await get(`/api/customers?sortBy=;drop table&sortDir=asc`);
    assert.equal(bad.status, 400);

    const noSortBy = await get(`/api/customers?search=${encodeURIComponent(suffix)}&sortDir=desc`);
    assert.equal(noSortBy.status, 200);
    // sortDir alone never engages an ORDER BY: the response still returns the
    // full fixture set (order itself is the DB default, asserted only as a set).
    const names = itemNames(noSortBy.body).sort();
    assert.deepEqual(names, [
      `Alpha ${suffix}`,
      `Bravo ${suffix}`,
      `Charlie ${suffix}`,
    ]);
  });
});
