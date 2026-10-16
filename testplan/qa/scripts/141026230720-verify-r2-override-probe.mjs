// Follow-up for 141026230720-r2: the main run's `secondConfirmedSave` probe
// never sent duplicateConfirmed (helper dropped the field), so the API-level
// CONFIRMED-OVERRIDE path was not actually exercised. This probe proves it
// properly: seed one live (TIRE_WEIGH, cont) row as hoangnh → hungld POSTs the
// SAME pair WITH duplicateConfirmed:true → expect 201 → both rows voided.
import { appendFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const API = 'https://vantai.tingting.vip/api';
const TAG = '141026230720-r2-override';
const NOTE = `QA ${TAG} — API confirmed-override probe, xóa ngay sau kiểm tra`;
const log = (s, o) => { appendFileSync(`qa/2026-10-16_141026230720-r2_override-driver.log`, JSON.stringify({ at: new Date().toISOString(), step: s, ...o }) + '\n'); console.log(s, JSON.stringify(o ?? {})); };
const vnDate = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);

async function login(identifier) {
  const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password: 'Abc123' }) });
  const body = await res.json();
  if (!body.token) throw new Error(`no token for ${identifier}`);
  return { Authorization: `Bearer ${body.token}`, 'Content-Type': 'application/json' };
}
const me = await login('hoangnh');
const other = await login('hungld');

// same target pair as the main run (lot 175 / cont 145 — verified live today)
const LOT = 175, CONT = 145, TYPE = 'TIRE_WEIGH';
const post = (auth, extra = {}, amount = '160000') => fetch(`${API}/ops/expenses`, {
  method: 'POST',
  headers: { ...auth, 'Idempotency-Key': randomUUID() },
  body: JSON.stringify({ shipmentId: LOT, shipmentContainerId: CONT, expenseTypeCode: TYPE, amount, paidAt: vnDate(), note: NOTE, ...extra }),
}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

const seed = await post(me, {}, '140000');
log('seed-live-row', { status: seed.status, id: seed.body?.id ?? null });
if (seed.status !== 201) { writeFileSync(`qa/2026-10-16_141026230720-r2_override-summary.json`, JSON.stringify({ verdict: 'BLOCKED', seed }, null, 2)); process.exit(1); }

const noConfirm = await post(other, {}, '170000');
log('override-absent', { status: noConfirm.status, code: noConfirm.body?.code ?? null, note: 'expect 409 — same pair, no duplicateConfirmed' });
const withConfirm = await post(other, { duplicateConfirmed: true }, '170000');
log('override-present', { status: withConfirm.status, id: withConfirm.body?.id ?? null, note: 'expect 201 — explicit duplicateConfirmed override saves' });

writeFileSync(`qa/2026-10-16_141026230720-r2_override-summary.json`, JSON.stringify({
  probe: 'API-level duplicateConfirmed override (card 141026230720)',
  pair: { shipmentId: LOT, shipmentContainerId: CONT, expenseTypeCode: TYPE },
  seed: { status: seed.status, id: seed.body?.id },
  noConfirm: { status: noConfirm.status, code: noConfirm.body?.code ?? null, error: noConfirm.body?.error ?? null },
  withConfirm: { status: withConfirm.status, id: withConfirm.body?.id ?? null },
  verdict: noConfirm.status === 409 && withConfirm.status === 201 ? 'PASS' : 'FAIL',
}, null, 2));

// cleanup — each author voids its own row
for (const [auth, id, by] of [[me, seed.body?.id, 'hoangnh'], [other, withConfirm.body?.id, 'hungld']]) {
  if (!id) continue;
  const del = await fetch(`${API}/ops/expenses/${id}`, { method: 'DELETE', headers: { ...auth, 'Idempotency-Key': randomUUID() }, body: JSON.stringify({ reason: `QA ${TAG} — probe fixture` }) });
  log('cleanup-void', { id, by, status: del.status });
}
