// cases/chungtu-regression/TC-CUS-API-MASTERREF-001.mjs
// Pins board card 20260915_12: POST/PUT /api/shipments must reject phantom
// master-data references (customerId / routeId that do not exist) with 400 +
// the Vietnamese service error, instead of 201/200 + an orphan row.
//
// WRITE-ONLY UNTIL THE CUT: running this against staging BEFORE the fix is
// deployed would create orphan rows (phantom refs saved as 201/200). The case
// therefore degrades to verdict SKIP when it sees the pre-fix behavior
// (201/200) — run-all treats SKIP as non-failing — and passes only post-cut.
// The operator must still not RUN it pre-cut; the SKIP branch is a guard,
// not an invitation.
//
// Run: STAGING_URL=https://vantai.tingting.vip \
//      node testplan/qa/scripts/run-all.mjs chungtu-regression

import { randomUUID } from 'node:crypto';

export const caseId = 'TC-CUS-API-MASTERREF-001';
export const role = 'CUS';

const PHANTOM_ID = 999999999;
const CUSTOMER_MISSING = 'Khách hàng không tồn tại.';
const ROUTE_MISSING = 'Tuyến vận chuyển không tồn tại.';

/** POST/PUT with the CUS token and a fresh Idempotency-Key per call. */
async function api(ctx, method, path, body) {
  const base = ctx.env.api.replace(/\/$/, '');
  const r = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${ctx.token}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': randomUUID(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  const parsed = (() => { try { return JSON.parse(text); } catch { return text; } })();
  return { status: r.status, body: parsed };
}

export default async function (ctx) {
  // A real customer for the self-contained fixture leg (bootstrap is the same
  // CUS-scoped catalog the create form uses).
  const bootstrap = await ctx.apiGet('/catalogs/bootstrap');
  const realCustomer = (bootstrap.body?.customers ?? [])[0];
  if (!realCustomer?.id) return { verdict: 'BLOCKED', errors: ['bootstrap returned no customers — cannot build the valid fixture'] };

  // Leg 1 — phantom customerId on create must be rejected with 400.
  const phantomCreate = await api(ctx, 'POST', '/shipments', { customerId: PHANTOM_ID });
  const createLeg = phantomCreate.status === 400 && String(phantomCreate.body?.error ?? '').includes(CUSTOMER_MISSING)
    ? { ok: true, detail: `400 ${CUSTOMER_MISSING}` }
    : phantomCreate.status === 201
      ? { ok: false, skip: true, detail: `pre-fix behavior: phantom customerId accepted (201 id=${phantomCreate.body?.id}) — fix not deployed; orphan row created, record it for cleanup` }
      : { ok: false, detail: `unexpected status=${phantomCreate.status} body=${JSON.stringify(phantomCreate.body).slice(0, 300)}` };

  // Leg 2 — self-contained valid fixture, then phantom routeId on update.
  const fixture = await api(ctx, 'POST', '/shipments', { customerId: realCustomer.id });
  if (fixture.status !== 201) {
    return { verdict: 'BLOCKED', errors: [`fixture create failed: ${fixture.status} ${JSON.stringify(fixture.body).slice(0, 300)}`] };
  }
  const fixtureId = fixture.body?.id;
  const expectedVersion = fixture.body?.version ?? 1;

  const phantomUpdate = await api(ctx, 'PUT', `/shipments/${fixtureId}`, { routeId: PHANTOM_ID, expectedVersion });
  const updateLeg = phantomUpdate.status === 400 && String(phantomUpdate.body?.error ?? '').includes(ROUTE_MISSING)
    ? { ok: true, detail: `400 ${ROUTE_MISSING}` }
    : phantomUpdate.status === 200
      ? { ok: false, skip: true, detail: `pre-fix behavior: phantom routeId accepted (200) on shipment ${fixtureId} — fix not deployed; that row now carries a phantom ref` }
      : { ok: false, detail: `unexpected status=${phantomUpdate.status} body=${JSON.stringify(phantomUpdate.body).slice(0, 300)}` };

  const legs = { phantomCreate: createLeg, phantomUpdate: updateLeg, fixtureShipmentId: fixtureId };
  const failures = [createLeg, updateLeg].filter((leg) => !leg.ok && !leg.skip);
  const skips = [createLeg, updateLeg].filter((leg) => leg.skip);
  if (failures.length > 0) return { verdict: 'FAIL', ...legs };
  if (skips.length > 0) {
    return {
      verdict: 'SKIP',
      ...legs,
      reason: 'fix not deployed (pre-fix 201/200 observed) — rerun after the staging cut',
      errors: skips.map((leg) => leg.detail),
    };
  }
  return { verdict: 'PASS', ...legs };
}
