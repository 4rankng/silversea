// W4b cleanup — soft-delete the QA shipment fixtures via the in-app admin API
// with the required optimistic-lock version, then census: visible QA-W4B
// shipments must be 0.
import fs from 'node:fs';
const API = 'https://vantai.tingting.vip/api';
const LOG = 'qa/2026-10-16_w4b-cleanup.log';
const log = (l) => { console.log(l); fs.appendFileSync(LOG, l + '\n'); };
async function login(id) {
  const r = await fetch(API + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: id, password: 'Abc123' }) });
  return r.ok ? (await r.json()).token : null;
}
const admin = await login('admin');
if (!admin) { log('ABORT: no admin'); process.exit(2); }
const ids = [613, 614, 615, 616, 617];
for (const id of ids) {
  const s = (await fetch(`${API}/shipments/${id}`, { headers: { Authorization: `Bearer ${admin}` } }).then((r) => r.json()).catch(() => null))?.shipment;
  if (!s?.id) { log(`GET /shipments/${id} failed`); continue; }
  const res = await fetch(`${API}/shipments/${id}?version=${s.version}`, { method: 'DELETE', headers: { Authorization: `Bearer ${admin}`, 'Idempotency-Key': crypto.randomUUID() } });
  const body = await res.json().catch(() => ({}));
  log(`DELETE /shipments/${id} v${s.version} -> ${res.status} ${JSON.stringify(body).slice(0, 120)}`);
}
const census = await fetch(`${API}/shipments?q=QA-W4B&limit=50`, { headers: { Authorization: `Bearer ${admin}` } }).then((r) => r.json());
const items = census.items || census || [];
log(`CENSUS shipments q=QA-W4B -> visible=${items.length}`);
log(`remaining=${JSON.stringify(items.map((s) => ({ id: s.id, ref: s.bookingRef || s.blNumber })))}`);
log('DONE');
