// SIL-669 fixtures — two fresh FCL lots on the LOCAL dev stack (this lane's
// backend :3003, DB ss-prod-db :5441 — dev only):
//   lot "branch" — quick-created, then its auto fulfillment canceled in the dev
//                  DB so the grid lists the container as a fulfillment-less
//                  branch row (the SIL-667 repro surface, row class R3E-667-B).
//   lot "owned"  — quick-created, fulfillment left active (plain inline-edit row).
// Usage: QA_API=http://localhost:3003/api node qa/2026-11-03-sil669/fixture.mjs
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const API = process.env.QA_API || 'http://localhost:3003/api';
const OUT = path.resolve('qa/2026-11-03-sil669');
fs.mkdirSync(OUT, { recursive: true });

const LETTER_VAL = {};
let v = 10;
for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') { if (v % 11 === 0) v++; LETTER_VAL[ch] = v; v++; }
const checkDigit = (s) => {
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const c = s[i];
    sum += (/[A-Z]/.test(c) ? LETTER_VAL[c] : Number(c)) * 2 ** i;
  }
  const r = sum % 11;
  return r === 10 ? 0 : r;
};
const validCont = (prefix) => {
  const base = `${prefix}${Math.floor(100000 + Math.random() * 899999)}`;
  return base + checkDigit(base);
};

const login = async (identifier, password = 'Abc123') => {
  const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password }) });
  if (!res.ok) throw new Error(`login ${identifier} -> ${res.status}`);
  return (await res.json()).token;
};
const authed = (token) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });
const log = (step, obj) => console.log(JSON.stringify({ at: new Date().toISOString(), step, ...obj }));

const cus = await login('cus');
const dieuvan = await login('dungnv');

const createLot = async (bl, cont, appt) => {
  const res = await fetch(`${API}/shipments/quick`, {
    method: 'POST',
    headers: { ...authed(cus), 'Idempotency-Key': `sil669-fix-${bl}` },
    body: JSON.stringify({
      customerId: 1, tradeDirection: 'IMPORT', blNumber: bl, cargoMode: 'FCL',
      containers: [{ containerTypeId: 1, containerNumber: cont, cargoWeightKg: 8000, customerAppointmentAt: appt, routeId: 6, pickupPortId: 1, dropoffPortId: 2 }],
    }),
  });
  const body = await res.text();
  log('create', { bl, status: res.status });
  if (!res.ok && !/tồn tại|existing|duplicate/i.test(body)) throw new Error(`create ${bl}: ${body.slice(0, 200)}`);
  return JSON.parse(body);
};

const rowsFor = async (cont) => {
  const rows = await fetch(`${API}/shipments/dispatch-detail-plan-rows?limit=50&q=${cont.slice(0, 8)}`, { headers: authed(dieuvan) }).then((r) => r.json());
  return (rows.items ?? []).find((i) => i.container?.containerNumber === cont) ?? null;
};

const stamp = Date.now().toString(36).toUpperCase().slice(-5);
const LOTS = [
  { key: 'branchA', bl: `SIL669A-${stamp}`, prefix: 'SICV', appt: '2026-12-25T09:00:00.000Z' },
  { key: 'owned', bl: `SIL669B-${stamp}`, prefix: 'SIDU', appt: '2026-12-26T09:00:00.000Z' },
  { key: 'branchB', bl: `SIL669C-${stamp}`, prefix: 'SIFW', appt: '2026-12-27T09:00:00.000Z' },
];

const state = { lots: [], evidenceDir: OUT, api: API };
for (const lot of LOTS) {
  const cont = validCont(lot.prefix);
  const shipment = await createLot(lot.bl, cont, lot.appt);
  let row = await rowsFor(cont);
  if (!row) throw new Error(`no plan row for ${cont}`);
  if (lot.key.startsWith('branch')) {
    const sql = `UPDATE shipment_fulfillments SET canceled_at = now() WHERE shipment_id = ${shipment.id} AND canceled_at IS NULL`;
    const out = execSync(`docker exec ss-prod-db psql -U postgres -d silversea -c "${sql}"`, { encoding: 'utf8' });
    log('cancel_fulfillments', { shipmentId: shipment.id, psql: out.trim().replace(/\n/g, ' | ') });
    row = await rowsFor(cont);
    if (!row || row.fulfillmentId != null) throw new Error(`branch state not reached for ${cont}: ${JSON.stringify(row)?.slice(0, 200)}`);
  }
  state.lots.push({
    key: lot.key, bl: lot.bl, cont, shipmentId: shipment.id,
    fulfillmentId: row.fulfillmentId, shipmentContainerId: row.shipmentContainerId,
    classification: row.classification, version: row.version, shipmentVersion: row.shipmentVersion,
    taskStatus: row.taskStatus,
  });
}

fs.writeFileSync(path.join(OUT, 'state.json'), JSON.stringify(state, null, 2));
log('ready', state);
