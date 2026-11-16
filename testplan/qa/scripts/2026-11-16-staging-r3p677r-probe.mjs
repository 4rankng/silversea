// R3P-677-R deep probe — trip containers, driver identity, board card. Read-only.
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
  const t = await get(admin, '/trips?search=R3P-677');
  const items = t.b?.items ?? [];
  log('TRIPS search R3P-677 count:', items.length, items.map(x => ({ id: x.id, code: x.tripCode, ref: x.customerReference, truckId: x.truckId, driverId: x.driverId, conts: x.containerCount, pair: x.activeTripPairId, pairKind: x.activeTripPairKind ?? x.pairKind, status: x.status })));
  for (const it of items) {
    const d = await get(admin, `/trips/${it.id}`);
    const b = d.b ?? {};
    log(`TRIP ${it.id} detail keys:`, Object.keys(b));
    log(`TRIP ${it.id}`, {
      containers: b.containers ?? b.tripContainers ?? b.containerList,
      driver: b.driver ?? b.driverName ?? b.assignedDriver,
      truck: b.truck ?? b.licensePlate,
      pair: b.activeTripPairId, kind: b.pairKind ?? b.activeTripPairKind,
      classification: b.classification, isCombined: b.isCombined,
    });
  }
  const cat = await get(admin, '/catalogs/bootstrap');
  const drivers = cat.b?.drivers ?? cat.b?.data?.drivers ?? [];
  log('BOOTSTRAP drivers:', drivers.map(d => ({ id: d.id, name: d.name, truck: d.assignedTruckId, user: d.username ?? d.userId ?? d.accountId })));
  const trucks = cat.b?.trucks ?? [];
  log('truck 37:', trucks.find(t2 => t2.id === 37));
  // journey board: try likely driver usernames
  for (const who of ['btdung']) {
    try {
      const s = await login(who);
      const board = await get(s, '/driver/me/journey-board');
      const arr = board.b?.cards ?? board.b?.items ?? [];
      log(`board ${who} (${s.user?.role}):`, arr.length, 'cards; R3P:', arr.filter(c => /R3P-677/.test(JSON.stringify(c))).map(c => ({ bl: c.blNumber, trip: c.tripId, cls: c.classification, linked: c.linked, pairKind: c.pairKind, conts: (c.containers ?? []).map(x => x.containerNumber) })));
    } catch (e) { log(`board ${who}: ERR ${e.message}`); }
  }
  writeFileSync('/Volumes/LexarSSD/projects/silversea/qa/2026-11-16_staging-r3p677r-probe.log', out.join('\n') + '\n');
})();
