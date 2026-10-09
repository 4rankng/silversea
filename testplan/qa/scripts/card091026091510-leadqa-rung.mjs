// Card 091026091510 — lead staging QA. Acceptance = unstick the very lot the
// reporter wedged: TEST-LCL-362 must accept a save that CLEARS its schedule
// (back to 'Chưa chốt ngày' / PENDING_DATE), with a fresh expectedVersion.
// Control: a ready lot WITH a live trip must still 409 on clearing.
import { writeFileSync } from 'node:fs';

const API = 'https://vantai.tingting.vip/api';
const EXPECT = '45993f90';
const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
let exitCode = 0;

const health = await fetch(`${API}/health`).then((r) => r.json());
log('health', { buildHash: health.buildHash, expect: EXPECT });
if (!String(health.buildHash || '').startsWith(EXPECT)) { log('build-currency-FAIL'); process.exit(2); }

const login = async (id) => (await (await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: id, password: 'Abc123' }) })).json()).token;
const tok = await login('dungnv');
if (!tok) { log('login-FAIL'); process.exit(2); }
const H = { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' };

// 1) the reporter's own lot (verified by DB census: id 323, currently PENDING_DATE v6)
const LOT = 323;
const before = await fetch(`${API}/shipments/${LOT}`, { headers: H }).then((r) => r.json());
log('before', { id: before.shipment?.id ?? before.id, code: before.shipment?.shipmentCode ?? before.shipmentCode, status: before.shipment?.status ?? before.status, version: before.shipment?.version ?? before.version, closingAt: before.shipment?.closingAt ?? null, plannedReturnAt: before.shipment?.plannedReturnAt ?? null });
const version = before.shipment?.version ?? before.version;

const put = (v, body) => fetch(`${API}/shipments/${LOT}`, {
  method: 'PUT', headers: { ...H, 'Idempotency-Key': `leadqa-091510-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` },
  body: JSON.stringify({ expectedVersion: v, ...body }),
});

// 2) SET the schedule (the reporter's flow) — expect 200 + READY_FOR_DISPATCH
const setDate = '2026-10-10T01:00:00.000Z'; // 08:00 +08 = reporter's value
const set = await put(version, { expectedDeliveryDate: '2026-10-10', plannedReturnAt: setDate });
const setBody = await set.json().catch(() => ({}));
const afterSet = await fetch(`${API}/shipments/${LOT}`, { headers: H }).then((r) => r.json());
log('set-schedule', { status: set.status, statusAfter: afterSet.shipment?.status ?? afterSet.status, versionAfter: afterSet.shipment?.version ?? afterSet.version, plannedReturnAt: afterSet.shipment?.plannedReturnAt ?? null });

// 3) CLEAR with the FRESH version — expect 200 + back to PENDING_DATE (the card's AC)
const v2 = afterSet.shipment?.version ?? afterSet.version;
const clear = await put(v2, { expectedDeliveryDate: null, closingAt: null, plannedReturnAt: null });
const after = await fetch(`${API}/shipments/${LOT}`, { headers: H }).then((r) => r.json());
const fin = after.shipment ?? after;
log('clear-schedule', { status: clear.status, finalStatus: fin.status, version: fin.version, plannedReturnAt: fin.plannedReturnAt, closingAt: fin.closingAt, expectedDeliveryDate: fin.expectedDeliveryDate });

const setOk = set.status === 200 && (afterSet.shipment?.status ?? afterSet.status) === 'READY_FOR_DISPATCH';
const clearOk = clear.status === 200 && fin.status === 'PENDING_DATE' && !fin.plannedReturnAt && !fin.closingAt && !fin.expectedDeliveryDate;
if (setOk && clearOk) log('PASS-unstick-cycle', { lot: 323, note: 'set→READY then clear→PENDING_DATE; lot restored to its pre-rung state' });
else { log('FAIL', { setOk, clearOk }); exitCode = 1; }

writeFileSync('/Volumes/LexarSSD/projects/silversea-prod/qa/2026-10-09_card091026091510-unstick_ui-driver.log', LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
process.exit(exitCode);
