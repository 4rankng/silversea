// dis-02/05/10 fixtures — two 1×20' lots (E: DIS30-E, F: DIS30-F), appointment
// 2026-10-25 09:00Z, pre-assigned to truck 60C-23456 (id 2, driver 2) as OWN.
// Usage: node testplan/qa/scripts/2026-10-21-dis-r30-fixtures.mjs
import fs from 'node:fs';
import path from 'node:path';

const API = process.env.QA_API || 'http://localhost:3002/api';
const OUT = path.resolve('qa/2026-10-21-dis-r30');
fs.mkdirSync(OUT, { recursive: true });
const LOTS = [
  { bl: 'DIS30-E', cont: 'DSEK3456787' },
  { bl: 'DIS30-F', cont: 'DSFK4567897' },
  { bl: 'DIS30-G', cont: 'DSGK5678902' },
];
const APPT = '2026-10-25T09:00:00.000Z';
const APPT_G = '2026-10-26T02:00:00.000Z';

const login = async (identifier, password = 'Abc123') => {
  const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password }) });
  if (!res.ok) throw new Error(`login ${identifier} -> ${res.status}`);
  return (await res.json()).token;
};
const cus = await login('cus');
const dieuvan = await login('dieuvan');
const authed = (token) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });
const log = (step, obj) => console.log(JSON.stringify({ at: new Date().toISOString(), step, ...obj }));

const state = [];
for (const { bl, cont } of LOTS) {
  const appt = bl === 'DIS30-G' ? APPT_G : APPT;
  const created = await fetch(`${API}/shipments/quick`, {
    method: 'POST',
    headers: { ...authed(cus), 'Idempotency-Key': `dis30-fix-${bl}` },
    body: JSON.stringify({
      customerId: 1, tradeDirection: 'IMPORT', blNumber: bl, cargoMode: 'FCL',
      containers: [{ containerTypeId: 1, containerNumber: cont, cargoWeightKg: 8000, customerAppointmentAt: appt, routeId: 1, pickupPortId: 1, dropoffPortId: 2 }],
    }),
  });
  const body = await created.text();
  log('create', { bl, status: created.status });
  if (!created.ok && !/tồn tại|existing|duplicate/i.test(body)) throw new Error(`create ${bl}: ${body.slice(0, 200)}`);
  const shipment = JSON.parse(body);
  const shipId = shipment.id;
  // route fix for idempotent reuse
  await fetch(`${API}/shipments/${shipId}/containers/${shipment.containers?.[0]?.id ?? ''}`, { method: 'PATCH', headers: authed(cus) }).catch(() => {});
  // find the fulfillment
  const rows = await fetch(`${API}/shipments/dispatch-detail-plan-rows?limit=50&q=${cont.slice(0, 10)}`, { headers: authed(dieuvan) }).then((r) => r.json());
  const row = (rows.items ?? []).find((i) => i.container?.containerNumber === cont);
  if (!row) throw new Error(`no plan row for ${cont}`);
  if (!row.dispatch?.assignedPlate) {
    const assign = await fetch(`${API}/shipments/dispatch-detail-plan-rows/${row.fulfillmentId}/plan`, {
      method: 'PATCH',
      headers: { ...authed(dieuvan), 'Idempotency-Key': `dis30-assign-${bl}-${Date.now()}` },
      body: JSON.stringify({
        expectedFulfillmentVersion: row.version, expectedShipmentVersion: row.shipmentVersion,
        carrierType: 'OWN', truckId: 2, plannedRevenue: null, plannedCarrierCost: null,
        classification: 'SINGLE', operationalNotes: null,
      }),
    });
    log('assign', { bl, status: assign.status, body: (await assign.text()).slice(0, 120) });
  }
  const fresh = await fetch(`${API}/shipments/dispatch-detail-plan-rows?limit=50&q=${cont.slice(0, 10)}`, { headers: authed(dieuvan) }).then((r) => r.json());
  const fr = (fresh.items ?? []).find((i) => i.container?.containerNumber === cont);
  state.push({ bl, shipId, cont, ful: fr.fulfillmentId, plate: fr.dispatch?.assignedPlate, status: fr.taskStatus, fver: fr.version, sver: fr.shipmentVersion, plannedEndAt: fr.plannedEndAt });
}
fs.writeFileSync(path.join(OUT, 'fixtures-state.json'), JSON.stringify(state, null, 2));
log('ready', state);
