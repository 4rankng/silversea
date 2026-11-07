// Cancel one trip by id (admin, local stack). Usage: node cancel-trip.mjs <tripId> [reason]
import crypto from 'node:crypto';

const API = process.env.API_URL || 'http://localhost:3010/api';
const tripId = Number(process.argv[2]);
const reason = process.argv[3] || 'QA F1 cleanup — release driver rig claim';
if (!Number.isInteger(tripId)) { console.error('usage: node cancel-trip.mjs <tripId>'); process.exit(1); }
const login = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }),
});
const { token } = await login.json();
const r = await fetch(`${API}/trips/${tripId}/cancel`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
  body: JSON.stringify({ reason }),
});
console.log(`cancel trip ${tripId} → ${r.status} ${JSON.stringify(await r.json()).slice(0, 200)}`);
