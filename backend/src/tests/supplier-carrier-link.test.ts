import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import express from 'express';
import { eq } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import { db } from '../db';
import * as s from '../db/schema';
import { disconnectRedis } from '../lib/redis';
import { globalErrorHandler } from '../middleware/errorHandler';
import configRouter, { catalogBootstrapRouter } from '../routes/config';
import { getBootstrapData } from '../services/config.service';

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
  server?.closeAllConnections?.();
  server?.close();
  await disconnectRedis();
});

describe('supplier → carrier customer link (Chọn nhà xe visibility)', () => {
  it('creates a linked ACTIVE isCarrier customer that bootstrap lists as an external carrier', async () => {
    const name = `NCC Vận tải ${suffix}`;
    const created = await api('POST', '/api/config/suppliers', { name });
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
    const created = await api('POST', '/api/config/suppliers', { name });
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
    const created = await api('POST', '/api/config/suppliers', { name });
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
});
