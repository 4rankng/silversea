import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import { Role } from '@tingting/shared';
import { client } from '../db';

/**
 * Card 20261002_220 — CUS reads the active quotation fee catalog (PM ruling
 * 2026-10-03).
 *
 * Before the ruling CUS had no `config, read` policy row, so the Chi-hộ
 * screen's only source for its dedicated cost columns
 * (`GET /api/quotations/fees/active`) answered 403. The FE had grown a role
 * gate to suppress the call, which left the columns missing for the very role
 * the ruling covers.
 *
 * The grant is deliberately route-scoped to that ONE GET. These tests pin both
 * halves of that: the granted read works, and the neighbouring config surface
 * a wholesale `p, CUS, config, read` would have opened stays denied.
 */
describe('card 20261002_220 — CUS reads the active quotation fee catalog', () => {
  let server: import('node:http').Server;
  let port = 0;

  /** Boot the REAL router behind the REAL casbin gate, as index.ts mounts it,
   *  with the acting role injected — no auth middleware, so the only thing
   *  deciding 200 vs 403 is the policy + grant registry under test. */
  async function bootAs(role: Role) {
    const http = await import('node:http');
    const express = (await import('express')).default;
    const { initEnforcer } = await import('../casbin/enforcer');
    const { casbinAuthz } = await import('../middleware/casbin');
    const { globalErrorHandler } = await import('../middleware/errorHandler');
    const quotationRoutes = (await import('../routes/config')).default;
    await initEnforcer();
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as unknown as { user?: unknown }).user = {
        userId: 0, username: 'cus-read', email: 'cus-read@x', fullName: 'CUS Read', role,
      };
      next();
    });
    // The app mounts the config gate at bare '/api' (index.ts:230) and nests
    // the quotations router under it (routes/config.ts:41), so req.path at the
    // gate is '/quotations/fees/active' — exactly what the grant matches.
    // Mounting the real config router keeps that path shape honest; mounting
    // quotations.routes directly would put the leaf at '/api/fees/active' and
    // silently test a different route.
    app.use('/api', casbinAuthz('config'), quotationRoutes);
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
    // not a closeDb helper — fixed forward from card 20260930_220's landing).
  });

  after(async () => {
    await closeServer();
    await client.end();
  });

  test('CUS gets the active fee catalog instead of 403', async () => {
    await bootAs(Role.CUS);
    const response = await fetch(`http://127.0.0.1:${port}/api/quotations/fees/active?customerId=1`);
    assert.notEqual(response.status, 403, 'CUS must not be denied the active fee catalog');
    assert.equal(response.status, 200, `expected 200 for the granted read, got ${response.status}`);
    const body = await response.json() as { items?: unknown[] };
    assert.ok(Array.isArray(body.items), 'the payload keeps its items[] shape');
  });

  test('the grant is scoped: other config catalogs stay denied to CUS', async () => {
    // A `p, CUS, config, read` policy row would have opened all of these. The
    // ruling asked for the fee catalog, so the boundary is pinned here.
    await bootAs(Role.CUS);
    for (const path of ['/api/pricing-tables', '/api/expense-categories', '/api/quotations']) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`);
      assert.equal(response.status, 403, `${path} must stay Casbin-denied for CUS`);
    }
  });

  test('the grant is GET-only: a write on the same path is still denied', async () => {
    await bootAs(Role.CUS);
    const response = await fetch(`http://127.0.0.1:${port}/api/quotations/fees/active?customerId=1`, {
      method: 'DELETE',
    });
    assert.equal(response.status, 403, 'a non-GET verb on the granted path must not pass');
  });

  test('a near-miss path under the same prefix is not swept in', async () => {
    await bootAs(Role.CUS);
    const response = await fetch(`http://127.0.0.1:${port}/api/quotations/fees/active/export`);
    assert.equal(response.status, 403, 'only the exact active path was granted');
  });
});
