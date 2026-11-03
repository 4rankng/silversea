// SIL-666 round-2 (id 773) — date-dependent phantom 409 driver (PHASE evidence).
// LOCAL dev only — BE :3013 of this worktree + ss-prod-db (psql fixture/housekeeping,
// family-scoped BK-S666B-*). QA round-3b staging evidence: SINGLE lot 31/12 08:00 +
// 15H-061.14 → 409 "Cần cả 2 cont cùng khai báo KẸP…" naming nothing, 21/12 → 200;
// the plan-rows grid shows ZERO truck-39 rows on 31/12 and QA never checked trips.
//
// Reproduced defect class: the trip-side conflict scans of both rig guards
// (assertPlanRowRigAvailable tripConflictsRaw, assertTripRigAvailable
// activeConflictsRaw, issue-time assertResourceAvailability) never got the
// SIL-638 TC1 visibility law (deleted lot / non-operational lot / canceled
// fulfillment). A trip whose lot was deleted still claims the rig from the
// shadows — the exact "claim ẩn" shape, firing only on days the hidden trip
// overlaps (date-dependent).
//
//   S666B_PHASE=before S666B_LOG=before.log node qa/scripts/2026-11-04-sil666b-date-phantom-repro.mjs
//   S666B_PHASE=after  S666B_LOG=after.log  node qa/scripts/2026-11-04-sil666b-date-phantom-repro.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const API = process.env.S666B_API ?? 'http://localhost:3013/api';
const PHASE = process.env.S666B_PHASE ?? 'before';
const OUT = path.resolve('qa/2026-11-04-sil666b');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, process.env.S666B_LOG ?? `${PHASE}.log`);
fs.writeFileSync(LOG, '');
const log = (line) => { console.log(line); fs.appendFileSync(LOG, line + '\n'); };
let failures = 0;
const check = (name, ok, detail = '') => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

function psql(query) {
  return execFileSync('docker', ['exec', 'ss-prod-db', 'psql', '-U', 'postgres', '-d', 'silversea', '-At', '-c', query], { encoding: 'utf8' }).trim();
}
const shipVersion = (id) => Number(psql(`SELECT version FROM shipments WHERE id = ${id}`)) || 1;
const ffVersion = (id) => Number(psql(`SELECT version FROM shipment_fulfillments WHERE id = ${id}`)) || 1;

async function login(identifier) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  if (res.status !== 200) throw new Error(`login ${identifier} -> ${res.status}`);
  const body = await res.json();
  return body.token ?? body.accessToken;
}
const send = async (token, apiPath, method = 'GET', payload, extraHeaders = {}) => {
  const res = await fetch(`${API}${apiPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json', Authorization: `Bearer ${token}`,
      ...(payload ? { 'Idempotency-Key': crypto.randomUUID() } : {}),
      ...extraHeaders,
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
};

const check10 = (prefix10) => {
  const MAP = { A: 10, B: 12, C: 13, D: 14, E: 15, F: 16, G: 18, H: 19, I: 20, J: 21, K: 22, L: 23, M: 24, N: 25, O: 26, P: 27, Q: 28, R: 29, S: 30, T: 31, U: 32, V: 34, W: 35, X: 36, Y: 37, Z: 38 };
  let sum = 0; const POW = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512];
  [...prefix10].forEach((ch, i) => { sum += (/\d/.test(ch) ? Number(ch) : MAP[ch]) * POW[i]; });
  return `${prefix10}${sum % 11 === 10 ? 0 : sum % 11}`;
};

let serial = (Date.now() % 100000) + 2000;

async function makeLot(tag, { appointment, day }) {
  const bl = `BK-S666B-${tag}-${Date.now()}`;
  const created = await send(admin, '/shipments', 'POST', {
    customerId: customer.id, tradeDirection: 'IMPORT', cargoMode: 'FCL',
    blNumber: bl, expectedDeliveryDate: day, cargoWeightKg: 12000,
  });
  if (created.status !== 201) throw new Error(`lot ${tag} create -> ${created.status} ${JSON.stringify(created.body).slice(0, 200)}`);
  const shipmentId = created.body?.shipment?.id ?? created.body?.id;
  const cur = await send(admin, `/shipments/${shipmentId}`);
  const curVersion = cur.body?.version ?? cur.body?.shipment?.version ?? 0;
  const conts = await send(admin, `/shipments/${shipmentId}/containers`, 'PUT', {
    expectedVersion: curVersion,
    containers: [{
      containerNumber: check10(`TSTU${String(serial).padStart(6, '0')}`),
      containerTypeId: type20.id, routeId: route.id, operationalSiteId: site?.id,
      pickupPortId: (ports[0] ?? ports[1]).id, dropoffPortId: (ports[1] ?? ports[0]).id,
      cargoWeightKg: 5000,
      ...(appointment ? { customerAppointmentAt: appointment } : {}),
    }],
  });
  serial += 3;
  if (!(conts.status === 200 || conts.status === 201)) throw new Error(`lot ${tag} containers -> ${conts.status}`);
  const after = await send(admin, `/shipments/${shipmentId}`);
  await send(admin, `/shipments/${shipmentId}/submit-for-dispatch`, 'POST', { expectedVersion: after.body?.version ?? after.body?.shipment?.version ?? curVersion });
  const rows = await send(dispatch, `/shipments/dispatch-detail-plan-rows?q=${encodeURIComponent(bl)}&limit=50`);
  const unissued = (rows.body?.items ?? []).filter((r) => r.dispatch?.tripId == null && r.dispatch?.carrierType !== 'EXTERNAL');
  return { bl, shipmentId, row: unissued[0] };
}

const planSave = (lot, extra = {}) => send(dispatch, `/shipments/dispatch-detail-plan-rows/${lot.row.fulfillmentId}/plan`, 'PATCH', {
  expectedFulfillmentVersion: ffVersion(lot.row.fulfillmentId),
  expectedShipmentVersion: shipVersion(lot.shipmentId),
  carrierType: 'OWN', classification: 'SINGLE', plannedRevenue: 0, plannedCarrierCost: 0,
  ...extra,
});

let admin, dispatch, customer, route, type20, ports, site;
const TRUCK_39 = { id: 39, plate: '15H-061.14' };
const DRIVER_39 = 11; // BQHUONG — truck 39's assigned driver

(async () => {
  admin = await login('admin');
  dispatch = await login('dieuvan');
  log(`logged in admin + dieuvan; BE=${API} PHASE=${PHASE}`);

  // ── Housekeeping — ONLY this probe family (BK-S666B-*): cancel its trips,
  // release its plan plates, soft-delete its lots. Never touches other data.
  const stale = psql(`SELECT t.id, t.version FROM trips t
    JOIN shipment_fulfillments sf ON sf.id = t.fulfillment_id
    JOIN shipments sh ON sh.id = sf.shipment_id
    WHERE sh.bl_number LIKE 'BK-S666B-%' AND t.deleted_at IS NULL
      AND t.status IN ('CREATED','DISPATCHED','IN_TRANSIT') ORDER BY t.id`).split('\n').filter(Boolean);
  for (const entry of stale) {
    const [tripId, version] = entry.split('|').map(Number);
    const cancel = await send(admin, `/trips/${tripId}/cancel`, 'POST', { expectedVersion: version, reason: 'SIL-666 round-2 housekeeping' });
    log(`housekeeping: cancel trip ${tripId} → ${cancel.status}`);
  }
  const releasedPlates = psql(`UPDATE shipment_fulfillments sf
    SET planned_vehicle_plate_number = NULL
    FROM shipments sh
    WHERE sh.id = sf.shipment_id AND sh.bl_number LIKE 'BK-S666B-%'
      AND sf.planned_vehicle_plate_number IS NOT NULL
    RETURNING sf.id`).split('\n').filter(Boolean).length;
  const parkedLots = psql(`UPDATE shipments SET deleted_at = now()
    WHERE bl_number LIKE 'BK-S666B-%' AND deleted_at IS NULL
    RETURNING id`).split('\n').filter(Boolean).length;
  log(`housekeeping: released ${releasedPlates} plate(s), parked ${parkedLots} family lot(s)`);

  const [routesRes, ctypesRes, portsRes, customersRes] = await Promise.all([
    send(admin, '/routes?limit=50'),
    send(admin, '/container-types?limit=50'),
    send(admin, '/ports?limit=50'),
    send(admin, '/customers?limit=100'),
  ]);
  route = (routesRes.body?.items ?? []).find((r) => /KCN|TUYẾN|M57|HN|HCM/i.test(`${r.code ?? ''} ${r.name ?? ''}`)) ?? routesRes.body?.items?.[0];
  type20 = (ctypesRes.body?.items ?? []).find((t) => /^20/.test(t.code ?? ''));
  ports = portsRes.body?.items ?? [];
  customer = (customersRes.body?.items ?? []).find((c) => c.status === 'ACTIVE' && !c.isCarrier);
  let siteRes = await send(admin, `/shipments/operational-sites?customerId=${customer.id}`);
  site = (siteRes.body?.items ?? []).filter((x) => x.siteType === 'FACTORY' && (x.routeId == null || x.routeId === route.id)).at(-1);
  log(`refs: truck39=${TRUCK_39.plate} driver=${DRIVER_39} type20=${type20?.code}`);

  // ── Fixture — the hidden holder: a KẸP (DOUBLE) leg issued onto 15H-061.14
  // for 31/12 08:00, whose lot is then soft-deleted (the drift staging
  // accumulates; cancelShipmentFulfillment would cancel the trip with it, so
  // the orphan is seeded directly). The trip stays CREATED — an invisible
  // claim the plan grid cannot show.
  const day31 = '2026-12-31';
  const at31 = (h) => new Date(`${day31}T${String(h).padStart(2, '0')}:00:00+07:00`).toISOString();
  {
    const lotH = await makeLot('H31', { appointment: at31(8), day: day31 });
    const saveH = await planSave(lotH, { truckId: TRUCK_39.id, classification: 'DOUBLE' });
    if (saveH.status !== 200) throw new Error(`fixture plan save -> ${saveH.status} ${JSON.stringify(saveH.body).slice(0, 200)}`);
    const ffV = ffVersion(lotH.row.fulfillmentId);
    const issue = await send(admin, `/shipments/${lotH.shipmentId}/dispatch`, 'POST', {
      fulfillmentId: lotH.row.fulfillmentId, expectedVersion: ffV,
      plannedStartAt: at31(8), plannedEndAt: at31(12), endTimeConfirmed: true,
      carrierType: 'OWN', truckId: TRUCK_39.id, driverId: DRIVER_39,
    });
    if (issue.status !== 200 && issue.status !== 201) throw new Error(`fixture issue -> ${issue.status} ${JSON.stringify(issue.body).slice(0, 300)}`);
    const orphan = psql(`UPDATE shipments SET deleted_at = now()
      WHERE id = ${lotH.shipmentId} RETURNING id`);
    const tripState = psql(`SELECT t.id || '|' || t.status || '|' || coalesce(t.planned_start_at::text,'') || '|lot_deleted=' || (sh.deleted_at is not null)
      FROM trips t
      JOIN shipment_fulfillments sf ON sf.id = t.fulfillment_id
      JOIN shipments sh ON sh.id = sf.shipment_id
      WHERE sf.id = ${lotH.row.fulfillmentId} AND t.deleted_at IS NULL
      ORDER BY t.id DESC LIMIT 1`);
    log(`fixture: hidden DOUBLE trip on ${TRUCK_39.plate} 31/12 08:00 — orphan=${orphan} trip=${tripState}`);
    check('fixture: hidden KẸP trip seeded (trip CREATED, lot deleted)', Boolean(orphan) && /CREATED/.test(tripState) && /lot_deleted=t/.test(tripState), tripState);
  }

  // Lead #4 evidence — WHICH row can fire on the 31/12 window: truck 39 trips
  // overlapping [01:00, 09:00) UTC with their visibility flags.
  log('window evidence (31/12 08:00+7 = [01:00,09:00) UTC) truck-39 trips:');
  for (const line of psql(`SELECT '  trip ' || t.id || ' ' || t.trip_code || ' ' || t.status
      || ' start=' || coalesce(t.planned_start_at::text,'') || ' end=' || coalesce(t.planned_end_at::text,'')
      || ' lot_deleted=' || (sh.deleted_at is not null) || ' lot_status=' || coalesce(sh.status,'-')
      || ' ff_canceled=' || (sf.canceled_at is not null) || ' class=' || coalesce(sf.dispatch_classification,'-')
      || ' ff_plate=' || coalesce(sf.planned_vehicle_plate_number,'-')
    FROM trips t
    LEFT JOIN shipment_fulfillments sf ON sf.id = t.fulfillment_id
    LEFT JOIN shipments sh ON sh.id = sf.shipment_id
    WHERE t.truck_id = ${TRUCK_39.id} AND t.deleted_at IS NULL
      AND t.status NOT IN ('CANCELED','COMPLETED') AND t.planned_start_at IS NOT NULL
      AND t.planned_start_at < '2026-12-31T09:00:00+00'::timestamptz
      AND coalesce(t.planned_end_at, t.planned_start_at + interval '8 hours') > '2026-12-31T01:00:00+00'::timestamptz
    ORDER BY t.id`).split('\n').filter(Boolean)) log(line);

  // ── TC-666B-1 — the round-3b repro: brand-new SINGLE lot 31/12 08:00 +
  // 15H-061.14. The ONLY 31/12 claim is the hidden trip above (its lot is
  // deleted; the plan-rows grid shows nothing that day). Before the fix the
  // trip scan counts it → 409 TC2-mismatch naming nothing (QA's exact
  // evidence); after the fix the visibility law stops the hidden claim → 200.
  {
    const lotS31 = await makeLot('S31', { appointment: at31(8), day: day31 });
    const save31 = await planSave(lotS31, { truckId: TRUCK_39.id });
    const msg = typeof save31.body?.error === 'string' ? save31.body.error : JSON.stringify(save31.body);
    log(`S31 assign SINGLE 31/12 08:00 → ${TRUCK_39.plate} → ${save31.status} ${save31.status >= 400 ? msg.slice(0, 240) : ''}`);
    if (PHASE === 'before') {
      check('TC-666B-1 (before): 31/12 phantom tái hiện — 409 "Cần cả 2 cont cùng khai báo KẸP" naming nothing',
        save31.status === 409 && /Cần cả 2 cont cùng khai báo KẸP/.test(msg), `status=${save31.status} msg="${msg.slice(0, 160)}"`);
    } else {
      check('TC-666B-1 (after): 31/12 không còn phantom — gán 200 dù hidden trip vẫn tồn tại',
        save31.status === 200, `status=${save31.status} msg="${msg.slice(0, 160)}"`);
    }
  }

  // ── TC-666B-2 — the QA control: same truck, 21/12 (no hidden trip there) —
  // must stay 200 in BOTH phases (the phantom is date-dependent, not global).
  {
    const day21 = '2026-12-21';
    const at21 = (h) => new Date(`${day21}T${String(h).padStart(2, '0')}:00:00+07:00`).toISOString();
    const lotS21 = await makeLot('S21', { appointment: at21(8), day: day21 });
    const save21 = await planSave(lotS21, { truckId: TRUCK_39.id });
    log(`S21 control SINGLE 21/12 08:00 → ${TRUCK_39.plate} → ${save21.status}`);
    check('TC-666B-2: 21/12 đối chứng sạch giữ nguyên 200', save21.status === 200, `status=${save21.status}`);
  }

  // ── TC-666B-3 — no-regression: a REAL visible conflict must still block.
  // Truck 39's own fulfillment-LESS BULK task (BULK-TR-0180, CREATED,
  // 26/08→02/09) has no fulfillment/lot row — the visibility law must keep
  // counting it (round-1 Phase B pinned its named hard tier).
  {
    const dayB = '2026-08-28';
    const atB = (h) => new Date(`${dayB}T${String(h).padStart(2, '0')}:00:00+07:00`).toISOString();
    const bulk = psql(`SELECT id || '|' || trip_code || '|' || status FROM trips
      WHERE truck_id = ${TRUCK_39.id} AND deleted_at IS NULL AND status = 'CREATED' AND fulfillment_id IS NULL
        AND planned_start_at < '${dayB}T23:59:00+07:00'::timestamptz
        AND coalesce(planned_end_at, planned_start_at + interval '8 hours') > '${dayB}T00:00:00+07:00'::timestamptz
      ORDER BY id LIMIT 1`);
    const [bulkId, bulkCode, bulkStatus] = (bulk || '||').split('|');
    log(`B conflicting task on ${TRUCK_39.plate}: ${bulk || '(none)'}`);
    const lotB = await makeLot('B61', { appointment: atB(8), day: dayB });
    const saveB = await planSave(lotB, { truckId: TRUCK_39.id });
    const msg = typeof saveB.body?.error === 'string' ? saveB.body.error : JSON.stringify(saveB.body);
    log(`B assign SINGLE 28/08 08:00 → ${TRUCK_39.plate} (xung đột ${bulkCode} ${bulkStatus}) → ${saveB.status}`);
    check('TC-666B-3: xung đột THẬT (BULK fulfillment-less) vẫn 409 hard tier',
      saveB.status === 409 && Boolean(bulkId), `status=${saveB.status}`);
    const colonPart = String(msg).split('khung giờ trùng lặp:')[1] ?? '';
    check('TC-666B-3: message vẫn NÊU RÕ lô/tác vụ xung đột thật',
      /(Lô |Lệnh )/.test(colonPart), `colonPart="${colonPart.trim().slice(0, 120)}"`);
  }

  log(failures === 0
    ? `SIL-666b REPRO COMPLETE — phase ${PHASE}: all expectations hold`
    : `SIL-666b REPRO COMPLETE — phase ${PHASE}: ${failures} expectation(s) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => { log(`REPRO CRASHED: ${err.message}`); process.exit(2); });
