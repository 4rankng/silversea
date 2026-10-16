// Scan staging drivers' trips for existing ROAD_ALLOWANCE / LIFT_DROP_ZONE
// rows (system-written) to drive the view-only rendering (CP700 system-rows
// clause). Read-only.
import fs from 'node:fs';
const API = 'https://vantai.tingting.vip/api';
const log = (l) => { console.log(l); fs.appendFileSync('qa/2026-10-16_w4b-cp700_be-probe.log', l + '\n'); };
async function login(id) {
  const r = await fetch(API + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: id, password: 'Abc123' }) });
  return r.ok ? (await r.json()).token : null;
}
for (const d of ['bqhuong', 'btdung', 'vvtrung', 'tvtham']) {
  const t = await login(d);
  if (!t) { log(`scan: ${d} no login`); continue; }
  const trips = await fetch(API + '/driver/me/trips', { headers: { Authorization: `Bearer ${t}` } }).then((r) => r.json()).then((j) => j.items || []).catch(() => []);
  for (const trip of trips.filter((x) => x.status !== 'CANCELED').slice(0, 10)) {
    const costs = await fetch(`${API}/driver/me/trips/${trip.id}/incidental-costs`, { headers: { Authorization: `Bearer ${t}` } }).then((r) => r.json()).then((j) => j.items || []).catch(() => []);
    const sys = costs.filter((c) => c.costType === 'ROAD_ALLOWANCE' || c.costType === 'LIFT_DROP_ZONE');
    if (sys.length) log(`SYSTEM-ROWS driver=${d} trip=${trip.id} status=${trip.status} types=${sys.map((s) => s.costType).join('+')}`);
  }
}
log('SCAN-DONE');
