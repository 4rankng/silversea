import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import express from 'express';
import { eq } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import { db } from '../db';
import * as s from '../db/schema';
import { globalErrorHandler } from '../middleware/errorHandler';
import configRouter from '../routes/config';

/**
 * 2026-09-10 customer report: looking a customer up by tax code or phone —
 * full value or last 4-5 chars — found nothing, because the catalog search
 * predicate only covered shortName/name. This pins identifier search on
 * GET /config/customers end-to-end (contains-ILIKE covers full and tail).
 */
const rnd = Math.random().toString(36).slice(2, 8);

describe('GET /config/customers identifier search', () => {
  let server: http.Server;
  let baseUrl = '';
  let customerId = 0;
  let taxCode = '';
  let phone = '';

  async function search(q: string): Promise<{ status: number; items: Array<{ id: number }> }> {
    const response = await fetch(`${baseUrl}/api/config/customers?page=1&limit=50&search=${encodeURIComponent(q)}`);
    const body = await response.json() as { items?: Array<{ id: number }> };
    return { status: response.status, items: body.items ?? [] };
  }

  before(async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { userId: 0, username: `cat-search-${rnd}`, email: null, fullName: null, role: Role.ADMIN };
      next();
    });
    app.use('/api/config', configRouter);
    app.use(globalErrorHandler);

    taxCode = `84${rnd}77A5`;
    phone = `090${rnd}43891`;
    const [customer] = await db.insert(s.customers).values({
      name: `Công ty TNHH Tìm Kiếm ${rnd}`,
      shortName: `TKSX${rnd}`,
      taxCode,
      contactPerson: `Nguyễn Văn ${rnd}`,
      phone,
      status: 'ACTIVE',
    }).returning({ id: s.customers.id });
    customerId = customer!.id;

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  it('T1 matches the full tax code', async () => {
    const r = await search(taxCode);
    assert.equal(r.status, 200);
    assert.ok(r.items.some((c) => c.id === customerId), 'full taxCode must find the customer');
  });

  it('T2 matches the last 4 chars of the tax code', async () => {
    const r = await search(taxCode.slice(-4));
    assert.equal(r.status, 200);
    assert.ok(r.items.some((c) => c.id === customerId), 'taxCode tail must find the customer');
  });

  it('T3 matches the last 5 digits of the phone', async () => {
    const r = await search(phone.slice(-5));
    assert.equal(r.status, 200);
    assert.ok(r.items.some((c) => c.id === customerId), 'phone tail must find the customer');
  });

  it('T4 matches the full phone', async () => {
    const r = await search(phone);
    assert.equal(r.status, 200);
    assert.ok(r.items.some((c) => c.id === customerId), 'full phone must find the customer');
  });

  it('T5 still matches the short name (control)', async () => {
    const r = await search(`TKSX${rnd}`);
    assert.equal(r.status, 200);
    assert.ok(r.items.some((c) => c.id === customerId), 'shortName control must find the customer');
  });

  it('T6 still matches a name fragment (control)', async () => {
    const r = await search(`Tìm Kiếm ${rnd}`);
    assert.equal(r.status, 200);
    assert.ok(r.items.some((c) => c.id === customerId), 'name fragment control must find the customer');
  });

  it('T7 does not match a random unknown token', async () => {
    const r = await search(`zzqj${rnd}x`);
    assert.equal(r.status, 200);
    assert.equal(r.items.some((c) => c.id === customerId), false, 'random control must not find the customer');
  });

  it('T8 matches the name without diacritics (unaccent contract)', async () => {
    const r = await search(`Cong ty TNHH Tim Kiem ${rnd}`);
    assert.equal(r.status, 200);
    assert.ok(r.items.some((c) => c.id === customerId), 'diacritic-folded name must find the customer');
  });

  after(async () => {
    await db.delete(s.customers).where(eq(s.customers.id, customerId));
    // Force-exit: node:test + postgres-js hangs on graceful shutdown on this
    // Node 25 combination (see supplier-carrier-link.test.ts incident note);
    // every assertion is already recorded when after() runs.
    server.close();
    setTimeout(() => process.exit(0), 250).unref();
  });
});
