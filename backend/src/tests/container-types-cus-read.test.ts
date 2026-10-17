import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import { Role } from '@tingting/shared';
import { client } from '../db';

/**
 * FB-086 (verify-fail round 21, 171026175000) — CUS reads the
 * container-type catalog for add-container flows.
 *
 * The add-container dialog QA drove on /shipments/:id loaded
 * `GET /api/container-types?limit=100&page=1` behind the `config` casbin
 * gate, where CUS holds no policy row — the read answered 403, the lazy
 * catalog query failed silently, and the "Loại container" dropdown offered
 * only its "Chưa chọn loại cont" placeholder, so no container could be
 * added (DISPATCHER/ACCOUNTANT worked fine on the same endpoint).
 *
 * The grant is deliberately route-scoped to that ONE GET list path (the
 * same shape as the vehicle-size-class read, FB-093, and the
 * quotation-fee read, card 20261002_220). These tests pin both halves:
 * the granted read works, and every neighbouring config surface a
 * wholesale `p, CUS, config, read` would have opened stays denied.
 */
describe('FB-086 (round 21) — CUS reads the container-type catalog', () => {
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
    // config router under it, so req.path at the gate is '/container-types'
    // — exactly what the grant matches. Mounting the real config router
    // keeps that path shape honest.
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

  after(async () => {
    await closeServer();
    await client.end();
  });

  test('CUS gets the container-type list instead of 403', async () => {
    await bootAs(Role.CUS);
    const response = await fetch(`http://127.0.0.1:${port}/api/container-types?limit=100&page=1`);
    assert.notEqual(response.status, 403, 'CUS must not be denied the container-type list');
    assert.equal(response.status, 200, `expected 200 for the granted read, got ${response.status}`);
    const body = await response.json() as { items?: unknown[] };
    assert.ok(Array.isArray(body.items), 'the payload keeps its items[] shape');
  });

  test('the grant is scoped — other config catalogs stay denied to CUS', async () => {
    // A `p, CUS, config, read` policy row would have opened all of these.
    // The fix asked for the container-type dropdown only, so the boundary is
    // pinned here: pricing tables, expense categories and fuel norms are
    // admin/accountant config surfaces CUS must still not read.
    await bootAs(Role.CUS);
    for (const path of ['/api/pricing-tables', '/api/expense-categories', '/api/fuel-consumption-norms']) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`);
      assert.equal(response.status, 403, `${path} must stay Casbin-denied for CUS`);
    }
  });

  test('the grant is GET-only — a write on the same path is still denied', async () => {
    await bootAs(Role.CUS);
    const response = await fetch(`http://127.0.0.1:${port}/api/container-types`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'FB086', name: 'must not be created' }),
    });
    assert.equal(response.status, 403, 'a non-GET verb on the granted path must not pass');
  });

  test('a near-miss path under the same prefix is not swept in', async () => {
    // Only the list GET was granted; the detail-row read keeps its
    // casbin-denied state for CUS.
    await bootAs(Role.CUS);
    const response = await fetch(`http://127.0.0.1:${port}/api/container-types/1`);
    assert.equal(response.status, 403, 'only the exact list path was granted');
  });
});
