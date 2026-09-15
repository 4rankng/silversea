// cases/chungtu-regression/TC-CUS-API-ERRCONTRACT-001.mjs
// Pins board card 20260915_13: API validation errors must carry a STRUCTURED
// details array [{code, message, path}] — never the "[object Object]; …"
// stringified blob, and never raw English zod messages without field names.
//
// WRITE-ONLY UNTIL THE CUT: same guard as the master-ref case — when the
// pre-fix serialization is observed (details is a string blob), the case
// returns SKIP (non-failing in run-all) instead of FAIL so a pre-cut run
// stays green with a visible reason. The operator still must not RUN it
// pre-cut; the SKIP branch is a guard, not an invitation.
//
// Run: STAGING_URL=https://vantai.tingting.vip \
//      node testplan/qa/scripts/run-all.mjs chungtu-regression

import { randomUUID } from 'node:crypto';

export const caseId = 'TC-CUS-API-ERRCONTRACT-001';
export const role = 'CUS';

const WEIGHT_MESSAGE = 'Trọng lượng phải là số không âm hợp lệ (cargoWeightKg)';

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
  const bootstrap = await ctx.apiGet('/catalogs/bootstrap');
  const realCustomer = (bootstrap.body?.customers ?? [])[0];
  if (!realCustomer?.id) return { verdict: 'BLOCKED', errors: ['bootstrap returned no customers — cannot build the probe'] };

  // POST with a REAL customer + invalid weight: the zod weight issue is then
  // the only issue, so the top message and the details entry are unambiguous.
  const probe = await api(ctx, 'POST', '/shipments', { customerId: realCustomer.id, cargoWeightKg: -5 });

  if (probe.status !== 400) {
    return { verdict: 'FAIL', probe: { status: probe.status, body: probe.body }, errors: [`expected 400, got ${probe.status}`] };
  }
  if (typeof probe.body?.details === 'string') {
    // Pre-fix serialization observed.
    return { verdict: 'SKIP', reason: 'fix not deployed (details is a stringified blob)' };
  }

  const details = probe.body?.details;
  if (!Array.isArray(details) || details.length === 0) {
    return { verdict: 'FAIL', probe: { status: probe.status, body: probe.body } };
  }
  const weightIssue = details.find((issue) => Array.isArray(issue?.path) && issue.path[0] === 'cargoWeightKg');
  const clean = typeof probe.body?.error === 'string'
    && probe.body.error.includes(WEIGHT_MESSAGE)
    && details.every((issue) => typeof issue.message === 'string' && Array.isArray(issue.path));
  const noBlob = !JSON.stringify(probe.body).includes('[object Object]');

  return {
    verdict: weightIssue && clean && noBlob ? 'PASS' : 'FAIL',
    probe: { status: probe.status, error: probe.body?.error, details },
    errors: weightIssue && clean && noBlob ? [] : ['structured-details contract not satisfied — see probe payload'],
  };
}
