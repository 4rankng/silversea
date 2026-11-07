// Lane F1 cleanup — soft-deletes every throwaway F1-* lot created by the
// setup runs (their staged dispatch plans hold rig claim windows that block
// later issues). API-only, local stack. Extra argv ids after the role are
// deleted as `id:version` pairs (e.g. `node cleanup.mjs admin 779205:1`).
import crypto from 'node:crypto';

const API = process.env.API_URL || 'http://localhost:3010/api';
const explicit = process.argv.slice(3).map((pair) => pair.split(':').map(Number));
const login = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: process.argv[2] || 'admin', password: 'Abc123' }),
});
const { token } = await login.json();
const api = async (method, p, body) => fetch(`${API}${p}`, {
  method,
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
  body: body === undefined ? undefined : JSON.stringify(body),
}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

for (const [id, version] of explicit) {
  const del = await api('DELETE', `/shipments/cus-workspace/${id}`, { version, reason: 'QA F1 zombie cleanup' });
  console.log(`cleanup explicit lot ${id} → ${del.status}`);
}

for (let page = 1; page <= 40; page++) {
  const r = await api('GET', `/shipments/dispatch-detail-plan-rows?limit=50&page=${page}`);
  const items = r.body?.items ?? [];
  const mine = items.filter((row) => (row.docs?.billNumber ?? '').startsWith('F1-') && row.dispatch?.tripId == null);
  for (const row of mine) {
    const del = await api('DELETE', `/shipments/cus-workspace/${row.shipmentId}`, { version: row.shipmentVersion, reason: 'QA F1 zombie cleanup — releases staged rig claim' });
    console.log(`cleanup lot ${row.shipmentId} (${row.docs?.billNumber}) → ${del.status}`);
  }
  if (items.length < 50) break;
}
console.log('CLEANUP_DONE');
