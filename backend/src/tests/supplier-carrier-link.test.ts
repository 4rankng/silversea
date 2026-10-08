import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import express from 'express';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { Role, SupplierType } from '@tingting/shared';
import { db } from '../db';
import * as s from '../db/schema';
import { globalErrorHandler } from '../middleware/errorHandler';
import configRouter, { catalogBootstrapRouter } from '../routes/config';
import { getBootstrapData } from '../services/config.service';
import { backfillCarrierSuppliers, backfillSupplierCarrierLinks } from '../scripts/backfill-supplier-carriers';
import { listDispatchFleet } from '../services/dispatch-planning-queries.service';
import type { AuthUser } from '../middleware/auth';
import { cacheInvalidate } from '../lib/redis';

/**
 * 2026-09-09 customer report (Bug A follow-up): a nhà thầu created on the
 * Suppliers page never appeared in the "Chọn nhà xe" dropdowns — those read
 * `customers.isCarrier`, and the supplier create path linked nothing. The
 * supplier relations hook now ensures a linked carrier customer on every
 * supplier write, so this file pins the contract end-to-end.
 */
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let server: http.Server;
let baseUrl = '';
let actorId = 0;
const createdSupplierIds: number[] = [];
const createdCustomerIds: number[] = [];

async function api(
  method: string,
  path: string,
  body?: Record<string, unknown>,
  extraHeaders?: Record<string, string>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  // Config mutations require an Idempotency-Key header.
  const mutating = method !== 'GET' && method !== 'DELETE';
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Test-Actor': '0',
      ...(mutating ? { 'Idempotency-Key': `ncc-link-${suffix}-${Math.random().toString(36).slice(2, 8)}` } : {}),
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

before(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = {
      userId: 0,
      username: `ncc-link-${suffix}`,
      email: null,
      fullName: null,
      role: Role.ADMIN,
    };
    next();
  });
  app.use('/api/config', configRouter);
  app.use('/api/catalogs', catalogBootstrapRouter);
  app.use(globalErrorHandler);

  const [actor] = await db.insert(s.users).values({
    username: `ncc-link-admin-${suffix}`,
    passwordHash: 'x',
    role: Role.ADMIN,
    status: 'ACTIVE',
  }).returning({ id: s.users.id });
  actorId = actor!.id;

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  for (const supplierId of createdSupplierIds) {
    await db.delete(s.suppliers).where(eq(s.suppliers.id, supplierId));
  }
  for (const customerId of createdCustomerIds) {
    await db.delete(s.customers).where(eq(s.customers.id, customerId));
  }
  await db.delete(s.users).where(eq(s.users.id, actorId));
  // Force-exit. node:test has already recorded every assertion by this
  // point. Graceful shutdown blocks on this Node 25 / postgres-js
  // combination (see shipment-routes.test.ts for the incident note); the
  // express server is closed first so the port is released.
  server?.closeAllConnections?.();
  server?.close();
  process.exit(0);
});

describe('supplier → carrier customer link (Chọn nhà xe visibility)', () => {
  it('creates a linked ACTIVE isCarrier customer that bootstrap lists as an external carrier', async () => {
    const name = `NCC Vận tải ${suffix}`;
    const created = await api('POST', '/api/config/suppliers', { name, types: ['CARRIER'] });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const supplierId = (created.body as { id: number }).id;
    createdSupplierIds.push(supplierId);

    const [supplier] = await db.select().from(s.suppliers).where(eq(s.suppliers.id, supplierId));
    assert.ok(supplier);
    assert.ok(supplier.linkedCustomerId, 'supplier must carry the auto link');
    createdCustomerIds.push(supplier.linkedCustomerId!);

    const [customer] = await db.select().from(s.customers).where(eq(s.customers.id, supplier.linkedCustomerId!));
    assert.ok(customer);
    assert.equal(customer.isCarrier, true);
    assert.equal(customer.status, 'ACTIVE');
    assert.equal(customer.name, name);
    assert.equal(customer.shortName, name);
    assert.equal(customer.linkedSupplierId, supplierId);

    const bootstrap = await getBootstrapData();
    const names = (bootstrap.externalCarriers ?? []).map((carrier) => carrier.name);
    assert.ok(
      names.includes(name),
      `bootstrap externalCarriers must list the new supplier's carrier; got: ${names.slice(0, 8).join(', ')}`,
    );
  });
  it('mirrors a supplier rename onto the linked carrier customer', async () => {
    const name = `NCC Doi ten ${suffix}B`;
    const created = await api('POST', '/api/config/suppliers', { name, types: ['CARRIER'] });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const supplierId = (created.body as { id: number }).id;
    createdSupplierIds.push(supplierId);

    // PUT is guarded by If-Unmodified-Since — read the fresh row first.
    const [beforeRow] = await db.select().from(s.suppliers).where(eq(s.suppliers.id, supplierId));
    const renamed = await api('PUT', `/api/config/suppliers/${supplierId}`, { name: `${name} - Mien Dong` }, { 'If-Unmodified-Since': beforeRow!.updatedAt.toISOString() });
    assert.equal(renamed.status, 200, JSON.stringify(renamed.body));

    const [supplier] = await db.select().from(s.suppliers).where(eq(s.suppliers.id, supplierId));
    assert.ok(supplier?.linkedCustomerId);
    createdCustomerIds.push(supplier.linkedCustomerId!);
    const [customer] = await db.select().from(s.customers).where(eq(s.customers.id, supplier.linkedCustomerId!));
    assert.equal(customer.name, `${name} - Mien Dong`);
    assert.equal(customer.isCarrier, true);
  });

  it('flags an explicitly linked customer as carrier without touching business fields', async () => {
    const [explicitCustomer] = await db.insert(s.customers).values({
      name: `NCC Khach cu ${suffix}C`,
      status: 'ACTIVE',
    }).returning({ id: s.customers.id, taxCode: s.customers.taxCode });
    createdCustomerIds.push(explicitCustomer!.id);

    const created = await api('POST', '/api/config/suppliers', {
      name: `NCC Lien ket ${suffix}C`,
      types: ['CARRIER'],
      linkedCustomerId: explicitCustomer!.id,
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const supplierId = (created.body as { id: number }).id;
    createdSupplierIds.push(supplierId);

    const [customer] = await db.select().from(s.customers).where(eq(s.customers.id, explicitCustomer!.id));
    assert.equal(customer.isCarrier, true, 'explicit link must make the customer selectable as nha xe');
    assert.equal(customer.linkedSupplierId, supplierId);
    assert.equal(customer.name, `NCC Khach cu ${suffix}C`, 'business-owned name must not be mirrored over');
  });

  it('hides the carrier from bootstrap when the supplier is deactivated', async () => {
    const name = `NCC Tam dung ${suffix}D`;
    const created = await api('POST', '/api/config/suppliers', { name, types: ['CARRIER'] });
    assert.equal(created.status, 201);
    const supplierId = (created.body as { id: number }).id;
    createdSupplierIds.push(supplierId);
    const [supplier] = await db.select().from(s.suppliers).where(eq(s.suppliers.id, supplierId));
    createdCustomerIds.push(supplier!.linkedCustomerId!);

    const deactivated = await api('PUT', `/api/config/suppliers/${supplierId}`, { status: 'INACTIVE' }, { 'If-Unmodified-Since': supplier!.updatedAt.toISOString() });
    assert.equal(deactivated.status, 200, JSON.stringify(deactivated.body));

    const bootstrap = await getBootstrapData();
    const names = (bootstrap.externalCarriers ?? []).map((carrier) => carrier.name);
    assert.ok(!names.includes(name), 'deactivated supplier must vanish from external carriers');
  });

  it('does NOT mirror a non-carrier supplier — a fuel station is not a nhà xe', async () => {
    // 2026-10-03: mirroring ran on every supplier write, so Petrolimex / PV Oil
    // (FUEL) and the insurers (SERVICE) were all selectable as external
    // carriers and all leaked into the merged khách hàng list. Carrier-ness is
    // now decided by `types`, full stop.
    const name = `Tram xang khong phai nha xe ${suffix}E`;
    const created = await api('POST', '/api/config/suppliers', { name, types: ['FUEL'] });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const supplierId = (created.body as { id: number }).id;
    createdSupplierIds.push(supplierId);
    const [supplier] = await db.select().from(s.suppliers).where(eq(s.suppliers.id, supplierId));
    const bootstrap = await getBootstrapData();
    const carrierNames = (bootstrap.externalCarriers ?? []).map((carrier) => carrier.name);
    assert.ok(!carrierNames.includes(name), 'a FUEL supplier must never appear as an external carrier');

    const [linked] = supplier?.linkedCustomerId
      ? await db.select({ isCarrier: s.customers.isCarrier })
        .from(s.customers).where(eq(s.customers.id, supplier.linkedCustomerId)).limit(1)
      : [];
    assert.notEqual(linked?.isCarrier, true, 'a non-carrier supplier must not own a carrier-flagged record');
  });

  it('withdraws the carrier flag when a supplier stops being a carrier', async () => {
    // The retraction path: a supplier created before the type existed already
    // holds a stale isCarrier mirror, and re-saving it as FUEL must take the
    // nhà xe away — otherwise the customer list stays polluted forever.
    const name = `Nha xe bi doi thanh nhi lieu ${suffix}F`;
    const created = await api('POST', '/api/config/suppliers', { name, types: ['CARRIER'] });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const supplierId = (created.body as { id: number }).id;
    createdSupplierIds.push(supplierId);
    const [before] = await db.select().from(s.suppliers).where(eq(s.suppliers.id, supplierId));
    createdCustomerIds.push(before!.linkedCustomerId!);

    const [beforeCustomer] = await db.select({ isCarrier: s.customers.isCarrier })
      .from(s.customers).where(eq(s.customers.id, before!.linkedCustomerId!)).limit(1);
    assert.equal(beforeCustomer!.isCarrier, true, 'precondition: it started as a nhà xe');

    const retyped = await api('PUT', `/api/config/suppliers/${supplierId}`, { types: ['FUEL'] },
      { 'If-Unmodified-Since': before!.updatedAt.toISOString() });
    assert.equal(retyped.status, 200, JSON.stringify(retyped.body));

    const [afterCustomer] = await db.select({ isCarrier: s.customers.isCarrier })
      .from(s.customers).where(eq(s.customers.id, before!.linkedCustomerId!)).limit(1);
    assert.equal(afterCustomer!.isCarrier, false, 'retagging as a fuel supplier must retract the nhà xe flag');
  });
});

describe('supplier carrier backfill (one-shot, idempotent)', () => {
  it('links pre-existing unlinked/dangling suppliers and is a no-op on re-run', async () => {
    // Pre-fix state 1: an ACTIVE supplier created before the hook fix — no
    // linked customer at all (the reported bug).
    const [unlinked] = await db.insert(s.suppliers).values({
      name: `NCC Backfill unlinked ${suffix}`,
      status: 'ACTIVE',
      types: ['CARRIER'],
    }).returning({ id: s.suppliers.id, name: s.suppliers.name });
    createdSupplierIds.push(unlinked!.id);

    // Pre-fix state 2: dangling link — the linked customer was soft-deleted.
    const [gone] = await db.insert(s.customers).values({
      name: `NCC Backfill deleted-link ${suffix}`,
      status: 'ACTIVE',
      deletedAt: new Date(),
    }).returning({ id: s.customers.id });
    createdCustomerIds.push(gone!.id);
    const [dangling] = await db.insert(s.suppliers).values({
      name: `NCC Backfill dangling ${suffix}`,
      status: 'ACTIVE',
      types: ['CARRIER'],
      linkedCustomerId: gone!.id,
    }).returning({ id: s.suppliers.id, name: s.suppliers.name });
    createdSupplierIds.push(dangling!.id);

    // Pre-fix state 3: the supplier's legal entity already exists as a live
    // customer under the same tax code, under a different name — the ensure
    // logic must adopt that row instead of minting a duplicate (the mint
    // would trip customers_active_tax_code_uniq_idx).
    const taxCode = `03${String(Date.now()).slice(-8)}`;
    const [taxHolder] = await db.insert(s.customers).values({
      name: `NCC Backfill taxholder ${suffix}`,
      status: 'ACTIVE',
      taxCode,
    }).returning({ id: s.customers.id, name: s.customers.name });
    createdCustomerIds.push(taxHolder!.id);
    const [taxSupplier] = await db.insert(s.suppliers).values({
      name: `NCC Backfill taxcode ${suffix}`,
      status: 'ACTIVE',
      types: ['CARRIER'],
      taxCode,
    }).returning({ id: s.suppliers.id, name: s.suppliers.name });
    createdSupplierIds.push(taxSupplier!.id);

    const first = await backfillSupplierCarrierLinks();
    assert.ok(first.checked >= 3, `expected the three fixtures scanned; got ${first.checked}`);
    assert.ok(first.ensured >= 3, `expected all three fixtures ensured; got ${first.ensured}`);

    // After run 1: every fixture resolves to a live ACTIVE isCarrier customer
    // — the exact row both "Chọn nhà xe" dropdown sources read.
    for (const fixture of [unlinked, dangling, taxSupplier]) {
      const [after] = await db.select({ linkedCustomerId: s.suppliers.linkedCustomerId })
        .from(s.suppliers).where(eq(s.suppliers.id, fixture!.id));
      assert.ok(after?.linkedCustomerId, `supplier ${fixture!.name} must end with a carrier link`);
      const [carrier] = await db.select().from(s.customers).where(eq(s.customers.id, after.linkedCustomerId!));
      assert.ok(carrier, `linked customer for ${fixture!.name} must exist`);
      assert.equal(carrier.isCarrier, true, `linked customer for ${fixture!.name} must be a carrier`);
      assert.equal(carrier.status, 'ACTIVE');
      assert.ok(!carrier.deletedAt, `linked customer for ${fixture!.name} must be live`);
      // Track the ensured rows for cleanup.
      createdCustomerIds.push(carrier.id);
    }

    // AC5 — visible in BOTH dropdown sources with no user action.
    // unlinked and dangling mint a customer with the supplier's name;
    // taxSupplier adopts taxHolder, which preserves taxHolder's business-owned name.
    const expectedCarriers = [
      { fixture: unlinked, expectedName: unlinked!.name },
      { fixture: dangling, expectedName: dangling!.name },
      { fixture: taxSupplier, expectedName: taxHolder!.name },
    ];

    // The backfill function (unlike main()) leaves the cache bust to its
    // caller — invalidate the bootstrap snapshot exactly the way the
    // deployer's script run does before reading it.
    await cacheInvalidate('catalogs:bootstrap');
    const bootstrap = await getBootstrapData();
    const bootstrapNames = (bootstrap.externalCarriers ?? []).map((carrier) => carrier.name);
    for (const { expectedName } of expectedCarriers) {
      assert.ok(
        bootstrapNames.includes(expectedName),
        `bootstrap.externalCarriers must list ${expectedName}; got: ${bootstrapNames.slice(0, 8).join(', ')}`,
      );
    }
    const fleet = await listDispatchFleet({
      actor: { userId: actorId, username: `backfill-${suffix}`, email: null, fullName: null, role: Role.ADMIN } satisfies AuthUser,
      resource: 'EXTERNAL_CARRIER',
    });
    // listDispatchFleet's result is a per-resource union; this call pins
    // EXTERNAL_CARRIER, whose items all carry `name`.
    const fleetNames = (fleet.items as Array<{ name: string }>).map((item) => item.name);
    for (const { expectedName } of expectedCarriers) {
      assert.ok(fleetNames.includes(expectedName), `dispatch-fleet EXTERNAL_CARRIER must list ${expectedName}`);
    }

    // Second run must be a no-op: zero targets repaired, and the supplier
    // rows are untouched (updatedAt would churn on any write).
    const beforeRerun = await db.select({
      id: s.suppliers.id,
      linkedCustomerId: s.suppliers.linkedCustomerId,
      updatedAt: s.suppliers.updatedAt,
    }).from(s.suppliers).where(inArray(s.suppliers.id, [unlinked!.id, dangling!.id, taxSupplier!.id]));
    const second = await backfillSupplierCarrierLinks();
    assert.equal(second.ensured, 0, 'second run must repair nothing (idempotent)');
    const afterRerun = await db.select({
      id: s.suppliers.id,
      linkedCustomerId: s.suppliers.linkedCustomerId,
      updatedAt: s.suppliers.updatedAt,
    }).from(s.suppliers).where(inArray(s.suppliers.id, [unlinked!.id, dangling!.id, taxSupplier!.id]));
    assert.deepEqual(afterRerun, beforeRerun, 'second run must not touch the linked rows');
  });
});

describe('orphan carrier adoption (carrier → owning supplier)', () => {
  it('gives a sheet-seeded carrier with no supplier its own CARRIER-typed supplier', async () => {
    // The "Nhà xe" sheet seeds carriers straight into `customers`, leaving them
    // with no owner anywhere — invisible on /suppliers and impossible to edit
    // now that carriers are administered there. Reconciliation must adopt or
    // mint one, and a second run must be a no-op.
    const name = `Nha xe orphan ${suffix}G`;
    const [carrier] = await db.insert(s.customers).values({
      name, shortName: name, status: 'ACTIVE', isCarrier: true, linkedSupplierId: null,
    }).returning({ id: s.customers.id });
    createdCustomerIds.push(carrier!.id);

    const first = await backfillCarrierSuppliers();
    assert.ok(first.minted >= 1 || first.adopted >= 1, `the orphan must gain an owner; got ${JSON.stringify(first)}`);

    const [supplier] = await db.select({
      id: s.suppliers.id, types: s.suppliers.types, linkedCustomerId: s.suppliers.linkedCustomerId,
    }).from(s.suppliers).where(eq(s.suppliers.name, name)).limit(1);
    assert.ok(supplier, 'a CARRIER-typed supplier must exist for the orphan nhà xe');
    createdSupplierIds.push(supplier!.id);
    assert.deepEqual(supplier!.types, ['CARRIER']);

    const [reowned] = await db.select({ linkedSupplierId: s.customers.linkedSupplierId })
      .from(s.customers).where(eq(s.customers.id, carrier!.id)).limit(1);
    assert.equal(reowned!.linkedSupplierId, supplier!.id, 'the carrier must point back at its supplier');
    assert.equal(supplier!.linkedCustomerId, carrier!.id, 'and the supplier must point back at the carrier');

    const second = await backfillCarrierSuppliers();
    assert.equal(second.adopted + second.minted, 0, 'a second run must adopt nothing (idempotent)');
  });

  it('adopts an existing supplier that matches the carrier by tax code instead of minting a duplicate', async () => {
    const taxCode = `07${String(Date.now() + 7).slice(-8)}`;
    const [supplier] = await db.insert(s.suppliers).values({
      name: `NCC trùng MST ${suffix}H`,
      shortName: `NCC trùng MST ${suffix}H`,
      taxCode,
      types: [SupplierType.CARRIER],
      primaryType: SupplierType.CARRIER,
      status: 'ACTIVE',
    }).returning({ id: s.suppliers.id });
    createdSupplierIds.push(supplier!.id);

    // Business-named differently, but the same legal entity by tax code — the
    // identity the customers index treats as unique, so a mint would collide.
    const [carrier] = await db.insert(s.customers).values({
      name: `Nha xe khac ten ${suffix}H`,
      status: 'ACTIVE',
      isCarrier: true,
      taxCode,
      linkedSupplierId: null,
    }).returning({ id: s.customers.id });
    createdCustomerIds.push(carrier!.id);

    const result = await backfillCarrierSuppliers();
    assert.ok(result.adopted >= 1, `the tax-code holder must be adopted; got ${JSON.stringify(result)}`);
    const matched = await db.select({ id: s.suppliers.id }).from(s.suppliers)
      .where(and(eq(s.suppliers.name, `Nha xe khac ten ${suffix}H`), isNull(s.suppliers.deletedAt)));
    assert.equal(matched.length, 0, 'no duplicate supplier may be minted for an already-registered tax code');

    const [linked] = await db.select({ linkedCustomerId: s.suppliers.linkedCustomerId })
      .from(s.suppliers).where(eq(s.suppliers.id, supplier!.id)).limit(1);
    assert.equal(linked!.linkedCustomerId, carrier!.id, 'the existing supplier adopts the carrier');
  });
});
