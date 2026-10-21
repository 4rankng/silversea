// DRI-03 lan 2 (card 211026180628) — fixture lot kẹp 2x20' theo SHAPE THẬT của
// lot QA 133 / SHP-2610-00069 trên staging (read-only GET 2026-10-21):
//   customer Long Minh (id 1) · 2 containers 20DC (typeId 1) · containerNumber
//   NULL (bqhuong tự nhập trên app) · revGroup NULL · per-container
//   customerAppointmentAt (giờ RIÊNG từng cont) · route + cảng nâng/hạ từng cont.
// Flow: cus quick-create → dieuvan assign truck 186320 (bqhuong, driver 42966)
// cho TỪNG fulfillment → Phát lệnh từng leg (giờ chạy riêng từng cont) →
// POST /trips/pairs pairKind KEP.
// Usage: node testplan/qa/scripts/2026-10-21-dri03-lan2-fixture.mjs
import fs from 'node:fs';
import path from 'node:path';

const API = process.env.QA_API || 'http://localhost:3002/api';
const OUT = path.resolve('qa/2026-10-21-dri03-lan2');
fs.mkdirSync(OUT, { recursive: true });
const BL = process.env.DRIL2_BL || 'DRIL2-KEP';
const TRUCK_ID = Number(process.env.DRIL2_TRUCK || 186320);
const DRIVER_ID = Number(process.env.DRIL2_DRIVER || 42966);
const TRAILER_ID = Number(process.env.DRIL2_TRAILER || 1); // RM-60C-12345 40FT — moóc kẹp 2x20'
// Giờ hẹn riêng từng cont (UTC; +07 = 09:00 và 12:00 ngày 25/10)
const APPT_1 = '2026-10-25T02:00:00.000Z';
const APPT_2 = '2026-10-25T05:00:00.000Z';

const login = async (identifier, password = 'Abc123') => {
  const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password }) });
  if (!res.ok) throw new Error(`login ${identifier} -> ${res.status}`);
  return (await res.json()).token;
};
const log = (step, obj) => console.log(JSON.stringify({ at: new Date().toISOString(), step, ...obj }));

const cus = await login('cus');
const dieuvan = await login('dieuvan');
const authed = (token) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

// 1. Tạo lô kẹp — 2x20DC, KHÔNG số cont (bqhuong nhập trên app), giờ riêng từng cont
const created = await fetch(`${API}/shipments/quick`, {
  method: 'POST',
  headers: { ...authed(cus), 'Idempotency-Key': `dril2-kep-${BL}` },
  body: JSON.stringify({
    customerId: 1, tradeDirection: 'IMPORT', blNumber: BL, cargoMode: 'FCL',
    containers: [
      { containerTypeId: 1, containerNumber: null, cargoWeightKg: 8000, customerAppointmentAt: APPT_1, routeId: 1, pickupPortId: 1, dropoffPortId: 2 },
      { containerTypeId: 1, containerNumber: null, cargoWeightKg: 7500, customerAppointmentAt: APPT_2, routeId: 1, pickupPortId: 1, dropoffPortId: 2 },
    ],
  }),
});
const createBody = await created.text();
log('create', { status: created.status, body: createBody.slice(0, 200) });
if (!created.ok && !/tồn tại|existing|duplicate/i.test(createBody)) throw new Error(`create: ${createBody.slice(0, 300)}`);
const shipment = JSON.parse(createBody);
const shipId = shipment.id;

// 2. Plan rows cho cả 2 fulfillment
const rows = await fetch(`${API}/shipments/dispatch-detail-plan-rows?limit=50&q=${BL}`, { headers: authed(dieuvan) }).then((r) => r.json());
const items = (rows.items ?? []).filter((i) => i.shipmentId === shipId);
log('plan_rows', items.map((i) => ({ ful: i.fulfillmentId, cont: i.container?.containerNumber, cls: i.classification, status: i.taskStatus, appt: i.container?.customerAppointmentAt, ver: i.version })));
if (items.length !== 2) throw new Error(`expected 2 plan rows, got ${items.length}`);

// 3. Gán truck bqhuong cho TỪNG leg (warn-once rig overlap cùng lô → confirm)
for (const row of items) {
  if (row.taskStatus === 'DISPATCHED') { log('assign_skip', { ful: row.fulfillmentId, reason: 'already dispatched' }); continue; }
  const body = {
    expectedFulfillmentVersion: row.version, expectedShipmentVersion: row.shipmentVersion,
    carrierType: 'OWN', truckId: TRUCK_ID, plannedRevenue: null, plannedCarrierCost: null,
    classification: 'SINGLE', operationalNotes: null,
  };
  let res = await fetch(`${API}/shipments/dispatch-detail-plan-rows/${row.fulfillmentId}/plan`, {
    method: 'PATCH',
    headers: { ...authed(dieuvan), 'Idempotency-Key': `dril2-assign-${row.fulfillmentId}-${Date.now()}` },
    body: JSON.stringify(body),
  });
  let text = await res.text();
  if (res.status === 409 && /RIG_OVERLAP|Vẫn lưu/i.test(text)) {
    log('assign_warn', { ful: row.fulfillmentId, body: text.slice(0, 160) });
    res = await fetch(`${API}/shipments/dispatch-detail-plan-rows/${row.fulfillmentId}/plan`, {
      method: 'PATCH',
      headers: { ...authed(dieuvan), 'Idempotency-Key': `dril2-assign-${row.fulfillmentId}-${Date.now()}-c` },
      body: JSON.stringify({ ...body, rigOverlapCompletedConfirmed: true }),
    });
    text = await res.text();
  }
  log('assign', { ful: row.fulfillmentId, status: res.status, body: text.slice(0, 160) });
  if (!res.ok && !/đã được gán|no_changes/i.test(text)) throw new Error(`assign ${row.fulfillmentId}: ${text.slice(0, 200)}`);
}

// 4. Phát lệnh từng leg — giờ chạy riêng từng cont (warn-once rig overlap → confirm)
const issued = [];
const FRESH = await fetch(`${API}/shipments/dispatch-detail-plan-rows?limit=50&q=${BL}`, { headers: authed(dieuvan) }).then((r) => r.json());
const freshItems = (FRESH.items ?? []).filter((i) => i.shipmentId === shipId);
for (const [idx, row] of freshItems.entries()) {
  if (row.taskStatus === 'DISPATCHED' && row.dispatch?.tripId != null) {
    log('issue_skip', { ful: row.fulfillmentId, trip: row.dispatch.tripId });
    issued.push({ fulfillmentId: row.fulfillmentId, tripId: row.dispatch.tripId, tripVersion: null, start: null, end: null, appt: idx === 0 ? APPT_1 : APPT_2 });
    continue;
  }
  const start = idx === 0 ? APPT_1 : APPT_2;
  const end = idx === 0 ? '2026-10-25T08:00:00.000Z' : '2026-10-25T11:00:00.000Z';
  const body = {
    fulfillmentId: row.fulfillmentId, expectedVersion: row.version,
    plannedStartAt: start, plannedEndAt: end, endTimeConfirmed: true,
    carrierType: 'OWN', truckId: TRUCK_ID, driverId: DRIVER_ID, trailerId: TRAILER_ID, containerTypeId: 1,
  };
  let res = await fetch(`${API}/shipments/${shipId}/dispatch`, {
    method: 'POST',
    headers: { ...authed(dieuvan), 'Idempotency-Key': `dril2-issue-${row.fulfillmentId}-${Date.now()}` },
    body: JSON.stringify(body),
  });
  let text = await res.text();
  if (res.status === 409 && /rig|trùng đầu kéo|xác nhận/i.test(text)) {
    log('issue_warn', { ful: row.fulfillmentId, body: text.slice(0, 200) });
    res = await fetch(`${API}/shipments/${shipId}/dispatch`, {
      method: 'POST',
      headers: { ...authed(dieuvan), 'Idempotency-Key': `dril2-issue-${row.fulfillmentId}-${Date.now()}-c` },
      body: JSON.stringify({ ...body, rigOverlapCompletedConfirmed: true }),
    });
    text = await res.text();
  }
  log('issue', { ful: row.fulfillmentId, status: res.status, body: text.slice(0, 220) });
  if (!res.ok) throw new Error(`issue leg ${idx + 1}: ${text.slice(0, 300)}`);
  const outcome = JSON.parse(text);
  issued.push({ fulfillmentId: row.fulfillmentId, tripId: outcome.trip.id, tripVersion: outcome.trip.version, start: outcome.trip.plannedStartAt, end: outcome.trip.plannedEndAt, appt: idx === 0 ? APPT_1 : APPT_2 });
}
if (issued[0].tripId === issued[1].tripId) throw new Error('both legs landed on the SAME trip');

// 5. Ghép KEP pair (2 cont 20' cùng mooc) — draft lấy từ GET /api/trips/:id
// y hệt PairTripsDialog.draftFor (FE): đúng chuỗi ISO backend tự serialize,
// tránh lệch múi giờ timestamp naive khi đọc thẳng DB.
const tripApi = async (id) => fetch(`${API}/trips/${id}`, { headers: authed(dieuvan) }).then((r) => {
  if (!r.ok) throw new Error(`GET /trips/${id} -> ${r.status}`);
  return r.json();
});
const baseTrip = await tripApi(issued[0].tripId);
const partnerTrip = await tripApi(issued[1].tripId);
const draftFor = (trip) => ({
  plannedStartAt: new Date(trip.plannedStartAt).toISOString(),
  plannedEndAt: new Date(trip.plannedEndAt).toISOString(),
  canonicalOrigin: trip.canonicalOrigin, canonicalDestination: trip.canonicalDestination,
  cargoWeightKg: Number(trip.cargoWeightKg), vehicleCapacityKg: Number(trip.vehicleCapacityKg),
  expectedVersion: trip.version,
});
const pairPayload = {
  firstTripId: issued[0].tripId, secondTripId: issued[1].tripId, pairKind: 'KEP',
  firstTrip: draftFor(baseTrip), secondTrip: draftFor(partnerTrip),
};
log('pair_payload', pairPayload);

const pair = await fetch(`${API}/trips/pairs`, {
  method: 'POST',
  headers: { ...authed(dieuvan), 'Idempotency-Key': `dril2-pair-${issued[0].tripId}-${issued[1].tripId}` },
  body: JSON.stringify(pairPayload),
});
const pairText = await pair.text();
log('pair', { status: pair.status, body: pairText.slice(0, 260) });
if (!pair.ok && /trùng nhưng nội dung khác/.test(pairText)) {
  // Rerun with a newer trip version (e.g. after Nhận lệnh) — the pair already
  // exists; confirm via DB instead of forcing a new idempotency key.
  const { default: postgres } = await import('../../../backend/node_modules/postgres/src/index.js');
  const sqlc = postgres('postgres://postgres:postgres@127.0.0.1:5441/silversea');
  const existing = await sqlc`SELECT p.id, p.pair_kind, p.status FROM trip_pairs p JOIN trips t1 ON t1.active_trip_pair_id = p.id WHERE t1.id IN (${issued[0].tripId}, ${issued[1].tripId}) AND p.status = 'ACTIVE' AND p.pair_kind = 'KEP'`;
  await sqlc.end();
  log('pair_existing', existing);
  if (existing.length === 0) throw new Error(`pair conflict but no existing KEP pair: ${pairText.slice(0, 200)}`);
} else if (!pair.ok && !/replay|tồn tại/i.test(pairText)) {
  throw new Error(`pair: ${pairText.slice(0, 300)}`);
}

fs.writeFileSync(path.join(OUT, 'fixture-state.json'), JSON.stringify({ shipId, bl: BL, truckId: TRUCK_ID, driverId: DRIVER_ID, legs: issued }, null, 2));
log('ready', { shipId, legs: issued });
