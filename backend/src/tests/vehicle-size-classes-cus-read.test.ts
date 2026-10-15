import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import { Role } from '@tingting/shared';
import { client } from '../db';

/**
 * QA B-1 (FB-093, staging 2026-10-16) — CUS reads the vehicle-size-class
 * catalog for the "Ghép cước thu khách" merge dialog.
 *
 * The merge route names Role.CUS, but the dialog's "Loại xe tính cước thu
 * khách" dropdown loads `GET /api/vehicle-size-classes?limit=100&page=1` and
 * that catalog sits on the `config` mount, where CUS holds no casbin policy
 * row — so the read answered 403, the dropdown stayed empty and CUS could
 * never submit the merge (ACCOUNTANT worked fine on the same screen).
 *
 * The grant is deliberately route-scoped to that ONE GET list path (the same
 * shape as the quotation-fee read, card 20261002_220). These tests pin both
 * halves: the granted read works, and every neighbouring config surface a
 * wholesale `p, CUS, config, read` would have opened stays denied.
 */
describe('QA B-1 (FB-093) — CUS reads the vehicle-size-class catalog', () => {
  let server: import('node:http').Server;
  let port = 0;

  /** Boot the REAL config router behind the REAL casbin gate, as index.ts
   * mounts it (bare '/api'), with the acting role injected — no auth
   * middleware, so the only thing deciding 200 vs 403 is the policy + grant
   * registry under test. */
  async function bootAs(role: Role) {
    const http = await import('node:http');
    const express = (await import('express')).default;
    const { initEnforcer } = await import('../casbin/enforcer');
    const { casbinAuthz } = await import('../middleware/casbin');
    const { globalErrorHandler } = await import('../middleware/errorHandler');
    const configRoutes = (await import('../routes/config')).default;
    await initEnforcer();
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as unknown as { user?: unknown }).user = {
        userId: 0, username: 'cus-read', email: 'cus-read@x', fullName: 'CUS Read', role,
      };
      next();
    });
    // The app mounts the config gate at bare '/api' (index.ts) with the whole
    // config router under it, so req.path at the gate is
    // '/vehicle-size-classes' — exactly what the grant matches. Mounting the
    // real config router keeps that path shape honest.
    app.use('/api', casbinAuthz('config'), configRoutes);
    app.use(globalErrorHandler);
    // Rebind per test: the previous listen handle must go, or the open
    // sockets keep the runner alive after the last assertion.
    await closeServer();
    const s = http.createServer(app);
    await new Promise<void>((resolve) => s.listen(0, '127.0.0.1', resolve));
    port = (s.address() as AddressInfo).port;
    server = s;
    return { role, port };
  }

  async function closeServer() {
    if (!server) return;
    const dying = server;
    server = null as unknown as import('node:http').Server;
    await new Promise<void>((resolve) => dying.close(() => resolve()));
  }

  before(async () => {
    // Teardown closes the shared pool directly (db/index exports `client`,
    // not a closeDb helper).
  });

  after(async () => {
    await closeServer();
    await client.end();
  });

  test('B1-01: CUS gets the vehicle-size-class list instead of 403', async () => {
    await bootAs(Role.CUS);
    const response = await fetch(`http://127.0.0.1:${port}/api/vehicle-size-classes?limit=100&page=1`);
    assert.notEqual(response.status, 403, 'CUS must not be denied the vehicle-size-class list');
    assert.equal(response.status, 200, `expected 200 for the granted read, got ${response.status}`);
    const body = await response.json() as { items?: unknown[] };
    assert.ok(Array.isArray(body.items), 'the payload keeps its items[] shape');
  });

  test('B1-02: the grant is scoped — other config catalogs stay denied to CUS', async () => {
    // A `p, CUS, config, read` policy row would have opened all of these.
    // The QA fix asked for the vehicle-class dropdown only, so the boundary
    // is pinned here: pricing tables, expense categories and fuel norms are
    // admin/accountant config surfaces CUS must still not read.
    await bootAs(Role.CUS);
    for (const path of ['/api/pricing-tables', '/api/expense-categories', '/api/fuel-consumption-norms']) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`);
      assert.equal(response.status, 403, `${path} must stay Casbin-denied for CUS`);
    }
  });

  test('B1-03a: the grant is GET-only — a write on the same path is still denied', async () => {
    await bootAs(Role.CUS);
    const response = await fetch(`http://127.0.0.1:${port}/api/vehicle-size-classes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'B1-03', name: 'must not be created' }),
    });
    assert.equal(response.status, 403, 'a non-GET verb on the granted path must not pass');
  });

  test('B1-03b: a near-miss path under the same prefix is not swept in', async () => {
    // Only the list GET was granted; the detail-row read keeps its
    // casbin-denied state for CUS.
    await bootAs(Role.CUS);
    const response = await fetch(`http://127.0.0.1:${port}/api/vehicle-size-classes/1`);
    assert.equal(response.status, 403, 'only the exact list path was granted');
  });
});
