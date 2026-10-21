// dis-03 fixture — two 1-container lots mirroring QA R30's cross-lot kẹp shape.
// Lot A issues as Đơn (SINGLE); lot B is marked Kẹp (DOUBLE) and tries to issue
// onto the same tractor. Usage:
//   node testplan/qa/scripts/2026-10-21-dis-r30-dis03-fixture.mjs [--reset]
import fs from 'node:fs';
import path from 'node:path';

const API = process.env.QA_API || 'http://localhost:3002/api';
const OUT = path.resolve('qa/2026-10-21-dis-r30');
fs.mkdirSync(OUT, { recursive: true });
const BL_A = 'DIS30-K1';
const BL_B = 'DIS30-K2';
const CONT_A = 'DSAK1234566';
const CONT_B = 'DSBK2345670';
const APPT = '2026-10-24T01:00:00.000Z'; // tomorrow — inside the default month window

const login = async (identifier, password = 'Abc123') => {
  const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password }) });
  if (!res.ok) throw new Error(`login ${identifier} -> ${res.status}`);
  return (await res.json()).token;
};
const cus = await login('cus');
const dieuvan = await login('dieuvan');
const authed = (token) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

const findLots = async () => {
  const res = await fetch(`${API}/shipments?q=${BL_A.slice(0, 8)}&limit=50`, { headers: authed(dieuvan) });
  const body = await res.json();
  const items = (body.items ?? []).filter((i) => [BL_A, BL_B].includes(i.blNumber) || [BL_A, BL_B].includes(i.bookingRef));
  return items;
};

const log = (step, obj) => console.log(JSON.stringify({ at: new Date().toISOString(), step, ...obj }));

let lots = await findLots();
log('precheck', { found: lots.length });

const mkLot = async (bl, contNumber) => {
  const res = await fetch(`${API}/shipments/quick`, {
    method: 'POST',
    headers: { ...authed(cus), 'Idempotency-Key': `dis30-fix-${bl}` },
    body: JSON.stringify({
      customerId: 1,
      tradeDirection: 'IMPORT',
      blNumber: bl,
      cargoMode: 'FCL',
      containers: [{
        containerTypeId: 1,
        containerNumber: contNumber,
        cargoWeightKg: 10000,
        customerAppointmentAt: APPT,
      }],
    }),
  });
  const body = await res.text();
  log('create_lot', { bl, status: res.status, body: body.slice(0, 200) });
  if (!res.ok) throw new Error(`create ${bl} -> ${res.status}`);
  return JSON.parse(body);
};

if (lots.length < 2) {
  const a = await mkLot(BL_A, CONT_A);
  const b = await mkLot(BL_B, CONT_B);
  lots = [a, b];
} else {
  log('reuse_existing_lots');
}

// fresh row state via the detail-plan read
const rows = await fetch(`${API}/shipments/dispatch-detail-plan-rows?limit=50&q=DIS30K`, { headers: authed(dieuvan) })
  .then((r) => r.json())
  .then((b) => (b.items ?? []).map((i) => ({
    ship: i.shipmentId, ful: i.fulfillmentId, cont: i.container?.containerNumber, cls: i.classification,
    plate: i.dispatch?.assignedPlate, status: i.taskStatus, trip: i.dispatch?.tripId, fver: i.version, sver: i.shipmentVersion,
  })));
log('rows', rows);
fs.writeFileSync(path.join(OUT, 'dis03-fixture-state.json'), JSON.stringify({ lots, rows }, null, 2));
console.log('fixture ready');
