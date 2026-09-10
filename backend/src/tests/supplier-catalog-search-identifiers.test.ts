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
 * Mirrors customer-catalog-search-identifiers.test.ts for the suppliers
 * catalog: the 2026-09-10 report showed taxCode/phone were sortable but not
 * searchable on GET /config/suppliers — identifier lookup (full or last 4-5
 * chars) returned nothing.
 */
const rnd = Math.random().toString(36).slice(2, 8);

describe('GET /config/suppliers identifier search', () => {
  let server: http.Server;
  let baseUrl = '';
  let supplierId = 0;
  let taxCode = '';
  let phone = '';

  async function search(q: string): Promise<{ status: number; items: Array<{ id: number }> }> {
    const response = await fetch(`${baseUrl}/api/config/suppliers?page=1&limit=50&search=${encodeURIComponent(q)}`);
    const body = await response.json() as { items?: Array<{ id: number }> };
    return { status: response.status, items: body.items ?? [] };
  }

  before(async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { userId: 0, username: `sup-search-${rnd}`, email: null, fullName: null, role: Role.ADMIN };
      next();
    });
    app.use('/api/config', configRouter);
    app.use(globalErrorHandler);

    taxCode = `85${rnd}31B9`;
    phone = `091${rnd}50612`;
    const [supplier] = await db.insert(s.suppliers).values({
      name: `Công ty CP Vận Tải ${rnd}`,
      shortName: `CPVT${rnd}`,
      taxCode,
      contactPerson: `Trần Văn ${rnd}`,
      phone,
      status: 'ACTIVE',
    }).returning({ id: s.suppliers.id });
    supplierId = supplier!.id;

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  it('T1 matches the full tax code', async () => {
    const r = await search(taxCode);
    assert.equal(r.status, 200);
    assert.ok(r.items.some((x) => x.id === supplierId), 'full taxCode must find the supplier');
  });

  it('T2 matches the last 4 chars of the tax code', async () => {
    const r = await search(taxCode.slice(-4));
    assert.equal(r.status, 200);
    assert.ok(r.items.some((x) => x.id === supplierId), 'taxCode tail must find the supplier');
  });

  it('T3 matches the last 5 digits of the phone', async () => {
    const r = await search(phone.slice(-5));
    assert.equal(r.status, 200);
    assert.ok(r.items.some((x) => x.id === supplierId), 'phone tail must find the supplier');
  });

  it('T4 matches the full phone', async () => {
    const r = await search(phone);
    assert.equal(r.status, 200);
    assert.ok(r.items.some((x) => x.id === supplierId), 'full phone must find the supplier');
  });

  it('T5 still matches the short name (control)', async () => {
    const r = await search(`CPVT${rnd}`);
    assert.equal(r.status, 200);
    assert.ok(r.items.some((x) => x.id === supplierId), 'shortName control must find the supplier');
  });

  it('T6 still matches a name fragment (control)', async () => {
    const r = await search(`Vận Tải ${rnd}`);
    assert.equal(r.status, 200);
    assert.ok(r.items.some((x) => x.id === supplierId), 'name fragment control must find the supplier');
  });

  it('T7 does not match a random unknown token', async () => {
    const r = await search(`zzqj${rnd}x`);
    assert.equal(r.status, 200);
    assert.equal(r.items.some((x) => x.id === supplierId), false, 'random control must not find the supplier');
  });

  it('T8 matches the name without diacritics (unaccent contract)', async () => {
    const r = await search(`Cong ty CP Van Tai ${rnd}`);
    assert.equal(r.status, 200);
    assert.ok(r.items.some((x) => x.id === supplierId), 'diacritic-folded name must find the supplier');
  });

  after(async () => {
    await db.delete(s.suppliers).where(eq(s.suppliers.id, supplierId));
    // Force-exit: node:test + postgres-js hangs on graceful shutdown on this
    // Node 25 combination (see supplier-carrier-link.test.ts incident note).
    server.close();
    setTimeout(() => process.exit(0), 250).unref();
  });
});
