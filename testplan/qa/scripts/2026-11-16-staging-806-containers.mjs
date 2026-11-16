// Shipment 806 (R3P-677-R) container classification labels + dispatch rows. Read-only.
import { writeFileSync } from 'node:fs';
const API = 'https://vantai.tingting.vip/api';
const out = [];
const log = (...a) => { const s = a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); out.push(s); };
async function login(identifier) {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password: 'Abc123' }) });
  const b = await r.json();
  if (!b.token) throw new Error(`login ${identifier} -> ${r.status}`);
  return { auth: { Authorization: `Bearer ${b.token}` }, user: b.user };
}
const get = (a, p) => fetch(`${API}${p}`, { headers: a.auth }).then(async r => ({ s: r.status, b: await r.json().catch(() => null) }));

(async () => {
  const admin = await login('admin');
  const d = await get(admin, '/shipments/806');
  const sh = d.b?.shipment ?? d.b ?? {};
  log('shipment 806:', { bl: sh.blNumber, isCombined: sh.isCombined, cargoMode: sh.cargoMode, status: sh.status });
  const conts = d.b?.containers ?? sh.containers ?? [];
  log('containers:', conts.map(c => ({ id: c.id, num: c.containerNumber, classification: c.classification, type: c.containerTypeName ?? c.containerType, weight: c.cargoWeightKg })));
  // dispatch-detail plan rows for this shipment (classification on fulfillment)
  const rows = await get(admin, '/shipments/dispatch-detail-plan-rows?search=R3P-677');
  const items = rows.b?.items ?? rows.b?.rows ?? [];
  log('dispatch rows status', rows.s, 'count', items.length);
  for (const r of items) log('DROW', { ful: r.fulfillmentId, trip: r.tripId, code: r.shipmentCode, bill: r.blNumber, classification: r.classification, isCombined: r.isCombined, cont: r.containerNumber, cls: r.containerClassification });
  writeFileSync('/Volumes/LexarSSD/projects/silversea/qa/2026-11-16_staging-806-containers.log', out.join('\n') + '\n');
})();
