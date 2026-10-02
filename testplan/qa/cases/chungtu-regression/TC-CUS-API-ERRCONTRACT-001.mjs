// cases/chungtu-regression/TC-CUS-API-ERRCONTRACT-001.mjs
// Pins the SHIPPED validation-error contract (mirrors
// backend/src/tests/validation-error-contract.test.ts, which pins the same
// strings server-side):
//   • `error` is the issue SENTENCE a user reads in a banner — the field name
//     never rides along (2026-09-18 leak report). The old expectation here was
//     "… hợp lệ (cargoWeightKg)", which the product deliberately does NOT ship.
//   • `details` is a non-empty structured array; every entry carries a string
//     `message` + array `path`, and the cargoWeightKg issue is present by path.
//   • the serialized body never contains an "[object Object]" blob.
// A stringified `details` is a REGRESSION, not a pre-cut skip: the fix shipped,
// so the case reports FAIL rather than hiding behind SKIP.
//
// Run: STAGING_URL=https://vantai.tingting.vip \
//      node testplan/qa/scripts/run-all.mjs chungtu-regression

import { randomUUID } from 'node:crypto';

export const caseId = 'TC-CUS-API-ERRCONTRACT-001';
export const role = 'CUS';

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
  if (!realCustomer?.id) return { verdict: 'BLOCKED', errors: [`[${ctx.env.env}] bootstrap returned no customers — cannot build the probe`] };

  // POST with a REAL customer + invalid weight: the zod weight issue is then
  // the only issue, so the top message and the details entry are unambiguous.
  const probe = await api(ctx, 'POST', '/shipments', { customerId: realCustomer.id, cargoWeightKg: -5 });

  // Shipped top-level message (see validation-error-contract.test.ts:37) — the
  // issue sentence with NO field name appended.
  const SHIPPED_WEIGHT_MESSAGE = 'Trọng lượng phải là số không âm hợp lệ';
  const envTag = `[${ctx.env.env}]`;
  if (probe.status !== 400) {
    return { verdict: 'FAIL', probe: { status: probe.status, body: probe.body }, errors: [`${envTag} expected 400, got ${probe.status}`] };
  }
  if (typeof probe.body?.details === 'string') {
    // Pre-fix serialization — the regression this case exists to catch.
    return { verdict: 'FAIL', probe: { status: probe.status, body: probe.body }, errors: [`${envTag} details is a stringified blob: ${probe.body.details.slice(0, 120)}`] };
  }

  const details = probe.body?.details;
  if (!Array.isArray(details) || details.length === 0) {
    return { verdict: 'FAIL', probe: { status: probe.status, body: probe.body }, errors: [`${envTag} details must be a non-empty structured array, got: ${JSON.stringify(details)}`] };
  }
  const weightIssue = details.find((issue) => Array.isArray(issue?.path) && issue.path[0] === 'cargoWeightKg');
  if (!weightIssue) {
    return { verdict: 'FAIL', probe: { status: probe.status, body: probe.body }, errors: [`${envTag} no details entry carries path ['cargoWeightKg']`] };
  }
  // Field locations live in `details` alone; the sentence a user reads must
  // stay free of them, and must be the issue's own message.
  const top = probe.body?.error;
  const errors = [];
  if (typeof top !== 'string' || top.trim().length === 0) {
    errors.push(`${envTag} top-level error is not a message string: ${JSON.stringify(top)}`);
  } else {
    if (top.includes('cargoWeightKg')) {
      errors.push(`${envTag} top-level error leaks the field name: "${top}"`);
    }
    if (top !== weightIssue.message) {
      errors.push(`${envTag} top-level error "${top}" ≠ the cargoWeightKg issue message "${weightIssue.message}"`);
    }
  }
  if (!details.every((issue) => typeof issue?.message === 'string' && Array.isArray(issue.path))) {
    errors.push(`${envTag} every details entry must carry a string message + array path: ${JSON.stringify(details)}`);
  }
  if (typeof weightIssue.message !== 'string' || weightIssue.message !== SHIPPED_WEIGHT_MESSAGE) {
    errors.push(`${envTag} cargoWeightKg issue message drifted from the shipped string: "${weightIssue.message}"`);
  }
  const noBlob = !JSON.stringify(probe.body).includes('[object Object]');
  if (!noBlob) {
    errors.push(`${envTag} body contains a stringified-object blob`);
  }

  return {
    verdict: errors.length === 0 ? 'PASS' : 'FAIL',
    probe: { status: probe.status, error: probe.body?.error, details },
    errors,
  };
}

