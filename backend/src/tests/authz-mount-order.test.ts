import assert from 'node:assert/strict';
import { before, after, describe, it } from 'node:test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { Role } from '@tingting/shared';
import { initEnforcer } from '../casbin/enforcer';
import { casbinAuthz } from '../middleware/casbin';
import configRoutes from '../routes/config';
import financialRoutes from '../routes/financial';
import { globalErrorHandler } from '../middleware/errorHandler';

/**
 * Card 20261001_253 — the mount-order regression shape.
 *
 * The real app mounts BOTH the config and the financial authz gates at bare
 * '/api' (index.ts:229-230, config first), so a /api/finance request is
 * evaluated by the CONFIG gate BEFORE the financial one, and both gates must
 * pass. Suites that drive a single casbinAuthz directly (mount-relative path)
 * cannot see this — which is why the CUS debit-note grant stayed dead for
 * weeks while every suite was green. This suite reproduces the REAL mount
 * order and drives full paths through it.
 */

const ROLE_BY_HEADER: Record<string, Role> = {
  cus: Role.CUS,
  ops: Role.OPS,
  dispatcher: Role.DISPATCHER,
};

let server: http.Server;
let baseUrl: string;

before(async () => {
  await initEnforcer();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const role = ROLE_BY_HEADER[req.header('X-Test-Role') ?? ''];
    if (role) {
      (req as express.Request & { user?: unknown }).user = {
        userId: 1, username: 'test', email: 'test@x', fullName: 'test', role,
      };
    }
    next();
  });
  // The REAL order (index.ts:229-230): the config gate at bare '/api' first,
  // the financial gate second. configRoutes' own sub-routers only match their
  // own paths, so unmatched /api/finance paths fall through to the financial
  // mount — exactly like production.
  app.use('/api', casbinAuthz('config'), configRoutes);
  app.use('/api', casbinAuthz('financial'), financialRoutes);
  app.use(globalErrorHandler);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function get(path: string, role: string): Promise<number> {
  const res = await fetch(`${baseUrl}${path}`, { headers: { 'X-Test-Role': role } });
  // Drain the body so the socket frees.
  await res.text();
  return res.status;
}

describe('mount-order regression (card 20261001_253)', () => {
  it('admits CUS to its own issued debit-note reads through the real mount chain', async () => {
    // The config gate sees /finance/billing-documents/<id> FIRST — the 253
    // mirror grant must admit CUS there, then the financial grant at the
    // second gate. 404 = both authz gates passed, note not found.
    assert.notEqual(await get('/api/finance/billing-documents/99999999', 'cus'), 403);
    assert.notEqual(await get('/api/finance/billing-documents/99999999/export', 'cus'), 403);
  });

  it('keeps every non-granted financial cell closed (no widening)', async () => {
    // The LIST is deliberately outside the grant (the registry row's own
    // reason keeps list denied to CUS) and OPS has no financial surface.
    assert.equal(await get('/api/finance/billing-documents', 'cus'), 403);
    assert.equal(await get('/api/finance/billing-documents/99999999', 'ops'), 403);
    assert.equal(await get('/api/finance/billing-documents/99999999/export', 'ops'), 403);
  });

  it('keeps the config family config-gated and its grants intact', async () => {
    // The config mount still guards its own surface: OPS (no config policy,
    // no grant) stays out; the CUS catalog-read grant still fires.
    assert.equal(await get('/api/customers', 'ops'), 403);
    assert.equal(await get('/api/customers', 'cus'), 200);
    assert.equal(await get('/api/routes', 'cus'), 200);
  });
});
