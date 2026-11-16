// Find the driver behind R3P-677-R (truck 15H-104.03) — read-only admin GETs.
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
  // 1) users with DRIVER role
  for (const p of ['/users?role=DRIVER', '/users?search=15H-104', '/users']) {
    const { s, b } = await get(admin, p);
    const arr = b?.items ?? b?.data ?? b ?? [];
    const drivers = Array.isArray(arr) ? arr.filter(u => (u.role ?? '').includes('DRIV') || /15H-104/.test(JSON.stringify(u))) : [];
    log('USERS', p, 'status', s, 'total', Array.isArray(arr) ? arr.length : '?', 'drivers:', drivers.map(u => ({ id: u.id, username: u.username, name: u.name ?? u.fullName, role: u.role, truck: u.licensePlate ?? u.assignedTruck ?? u.truckId })).slice(0, 30));
    if (drivers.length) break;
  }
  // 2) trips search for the R3P-677-R shipment (806) / blNumber
  for (const p of ['/trips?search=R3P-677', '/trips?shipmentId=806', '/shipments/806']) {
    const { s, b } = await get(admin, p);
    log('TRIPS', p, 'status', s, JSON.stringify(b).slice(0, 1500));
  }
  writeFileSync('/Volumes/LexarSSD/projects/silversea/qa/2026-11-16_staging-driver-probe.log', out.join('\n') + '\n');
})();
