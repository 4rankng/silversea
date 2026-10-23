// Phase 3a — fixture teardown via governed API deletes (every write carries
// an Idempotency-Key). Trips first (children), then shipments. Customer and
// soft-delete classes ride the sanctioned `make qapurge` afterwards.
import { appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const DIR = 'qa/2026-10-16_161026113900_f2-override-read';
const LOG = `${DIR}/f2-api-driver.log`;
const step = (s, o) => {
  const e = { at: new Date().toISOString(), step: s, ...o };
  appendFileSync(LOG, JSON.stringify(e) + '\n');
  console.log(JSON.stringify(e));
};
const API = 'https://vantai.tingting.vip/api';
async function login(identifier) {
  const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password: 'Abc123' }) });
  const body = await res.json();
  return { auth: { Authorization: `Bearer ${body.token}` } };
}
async function api(account, method, path, body, { idem = method !== 'GET' } = {}) {
  const headers = { ...account.auth, 'Content-Type': 'application/json' };
  if (idem) headers['Idempotency-Key'] = randomUUID();
  const res = await fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let parsed; try { parsed = JSON.parse(text); } catch { parsed = text.slice(0, 300); }
  return { status: res.status, body: parsed };
}

const admin = await login('admin');
const state = JSON.parse((await import('node:fs')).readFileSync(`${DIR}/f2-state.json`, 'utf8'));
const tripIds = [state.lots.A.tripId, state.lots.B.tripId, state.lots.C.tripId, state.lotsDe.D.tripId, state.lotsDe.E.tripId];
const shipIds = [state.lots.A.id, state.lots.B.id, state.lots.C.id, state.lotsDe.D.id, state.lotsDe.E.id];

for (const id of tripIds) {
  const r = await api(admin, 'DELETE', `/trips/${id}`);
  step('trip-delete', { id, status: r.status, err: r.status >= 300 ? String(JSON.stringify(r.body)).slice(0, 200) : undefined });
}
for (const id of shipIds) {
  const r = await api(admin, 'DELETE', `/shipments/${id}`);
  step('shipment-delete', { id, status: r.status, err: r.status >= 300 ? String(JSON.stringify(r.body)).slice(0, 200) : undefined });
}
step('done-purge-api', { tripIds, shipIds });
