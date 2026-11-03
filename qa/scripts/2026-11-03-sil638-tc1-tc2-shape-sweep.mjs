// SIL-638 (id 742) — QA 03/11 shape sweep (PHASE=before evidence).
// LOCAL dev only — BE :3013 of this worktree + ss-prod-db (psql read-only via
// docker exec). Probe family BK-S638F-*; housekeeping cancels ONLY its own.
//   node qa/scripts/2026-11-03-sil638-tc1-tc2-shape-sweep.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const API = process.env.S638F_API ?? 'http://localhost:3013/api';
const OUT = path.resolve('qa/2026-11-03-sil638-tc1-tc2');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, process.env.S638F_LOG ?? 'before.log');
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

const baseDay = new Date(Date.now() + 40 * 24 * 3600e3);
// Per-shape isolated days: shapes never share a business day, so one shape's
// holders can never pollute another's scans (stateful-sweep lesson, round 1).
const dayAt = (offsetDays) => new Date(baseDay.getTime() + offsetDays * 24 * 3600e3).toISOString().slice(0, 10);
const at = (dayX, h) => new Date(`${dayX}T${String(h).padStart(2, '0')}:00:00+07:00`).toISOString();

const check10 = (prefix10) => {
  const MAP = { A: 10, B: 12, C: 13, D: 14, E: 15, F: 16, G: 18, H: 19, I: 20, J: 21, K: 22, L: 23, M: 24, N: 25, O: 26, P: 27, Q: 28, R: 29, S: 30, T: 31, U: 32, V: 34, W: 35, X: 36, Y: 37, Z: 38 };
  let sum = 0; const POW = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512];
  [...prefix10].forEach((ch, i) => { sum += (/\d/.test(ch) ? Number(ch) : MAP[ch]) * POW[i]; });
  return `${prefix10}${sum % 11 === 10 ? 0 : sum % 11}`;
};

let serial = Date.now() % 100000;

async function makeLot(tag, { nContainers, appointments, day }) {
  const bl = `BK-S638F-${tag}-${Date.now()}`;
  const created = await send(admin, '/shipments', 'POST', {
    customerId: customer.id, tradeDirection: 'IMPORT', cargoMode: 'FCL',
    blNumber: bl, expectedDeliveryDate: day, cargoWeightKg: 12000,
  });
  if (created.status !== 201) throw new Error(`lot ${tag} create -> ${created.status}`);
  const shipmentId = created.body?.shipment?.id ?? created.body?.id;
  const cur = await send(admin, `/shipments/${shipmentId}`);
  const curVersion = cur.body?.version ?? cur.body?.shipment?.version ?? 0;
  const conts = await send(admin, `/shipments/${shipmentId}/containers`, 'PUT', {
    expectedVersion: curVersion,
    containers: Array.from({ length: nContainers }, (_, i) => ({
      containerNumber: check10(`TSTU${String(serial + i).padStart(6, '0')}`),
      containerTypeId: type20.id, routeId: route.id, operationalSiteId: site?.id,
      pickupPortId: (ports[0] ?? ports[1]).id, dropoffPortId: (ports[1] ?? ports[0]).id,
      cargoWeightKg: 5000,
      ...(appointments?.[i] ? { customerAppointmentAt: appointments[i] } : {}),
    })),
  });
  serial += nContainers + 3;
  if (!(conts.status === 200 || conts.status === 201)) throw new Error(`lot ${tag} containers -> ${conts.status}`);
  const after = await send(admin, `/shipments/${shipmentId}`);
  await send(admin, `/shipments/${shipmentId}/submit-for-dispatch`, 'POST', { expectedVersion: after.body?.version ?? after.body?.shipment?.version ?? curVersion });
  const rows = await send(dispatch, `/shipments/dispatch-detail-plan-rows?q=${encodeURIComponent(bl)}&limit=50`);
  const unissued = (rows.body?.items ?? []).filter((r) => r.dispatch?.tripId == null && r.dispatch?.carrierType !== 'EXTERNAL');
  return { bl, shipmentId, rows: unissued };
}

const planSave = (lot, row, extra = {}) => send(dispatch, `/shipments/dispatch-detail-plan-rows/${row.fulfillmentId}/plan`, 'PATCH', {
  expectedFulfillmentVersion: ffVersion(row.fulfillmentId),
  expectedShipmentVersion: shipVersion(lot.shipmentId),
  carrierType: 'OWN', truckId: RIG.truckId,
  classification: 'SINGLE', plannedRevenue: 0, plannedCarrierCost: 0,
  ...extra,
});
const planSaveClass = (lot, row, classification, extra = {}) => planSave(lot, row, { classification, ...extra });

let admin, dispatch, customer, route, type20, ports, site;
const RIG = { truckId: null, trailerId: null, driverId: null };
let trailerCreated = null;

(async () => {
  admin = await login('admin');
  dispatch = await login('dieuvan');
  log(`logged in admin + dieuvan; probe days from ${dayAt(0)}`);

  // Housekeeping — clear ONLY this probe family's leftovers (BK-S638F-*):
  // cancel its live trips AND release its plan-row plates so rigs from earlier
  // runs stop hogging trucks. Never touches any other lane's or business data.
  const stale = psql(`SELECT t.id, t.version FROM trips t
    JOIN shipment_fulfillments sf ON sf.id = t.fulfillment_id
    JOIN shipments sh ON sh.id = sf.shipment_id
    WHERE sh.bl_number LIKE 'BK-S638F-%' AND t.deleted_at IS NULL
      AND t.status IN ('CREATED','IN_TRANSIT') ORDER BY t.id`).split('\n').filter(Boolean);
  for (const entry of stale) {
    const [tripId, version] = entry.split('|').map(Number);
    const cancel = await send(admin, `/trips/${tripId}/cancel`, 'POST', { expectedVersion: version, reason: 'SIL-638F housekeeping' });
    log(`housekeeping: cancel trip ${tripId} → ${cancel.status}`);
  }
  const releasedPlates = psql(`UPDATE shipment_fulfillments sf
    SET planned_vehicle_plate_number = NULL
    FROM shipments sh
    WHERE sh.id = sf.shipment_id AND sh.bl_number LIKE 'BK-S638F-%'
      AND sf.planned_vehicle_plate_number IS NOT NULL
    RETURNING sf.id`).split('\n').filter(Boolean).length;
  log(`housekeeping: released ${releasedPlates} family plan-row plate(s)`);

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

  const winEndAll = dayAt(101);
  const freeWithin = (column, id) => `NOT EXISTS (
    SELECT 1 FROM trips t WHERE t.${column} = ${id} AND t.deleted_at IS NULL AND t.status IN ('CREATED','IN_TRANSIT')
      AND t.planned_start_at < '${winEndAll}'::timestamptz
      AND coalesce(t.planned_end_at, t.planned_start_at + interval '8 hours') > '${dayAt(-1)}'::timestamptz)`;
  RIG.truckId = Number(psql(`SELECT tk.id FROM trucks tk WHERE tk.deleted_at IS NULL AND tk.status = 'ACTIVE'
    AND NOT EXISTS (SELECT 1 FROM trips t WHERE t.truck_id = tk.id AND t.deleted_at IS NULL AND t.status = 'IN_TRANSIT')
    AND NOT EXISTS (SELECT 1 FROM shipment_fulfillments sf WHERE sf.planned_vehicle_plate_number = tk.license_plate AND sf.canceled_at IS NULL)
    AND ${freeWithin('truck_id', 'tk.id')} ORDER BY tk.id LIMIT 1`));
  RIG.driverId = Number(psql(`SELECT d.id FROM drivers d JOIN users u ON u.id = d.user_id
    WHERE d.deleted_at IS NULL AND d.status = 'ACTIVE' AND u.deleted_at IS NULL AND u.status = 'ACTIVE' AND u.role = 'DRIVER'
    AND NOT EXISTS (SELECT 1 FROM trips t WHERE t.driver_id = d.id AND t.deleted_at IS NULL AND t.status = 'IN_TRANSIT')
    AND ${freeWithin('driver_id', 'd.id')} ORDER BY d.id LIMIT 1`));
  trailerCreated = await send(admin, '/trailers', 'POST', { licensePlate: `RS-S638F-${Date.now() % 100000}`, type: '40FT' });
  RIG.trailerId = trailerCreated.body?.id;
  log(`rig truck=${RIG.truckId} driver=${RIG.driverId} trailer=${RIG.trailerId}`);

  // ── SHAPE V3 (TC1 QA) — distinct appointments, NO Giờ trả hàng: the ca sáng
  // leg's stored claim must NOT swallow the 14:00 start. Expect B saves clean.
  {
    const dayV3 = dayAt(0);
    const lot = await makeLot('V3', { nContainers: 2, appointments: [at(dayV3, 8), at(dayV3, 14)], day: dayV3 });
    const [legA, legB] = lot.rows;
    const a = await planSave(lot, legA);
    log(`V3 assign A (08:00 slot, no end) → ${a.status} ${a.status >= 400 ? JSON.stringify(a.body).slice(0, 160) : ''}`);
    const b = await planSave(lot, legB);
    log(`V3 assign B (14:00 slot, no end) → ${b.status} ${b.status >= 400 ? JSON.stringify(b.body).slice(0, 160) : ''}`);
    check('V3 (TC1): B 14:00 saves clean against 08:00 READY holder (KHÔNG 1 leg/truck/ngày)', b.status === 200, `status=${b.status}`);
  }

  // ── SHAPE V2 (TC1 guard rail) — SAME appointment slot both legs, no ends:
  // the same-instant double-book must still WARN (409 confirmable), never silent.
  {
    const dayV2 = dayAt(10);
    const lot = await makeLot('V2', { nContainers: 2, appointments: [at(dayV2, 8), at(dayV2, 8)], day: dayV2 });
    const [legA, legB] = lot.rows;
    await planSave(lot, legA);
    const b = await planSave(lot, legB);
    log(`V2 assign B (same 08:00 slot) → ${b.status} ${JSON.stringify(b.body).slice(0, 160)}`);
    check('V2 (TC1): cùng slot vẫn chặn với cảnh báo (không im lặng)', b.status === 409 && String(b.body?.code ?? '').includes('RIG_OVERLAP'), `status=${b.status} code=${b.body?.code}`);
    const b2 = await planSave(lot, legB, { rigOverlapCompletedConfirmed: true });
    check('V2 (TC1): cảnh báo confirmable — retry lưu tiếp', b2.status === 200, `status=${b2.status}`);
  }

  // ── SHAPE V5 (TC1 guard rail) — declared overlap (A 08→12 saved end, B 10→14)
  // must STILL block.
  {
    const dayV5 = dayAt(20);
    const lot = await makeLot('V5', { nContainers: 2, appointments: [at(dayV5, 8), at(dayV5, 10)], day: dayV5 });
    const [legA, legB] = lot.rows;
    await planSave(lot, legA, { plannedEndAt: at(dayV5, 12) });
    const b = await planSave(lot, legB, { plannedEndAt: at(dayV5, 14) });
    log(`V5 assign B 10:00–14:00 vs A 08:00–12:00 → ${b.status} ${JSON.stringify(b.body).slice(0, 160)}`);
    check('V5 (TC1): trùng giờ thật vẫn bị chặn', b.status === 409, `status=${b.status}`);
  }

  // ── TC2 plan-layer, cross-lot: ĐƠN assigned first, then a KẸP row onto the
  // same truck must be REFUSED with the classification message (today: silent).
  {
    const dayT2 = dayAt(30);
    const lotDon = await makeLot('T2DON', { nContainers: 1, appointments: [at(dayT2, 9)], day: dayT2 });
    const donRow = lotDon.rows[0];
    const donSave = await planSave(lotDon, donRow, { plannedEndAt: at(dayT2, 13) });
    log(`T2 assign ĐƠN 09:00–13:00 → ${donSave.status}`);
    const lotKep = await makeLot('T2KEP', { nContainers: 1, appointments: [at(dayT2, 10)], day: dayT2 });
    const kepRow = lotKep.rows[0];
    const kepSave = await planSaveClass(lotKep, kepRow, 'DOUBLE', { plannedEndAt: at(dayT2, 14) });
    log(`T2 assign KẸP row onto truck holding ĐƠN → ${kepSave.status} ${JSON.stringify(kepSave.body).slice(0, 200)}`);
    check('T2 (TC2 ĐƠN→KẸP): KẸP row bị TỪ CHỐI với message phân loại (không lưu im lặng)',
      kepSave.status === 409 && JSON.stringify(kepSave.body).includes('Cần cả 2 cont cùng khai báo KẸP'),
      `status=${kepSave.status}`);
  }

  // ── TC2 plan-layer, reverse (KẸP first → ĐƠN): already refuses — pin it.
  {
    const dayT2r = dayAt(40);
    const lotKep2 = await makeLot('T2K2', { nContainers: 1, appointments: [at(dayT2r, 9)], day: dayT2r });
    const kepRow = lotKep2.rows[0];
    await planSaveClass(lotKep2, kepRow, 'DOUBLE', { plannedEndAt: at(dayT2r, 13) });
    const lotDon2 = await makeLot('T2D2', { nContainers: 1, appointments: [at(dayT2r, 10)], day: dayT2r });
    const donRow = lotDon2.rows[0];
    const donSave = await planSave(lotDon2, donRow, { plannedEndAt: at(dayT2r, 14) });
    log(`T2r assign ĐƠN row onto truck holding KẸP → ${donSave.status} ${JSON.stringify(donSave.body).slice(0, 200)}`);
    check('T2r (TC2 KẸP→ĐƠN): ĐƠN row bị từ chối với message phân loại',
      donSave.status === 409 && JSON.stringify(donSave.body).includes('Cần cả 2 cont cùng khai báo KẸP'),
      `status=${donSave.status}`);
  }

  // ── TC2 same-kind control: DOUBLE + DOUBLE same truck same day still saves
  // (the pair arrangement carve — TC3 foundation must not regress).
  {
    const dayKK = dayAt(50);
    const lot1 = await makeLot('T2KK1', { nContainers: 1, appointments: [at(dayKK, 9)], day: dayKK });
    await planSaveClass(lot1, lot1.rows[0], 'DOUBLE', { plannedEndAt: at(dayKK, 13) });
    const lot2 = await makeLot('T2KK2', { nContainers: 1, appointments: [at(dayKK, 10)], day: dayKK });
    const save2 = await planSaveClass(lot2, lot2.rows[0], 'DOUBLE', { plannedEndAt: at(dayKK, 14) });
    log(`T2kk assign 2nd DOUBLE row same truck → ${save2.status} ${JSON.stringify(save2.body).slice(0, 200)}`);
    check('T2kk (TC2 control): DOUBLE+DOUBLE vẫn lưu (pair arrangement giữ nguyên)', save2.status === 200, `status=${save2.status}`);
  }

  // ── TC2 same-lot (review follow-up): Cont A KẸP + Cont B ĐƠN CÙNG lô trên
  // cùng xe — cả hai chiều phải 409 message phân loại (rotation warn không
  // chữa được bất đồng phân loại; trước fix: ĐƠN-first chỉ nhận rotation warn,
  // KẸP-first lưu im lặng).
  {
    const daySL = dayAt(70);
    const lotSL = await makeLot('T2SL', { nContainers: 2, appointments: [at(daySL, 9), at(daySL, 10)], day: daySL });
    const [rowA, rowB] = lotSL.rows;
    const kepFirst = await planSaveClass(lotSL, rowA, 'DOUBLE', { plannedEndAt: at(daySL, 13) });
    const donSecond = await planSave(lotSL, rowB, { plannedEndAt: at(daySL, 14) });
    log(`T2sl same-lot KẸP first, ĐƠN second → ${donSecond.status} ${JSON.stringify(donSecond.body).slice(0, 160)}`);
    check('T2sl (TC2 same-lot KẸP→ĐƠN): ĐƠN row cùng lô bị từ chối với message phân loại',
      kepFirst.status === 200 && donSecond.status === 409
      && JSON.stringify(donSecond.body).includes('Cần cả 2 cont cùng khai báo KẸP'),
      `kep=${kepFirst.status} don=${donSecond.status}`);
  }
  {
    const daySL2 = dayAt(80);
    const lotSL2 = await makeLot('T2SL2', { nContainers: 2, appointments: [at(daySL2, 9), at(daySL2, 10)], day: daySL2 });
    const [rowA, rowB] = lotSL2.rows;
    const donFirst = await planSave(lotSL2, rowA, { plannedEndAt: at(daySL2, 13) });
    const kepSecond = await planSaveClass(lotSL2, rowB, 'DOUBLE', { plannedEndAt: at(daySL2, 14) });
    log(`T2sl2 same-lot ĐƠN first, KẸP second → ${kepSecond.status} ${JSON.stringify(kepSecond.body).slice(0, 160)}`);
    check('T2sl2 (TC2 same-lot ĐƠN→KẸP): KẸP row cùng lô bị từ chối với message phân loại (trước fix: lưu im lặng)',
      donFirst.status === 200 && kepSecond.status === 409
      && JSON.stringify(kepSecond.body).includes('Cần cả 2 cont cùng khai báo KẸP'),
      `don=${donFirst.status} kep=${kepSecond.status}`);
  }

  // ── TC2 weak-holder tier (review follow-up): date-only holders (no
  // appointment, no giờ) — the mismatch answer is the family's confirmable
  // warn (never silent, FB-038), and the confirmed retry proceeds.
  {
    const dayW = dayAt(90);
    const lotW1 = await makeLot('T2W1', { nContainers: 1, appointments: [], day: dayW });
    const donSave = await planSave(lotW1, lotW1.rows[0]);
    const lotW2 = await makeLot('T2W2', { nContainers: 1, appointments: [], day: dayW });
    const kepWarn = await planSaveClass(lotW2, lotW2.rows[0], 'DOUBLE');
    log(`T2w date-only KẸP row onto date-only ĐƠN holder → ${kepWarn.status} ${JSON.stringify(kepWarn.body).slice(0, 200)}`);
    check('T2w (TC2 weak): holder date-only + KẸP row → cảnh báo xác nhận (không im lặng)',
      donSave.status === 200 && kepWarn.status === 409
      && String(kepWarn.body?.code ?? '').includes('RIG_OVERLAP'),
      `don=${donSave.status} kep=${kepWarn.status} code=${kepWarn.body?.code}`);
    const kepRetry = await planSaveClass(lotW2, lotW2.rows[0], 'DOUBLE', { rigOverlapCompletedConfirmed: true });
    check('T2w (TC2 weak): cảnh báo confirmable — retry lưu tiếp', kepRetry.status === 200, `status=${kepRetry.status}`);
  }

  // ── ISSUE-path dropout (TC1): A issued + IN_TRANSIT, then ISSUE D 18:00–22:00
  // same truck — must NOT 201 silently; busy warn + confirmed retry.
  {
    const dayDrop = dayAt(60);
    const lot = await makeLot('DROP', { nContainers: 2, appointments: [at(dayDrop, 8), at(dayDrop, 18)], day: dayDrop });
    const [legA, legD] = lot.rows;
    await planSave(lot, legA);
    await planSave(lot, legD);
    const issueA = await send(dispatch, `/shipments/${lot.shipmentId}/dispatch`, 'POST', {
      fulfillmentId: legA.fulfillmentId, expectedVersion: ffVersion(legA.fulfillmentId),
      plannedStartAt: at(dayDrop, 8), plannedEndAt: at(dayDrop, 12), endTimeConfirmed: true,
      carrierType: 'OWN', truckId: RIG.truckId, driverId: RIG.driverId, trailerId: RIG.trailerId,
    });
    log(`DROP issue A 08:00–12:00 → ${issueA.status} ${issueA.status >= 400 ? JSON.stringify(issueA.body).slice(0, 160) : `trip ${issueA.body?.trip?.id}`}`);
    const tripAId = issueA.body?.trip?.id;
    const driverUsername = psql(`SELECT u.username FROM drivers d JOIN users u ON u.id = d.user_id WHERE d.id = ${RIG.driverId}`);
    const drv = await login(driverUsername);
    if (tripAId != null) {
      const accepted = await send(drv, `/driver/me/fulfillments/${legA.fulfillmentId}/progress`, 'POST', { eventType: 'ORDER_RECEIVED', occurredAt: new Date().toISOString(), expectedVersion: Number(psql(`SELECT version FROM trips WHERE id = ${tripAId}`)) || 1 });
      log(`DROP driver accepts A → ${accepted.status} ${accepted.status >= 400 ? JSON.stringify(accepted.body).slice(0, 240) : ''}`);
    }
    const statusA = tripAId != null ? psql(`SELECT status FROM trips WHERE id = ${tripAId}`) : 'NO_TRIP';
    const issueD = await send(dispatch, `/shipments/${lot.shipmentId}/dispatch`, 'POST', {
      fulfillmentId: legD.fulfillmentId, expectedVersion: ffVersion(legD.fulfillmentId),
      plannedStartAt: at(dayDrop, 18), plannedEndAt: at(dayDrop, 22), endTimeConfirmed: true,
      carrierType: 'OWN', truckId: RIG.truckId, driverId: RIG.driverId, trailerId: RIG.trailerId,
    });
    log(`DROP issue D 18:00–22:00 (A ${statusA}) → ${issueD.status} ${JSON.stringify(issueD.body).slice(0, 200)}`);
    if (statusA === 'IN_TRANSIT') {
      check('DROP (TC1): phát lệnh D khi xe đang chạy KHÔNG im lặng (cảnh báo xe bận)',
        issueD.status === 409 && JSON.stringify(issueD.body).includes('đang bận'),
        `status=${issueD.status}`);
      const retry = await send(dispatch, `/shipments/${lot.shipmentId}/dispatch`, 'POST', {
        fulfillmentId: legD.fulfillmentId, expectedVersion: ffVersion(legD.fulfillmentId),
        plannedStartAt: at(dayDrop, 18), plannedEndAt: at(dayDrop, 22), endTimeConfirmed: true,
        carrierType: 'OWN', truckId: RIG.truckId, driverId: RIG.driverId, trailerId: RIG.trailerId,
        rigOverlapCompletedConfirmed: true,
      });
      check('DROP (TC1): cảnh báo xe bận confirmable — retry phát tiếp', retry.status === 200 || retry.status === 201, `status=${retry.status}`);
    } else {
      check('DROP (TC1): leg A không vào IN_TRANSIT — probe bỏ qua (kiểm tra dữ liệu)', false, `statusA=${statusA}`);
    }
  }

  log(failures === 0 ? 'SHAPE SWEEP COMPLETE — all expectations hold' : `SHAPE SWEEP COMPLETE — ${failures} expectation(s) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => { log(`SWEEP CRASHED: ${err.message}`); process.exit(2); });
