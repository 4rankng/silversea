// Ticket 201026090100 (card 181026185900 verify-fail): does the HEAD backend
// inherit Tuyến/Nâng/Hạ when the drawer adds a container with only a number?
// API probe (no UI): login → find an FCL lot with populated container
// route/lift/drop → POST /containers with ONLY containerNumber → read back
// the new line → report inherit PASS/FAIL → remove the probe row (cleanup).
const API = process.env.API || 'http://localhost:3002/api';
const PROBE_NUMBER = 'CSQU3054383'; // standard valid ISO 6346 example number

import httpModule from 'node:http';

const http = (method, path, { body, token } = {}) => new Promise((resolve, reject) => {
  const r = httpModule.request(`${API}${path}`.replace(/^\/api\/api/, '/api'), {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(method === 'POST' ? { 'idempotency-key': crypto.randomUUID() } : {}),
    },
  }, (res) => {
    let b = '';
    res.on('data', (c) => (b += c));
    res.on('end', () => { let j = b; try { j = JSON.parse(b); } catch {} resolve({ status: res.statusCode, body: j }); });
  });
  r.on('error', reject);
  if (body) r.write(JSON.stringify(body));
  r.end();
});

async function main() {
  const login = await http('POST', '/auth/login', { body: { identifier: 'admin', password: 'Abc123' } });
  if (login.status !== 200) throw new Error(`login -> ${login.status}`);
  const token = login.body.token;
  const authed = (method, path, body) => http(method, path, { body, token });

  let picked = null;
  if (process.env.LOT) {
    const d = await authed('GET', `/shipments/cus-workspace/${process.env.LOT}`);
    if (d.status !== 200) throw new Error(`detail ${process.env.LOT} -> ${d.status}`);
    const cs = d.body.containers ?? [];
    if (cs.length < 1 || d.body.summary.cargoMode === 'LCL') throw new Error('lot is LCL or has no containers');
    picked = { id: Number(process.env.LOT), version: d.body.summary.version, ref: cs[0] };
  } else {
    const list = await authed('GET', '/shipments/cus-workspace?page=1&limit=200');
    if (list.status !== 200) throw new Error(`list -> ${list.status}`);
    const rows = (list.body.items ?? list.body.data ?? []);
    for (const row of rows) {
      if ((row.containerCount ?? row.containersCount ?? 0) < 1) continue;
      const d = await authed('GET', `/shipments/cus-workspace/${row.id}`);
      if (d.status !== 200) continue;
      const cs = d.body.containers ?? [];
      if (cs.length < 1 || (d.body.summary?.cargoMode ?? row.cargoMode) === 'LCL') continue;
      const ref = cs[0];
      const filled = ['routeName', 'liftSite', 'dropoffSite'].filter((k) => ref[k] != null && ref[k] !== '').length;
      if (filled >= 2) { picked = { id: row.id, version: d.body.summary.version, ref }; break; }
    }
  }
  if (!picked) { console.log(JSON.stringify({ verdict: 'NO_CANDIDATE', note: 'no FCL lot with populated route/lift/drop found' })); return; }

  console.log(`lot ${picked.id} ref container routeName=${JSON.stringify(picked.ref.routeName)} liftSite=${JSON.stringify(picked.ref.liftSite)} dropoffSite=${JSON.stringify(picked.ref.dropoffSite)}`);

  const add = await authed('POST', `/shipments/cus-workspace/${picked.id}/containers`, {
    expectedShipmentVersion: picked.version,
    containerNumber: PROBE_NUMBER,
  });
  if (add.status !== 200 && add.status !== 201) {
    console.log(JSON.stringify({ verdict: 'ADD_FAILED', status: add.status, body: add.body }));
    return;
  }
  try {
    const after = await authed('GET', `/shipments/cus-workspace/${picked.id}`);
    const line = (after.body.containers ?? []).find((c) => c.containerNumber === PROBE_NUMBER);
    if (!line) { console.log(JSON.stringify({ verdict: 'READBACK_MISSING' })); return; }
    const inherited = {
      routeName: line.routeName ?? null,
      liftSite: line.liftSite ?? null,
      dropoffSite: line.dropoffSite ?? null,
      rawRouteId: line.raw?.routeId ?? null,
      rawPickupPortId: line.raw?.pickupPortId ?? null,
      rawDropoffPortId: line.raw?.dropoffPortId ?? null,
    };
    const ok = ['routeName', 'liftSite', 'dropoffSite'].every((k) => line[k] != null && line[k] !== '');
    console.log(JSON.stringify({ verdict: ok ? 'INHERIT_PASS' : 'INHERIT_FAIL', newLine: inherited }, null, 2));
  } finally {
    const fresh = await authed('GET', `/shipments/cus-workspace/${picked.id}`);
    const line = (fresh.body.containers ?? []).find((c) => c.containerNumber === PROBE_NUMBER);
    if (line) {
      const del = await authed('POST', `/shipments/cus-workspace/${picked.id}/containers/${line.id}/remove`, {
        expectedShipmentVersion: fresh.body.summary.version,
      });
      console.log(`cleanup remove -> ${del.status}`);
    }
  }
}

main().catch((e) => { console.error('PROBE_ERROR', e.message); process.exit(1); });
