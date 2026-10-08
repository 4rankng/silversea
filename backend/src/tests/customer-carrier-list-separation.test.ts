import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import express from 'express';
import { inArray } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import { db } from '../db';
import * as s from '../db/schema';
import { globalErrorHandler } from '../middleware/errorHandler';
import configRouter from '../routes/config';

/**
 * 2026-10-03 customer report: the workbook's "Khách hàng" and "Nhà xe" sheets
 * are two separate populations, but the app showed them gộp — opening either
 * list produced the same combined rows. Carriers are customers rows flagged
 * `isCarrier`, and GET /config/customers had no predicate on that flag, so
 * every nhà xe (plus every fuel station and insurer the supplier mirror hook
 * had flagged) appeared in the customer list.
 *
 * These pin the SEPARATION itself, not the plumbing: what each list contains,
 * and that the flag decides membership.
 */
const rnd = Math.random().toString(36).slice(2, 8);

describe('GET /config/customers — khách hàng and nhà xe are separate lists', () => {
  let server: http.Server;
  let baseUrl = '';
  const customerIds: number[] = [];
  const carrierIds: number[] = [];
  const marker = `SEPCAR${rnd}`;

  async function list(query = ''): Promise<{ status: number; items: Array<{ id: number; isCarrier: boolean }>; total: number }> {
    const response = await fetch(`${baseUrl}/api/config/customers?page=1&limit=200${query}`);
    const body = await response.json() as { items?: Array<{ id: number; isCarrier: boolean }>; total?: number };
    return { status: response.status, items: body.items ?? [], total: body.total ?? 0 };
  }

  before(async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { userId: 0, username: `sep-${rnd}`, email: null, fullName: null, role: Role.ADMIN };
      next();
    });
    app.use('/api/config', configRouter);
    app.use(globalErrorHandler);

    const inserted = await db.insert(s.customers).values([
      { name: `Công ty TNHH Tách biệt khách hàng ${marker}`, shortName: `KH${marker}`, status: 'ACTIVE' },
      { name: `Công ty TNHH Tách biệt nhà xe ${marker}`, shortName: `NX${marker}`, status: 'ACTIVE', isCarrier: true },
    ]).returning({ id: s.customers.id });
    customerIds.push(inserted[0]!.id);
    carrierIds.push(inserted[1]!.id);

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  it('the default list is the customer population only', async () => {
    const r = await list(`&search=${encodeURIComponent(marker)}`);
    assert.equal(r.status, 200);
    assert.ok(r.items.some((c) => c.id === customerIds[0]), 'the khách hàng row must be listed');
    assert.ok(!r.items.some((c) => c.id === carrierIds[0]), 'a nhà xe must NOT appear in the khách hàng list');
    assert.ok(r.items.every((c) => c.isCarrier === false), 'no carrier-flagged row may leak into the default list');
  });

  it('total counts the same population the items do', async () => {
    // A total that ignored the predicate would page the table over rows it can
    // never render — the classic "merged list" symptom seen from the pager.
    const r = await list(`&search=${encodeURIComponent(marker)}`);
    const ids = new Set(r.items.map((c) => c.id));
    assert.equal(r.total, ids.size, 'total must reflect the filtered WHERE, not the whole table');
    assert.ok(!ids.has(carrierIds[0]!));
  });

  it('?isCarrier=true returns the nhà xe population', async () => {
    const r = await list(`&isCarrier=true&search=${encodeURIComponent(marker)}`);
    assert.equal(r.status, 200);
    assert.ok(r.items.some((c) => c.id === carrierIds[0]), 'the nhà xe row must be listed');
    assert.ok(!r.items.some((c) => c.id === customerIds[0]), 'a khách hàng must NOT appear in the nhà xe list');
    assert.ok(r.items.every((c) => c.isCarrier === true));
  });

  it('?isCarrier=false is the same population as the default', async () => {
    const explicit = await list(`&isCarrier=false&search=${encodeURIComponent(marker)}`);
    const implicit = await list(`&search=${encodeURIComponent(marker)}`);
    assert.deepEqual(explicit.items.map((c) => c.id).sort(), implicit.items.map((c) => c.id).sort());
  });

  it('an unparseable filter value is rejected instead of silently widening the list', async () => {
    const r = await list('&isCarrier=yes');
    assert.equal(r.status, 400, 'a typo must never fall back to the default and hide the real population');
  });

  it('a filter outside the whitelist is rejected', async () => {
    const r = await list('&isSomethingElse=true');
    assert.equal(r.status, 400);
  });

  after(async () => {
    await db.delete(s.customers).where(inArray(s.customers.id, [...customerIds, ...carrierIds]));
    server.close();
    // node:test + postgres-js hangs on graceful shutdown on this Node 25
    // combination (see customer-catalog-search-identifiers.test.ts); every
    // assertion is already recorded when after() runs.
    setTimeout(() => process.exit(0), 250).unref();
  });
});
