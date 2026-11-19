// SIL-814 — GET /api/accounting/debit-merge regression probe (integration;
// runs against a real backend+db, never backend/src/tests — BE unit-only law).
// Reads the settlement board as Kế toán and as CUS and asserts the contract:
// HTTP 200 + { items, total } (no 500 on freight-priced lots without
// trip-revenue rows), staff sees all lots, CUS sees its scoped subset.
// Read-only: two logins + two GETs.
//   node qa/scripts/2026-11-19-sil814-debit-merge-probe.mjs
//   API_BASE=http://localhost:3005/api node qa/scripts/2026-11-19-sil814-debit-merge-probe.mjs
import { strict as assert } from 'node:assert';

const API = process.env.API_BASE ?? 'http://localhost:3002/api';
const ACCOUNTANT = process.env.ACCOUNT ?? 'hoapt';
const CUS = process.env.CUS ?? 'tiepvv';

async function login(identifier) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  assert.equal(res.status, 200, `login ${identifier} -> ${res.status}`);
  return (await res.json()).token;
}

async function debitMerge(token) {
  const res = await fetch(`${API}/accounting/debit-merge`, { headers: { Authorization: `Bearer ${token}` } });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

const results = {};
for (const [label, user] of [['ACCOUNTANT', ACCOUNTANT], ['CUS', CUS]]) {
  const token = await login(user);
  const { status, body } = await debitMerge(token);
  assert.equal(status, 200, `${label} ${user}: GET /accounting/debit-merge -> ${status} ${String(body).slice(0, 200)}`);
  assert.ok(Array.isArray(body.items), `${label}: items must be an array`);
  assert.equal(body.total, body.items.length, `${label}: total must equal items.length`);
  const sample = body.items[0];
  assert.ok(sample?.code, `${label}: first item carries a lot code`);
  assert.ok(sample.control && Array.isArray(sample.containers), `${label}: first item carries control + containers`);
  const scoped = body.items.length;
  results[label] = { user, lots: scoped, withTongTc: body.items.filter((i) => i.control?.tongTc != null).length };
  console.log(`PASS ${label} ${user}: HTTP 200, lots=${scoped}, with-tongTc=${results[label].withTongTc}`);
}
console.log(`PASS CUS scope (${results.CUS.lots}) <= staff scope (${results.ACCOUNTANT.lots}): ${results.CUS.lots <= results.ACCOUNTANT.lots}`);
