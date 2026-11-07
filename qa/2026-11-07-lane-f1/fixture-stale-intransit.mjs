// SIL-688 stale-IN_TRANSIT fixture: lot F's only trip was canceled via the API
// (the shipment rewound), so the fixture pins the status field back to
// IN_TRANSIT — the stale row shape the owner's ruling describes — and then the
// delete law must pass for ADMIN and CUS purely on the live-trip gate.
// Fixture scope: the lane's own throwaway lot (booking_ref F1-688-F-…).
import { writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';

const API = 'http://localhost:3010/api';
const LOT = Number(process.argv[2]);
const lines = [];
const say = (s) => { console.log(s); lines.push(s); };

const login = async (identifier) => (await (await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier, password: 'Abc123' }),
})).json()).token;
const admin = await login('admin');
const cus = await login('tiepvv');
const api = (tok, method, p, body) => fetch(`${API}${p}`, {
  method,
  headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
  body: body === undefined ? undefined : JSON.stringify(body),
}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

const detail = await api(admin, 'GET', `/shipments/${LOT}`);
const version = detail.body?.shipment?.version;
say(`before fixture: status=${detail.body?.shipment?.status} version=${version}`);

// FIXTURE SQL — QA throwaway row only (id from argv, booking_ref asserted).
const ref = detail.body?.shipment?.bookingRef ?? '';
if (!ref.startsWith('F1-688-F-')) { say('REFUSE: not a lane throwaway lot'); process.exit(1); }
execSync(`docker exec ss-prod-db psql -U postgres -d silversea -c "update shipments set status='IN_TRANSIT' where id=${LOT} and booking_ref like 'F1-688-F-%'"`);
say('fixture: status pinned to IN_TRANSIT (stale row, no live trips)');

const delAdmin = await api(admin, 'DELETE', `/shipments/cus-workspace/${LOT}`, { version: await (async () => (await api(admin, 'GET', `/shipments/${LOT}`)).body?.shipment?.version)(), reason: 'QA F1-688 stale IN_TRANSIT delete (admin)' });
say(`admin delete → ${delAdmin.status} ${JSON.stringify(delAdmin.body).slice(0, 160)}`);

const fresh = await api(admin, 'GET', `/shipments/${LOT}`);
say(`after admin delete: deletedAt=${fresh.body?.shipment?.deletedAt ?? '(gone)'}`);
writeFileSync(new URL('./fixture-stale-intransit.log', import.meta.url), lines.join('\n') + '\n');
