// SIL-638 (id 742) — repro probe for the two QA-fail cases on build ed0056e1
// (ticket comment 02/11 12:28):
//   TC6(2): 2 chân 20' Kẹp phát lần lượt — soft warning tải trọng không hỏa,
//           pair tạo ngay (trips CREATED) không có cảnh báo/xác nhận nào.
//   TC1   : cổng gán — chân cùng ca lưu sau khi chân kia phát (gate dropout);
//           chân 18:00 gán thành công trong khi 2 chân IN_TRANSIT.
// LOCAL dev only — BE :3002 of this worktree + ss-prod-db (psql read-only).
// Never staging, never production.
//
//   node qa/scripts/2026-11-02-sil638-tc1-tc6-repro.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const API = 'http://localhost:3013/api';
const OUT = path.resolve('qa/2026-11-02-sil638-tc1-tc6');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, 'repro.log');
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
const tripVersion = (id) => Number(psql(`SELECT version FROM trips WHERE id = ${id}`)) || 1;

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

const day = new Date(Date.now() + 7 * 24 * 3600e3).toISOString().slice(0, 10);
const at = (hh, mm = 0) => new Date(`${day}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+07:00`).toISOString();
const freeWithin = (column, id, winEnd) => `NOT EXISTS (
  SELECT 1 FROM trips t WHERE t.${column} = ${id} AND t.deleted_at IS NULL AND t.status IN ('CREATED','IN_TRANSIT')
    AND t.planned_start_at < '${winEnd}'::timestamptz
    AND coalesce(t.planned_end_at, t.planned_start_at + interval '8 hours') > '${at(6)}'::timestamptz)`;

const pickFree = (column, table, winEnd) => Number(psql(`SELECT x.id FROM ${table} x
  JOIN users u ON u.id = x.user_id
  WHERE x.deleted_at IS NULL AND x.status = 'ACTIVE' AND u.deleted_at IS NULL AND u.status = 'ACTIVE' AND u.role = 'DRIVER'
    AND ${freeWithin(column, 'x.id', winEnd)} ORDER BY x.id LIMIT 1`));

let unprovBl = '';
let overldBl = '';
(async () => {
  const admin = await login('admin');
  const dispatch = await login('dieuvan');
  log(`logged in admin + dieuvan; probe day = ${day}`);

  // Housekeeping — cancel ONLY this probe family's own leftovers
  // (lots BK-S638R-*), so rigs from earlier runs stop hogging trucks and
  // drivers. Never touches any other lane's or business data.
  const stale = psql(`SELECT t.id, t.version FROM trips t
    JOIN shipment_fulfillments sf ON sf.id = t.fulfillment_id
    JOIN shipments sh ON sh.id = sf.shipment_id
    WHERE sh.bl_number LIKE 'BK-S638R-%' AND t.deleted_at IS NULL
      AND t.status IN ('CREATED','IN_TRANSIT') ORDER BY t.id`).split('\n').filter(Boolean);
  for (const entry of stale) {
    const [tripId, version] = entry.split('|').map(Number);
    const cancel = await send(admin, `/trips/${tripId}/cancel`, 'POST', { expectedVersion: version, reason: 'SIL-638 repro housekeeping' });
    log(`housekeeping: cancel trip ${tripId} → ${cancel.status}`);
  }

  const [routesRes, ctypesRes, portsRes, customersRes] = await Promise.all([
    send(admin, '/routes?limit=50'),
    send(admin, '/container-types?limit=50'),
    send(admin, '/ports?limit=50'),
    send(admin, '/customers?limit=100'),
  ]);
  const route = (routesRes.body?.items ?? []).find((r) => /KCN|TUYẾN|M57|HN|HCM/i.test(`${r.code ?? ''} ${r.name ?? ''}`)) ?? routesRes.body?.items?.[0];
  const type20 = (ctypesRes.body?.items ?? []).find((t) => /^20/.test(t.code ?? ''));
  const ports = portsRes.body?.items ?? [];
  const customer = (customersRes.body?.items ?? []).find((c) => c.status === 'ACTIVE' && !c.isCarrier);
  let siteRes = await send(admin, `/shipments/operational-sites?customerId=${customer.id}`);
  let site = (siteRes.body?.items ?? []).filter((x) => x.siteType === 'FACTORY' && (x.routeId == null || x.routeId === route.id)).at(-1);
  if (!site) {
    const made = await send(admin, '/shipments/operational-sites', 'POST', {
      customerId: customer.id, code: `S638R-${Date.now() % 100000}`,
      name: `Nhà máy S638 repro ${Date.now() % 100000}`, siteType: 'FACTORY',
      routeId: route.id, address: 'Khu công nghiệp QA repro, Việt Nam',
    });
    site = made.status === 201 ? made.body : null;
  }
  const check10 = (prefix10) => {
    const MAP = { A: 10, B: 12, C: 13, D: 14, E: 15, F: 16, G: 18, H: 19, I: 20, J: 21, K: 22, L: 23, M: 24, N: 25, O: 26, P: 27, Q: 28, R: 29, S: 30, T: 31, U: 32, V: 34, W: 35, X: 36, Y: 37, Z: 38 };
    let sum = 0; const POW = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512];
    [...prefix10].forEach((ch, i) => { sum += (/\d/.test(ch) ? Number(ch) : MAP[ch]) * POW[i]; });
    return `${prefix10}${sum % 11 === 10 ? 0 : sum % 11}`;
  };

  async function makeLot(tag, { lotWeight, containerWeight, nContainers, appointments }) {
    const bl = `BK-S638R-${tag}-${Date.now()}`;
    const created = await send(admin, '/shipments', 'POST', {
      customerId: customer.id, tradeDirection: 'IMPORT', cargoMode: 'FCL',
      blNumber: bl, expectedDeliveryDate: day, cargoWeightKg: lotWeight,
    });
    if (created.status !== 201) throw new Error(`lot ${tag} create -> ${created.status} ${JSON.stringify(created.body).slice(0, 200)}`);
    const shipmentId = created.body?.shipment?.id ?? created.body?.id;
    const cur = await send(admin, `/shipments/${shipmentId}`);
    const curVersion = cur.body?.version ?? cur.body?.shipment?.version ?? 0;
    const serialBase = Number(String(Date.now()).slice(-6)) + Math.floor(Math.random() * 90);
    const conts = await send(admin, `/shipments/${shipmentId}/containers`, 'PUT', {
      expectedVersion: curVersion,
      containers: Array.from({ length: nContainers }, (_, i) => ({
        containerNumber: check10(`TSTU${String(serialBase + i).padStart(6, '0')}`),
        containerTypeId: type20.id, routeId: route.id, operationalSiteId: site?.id,
        pickupPortId: (ports[0] ?? ports[1]).id, dropoffPortId: (ports[1] ?? ports[0]).id,
        ...(containerWeight != null ? { cargoWeightKg: containerWeight } : {}),
        ...(appointments?.[i] ? { customerAppointmentAt: appointments[i].start } : {}),
      })),
    });
    if (!(conts.status === 200 || conts.status === 201)) throw new Error(`lot ${tag} containers -> ${conts.status} ${JSON.stringify(conts.body).slice(0, 300)}`);
    const after = await send(admin, `/shipments/${shipmentId}`);
    const submitted = await send(admin, `/shipments/${shipmentId}/submit-for-dispatch`, 'POST', { expectedVersion: after.body?.version ?? after.body?.shipment?.version ?? curVersion });
    if (!(submitted.status === 200 || submitted.status === 201)) throw new Error(`lot ${tag} submit -> ${submitted.status} ${JSON.stringify(submitted.body).slice(0, 300)}`);
    const rows = await send(dispatch, `/shipments/dispatch-detail-plan-rows?q=${encodeURIComponent(bl)}&limit=50`);
    const unissued = (rows.body?.items ?? []).filter((r) => r.dispatch?.tripId == null && r.dispatch?.carrierType !== 'EXTERNAL');
    return { bl, shipmentId, rows: unissued };
  }

  // ── Rig setup ──────────────────────────────────────────────────────────
  // Rig A: tractor with a TYPE-NULL moóc (vehicleCapacityKg null — the DOC's
  // "xe chưa cấu hình tải moóc" branch). Rig B: 40FT moóc (capacity 30000).
  const winEndAll = new Date(Date.now() + 8 * 24 * 3600e3).toISOString();
  const trailerA = await send(admin, '/trailers', 'POST', { licensePlate: `RS-S638A-${Date.now() % 100000}`, type: null });
  const trailerAId = trailerA.body?.id;
  const truckAId = Number(psql(`SELECT tk.id FROM trucks tk WHERE tk.deleted_at IS NULL AND tk.status = 'ACTIVE' AND ${freeWithin('truck_id', 'tk.id', winEndAll)} ORDER BY tk.id LIMIT 1`));
  const driverAId = pickFree('driver_id', 'drivers', winEndAll);
  const truckA = await send(admin, `/trucks/${truckAId}`);
  await send(admin, `/trucks/${truckAId}`, 'PUT', { licensePlate: truckA.body.licensePlate, currentTrailerId: trailerAId, status: 'ACTIVE' }, { 'If-Unmodified-Since': String(truckA.body.updatedAt) });

  const trailerB = await send(admin, '/trailers', 'POST', { licensePlate: `RS-S638B-${Date.now() % 100000}`, type: '40FT' });
  const trailerBId = trailerB.body?.id;
  const truckBId = Number(psql(`SELECT tk.id FROM trucks tk WHERE tk.deleted_at IS NULL AND tk.status = 'ACTIVE' AND tk.id <> ${truckAId} AND ${freeWithin('truck_id', 'tk.id', winEndAll)} ORDER BY tk.id DESC LIMIT 1`));
  const driverBId = pickFree('driver_id', 'drivers', winEndAll);
  const truckB = await send(admin, `/trucks/${truckBId}`);
  await send(admin, `/trucks/${truckBId}`, 'PUT', { licensePlate: truckB.body.licensePlate, currentTrailerId: trailerBId, status: 'ACTIVE' }, { 'If-Unmodified-Since': String(truckB.body.updatedAt) });
  log(`rig A truck=${truckAId} (moóc type null → capacity null), driver=${driverAId}`);
  log(`rig B truck=${truckBId} (moóc 40FT → capacity 30000), driver=${driverBId}`);

  // ── PROBE 1 — TC6(2) "unprovable" branch (QA's exact shape): lot-level
  // 60.000 kg, containers carry NO weight, moóc has NO type (capacity null).
  {
    const lot = await makeLot('UNPROV', { lotWeight: null, containerWeight: 60000, nContainers: 2 });
    unprovBl = lot.bl;
    log(`probe1 lot ${lot.bl} rows=${lot.rows.length}`);
    const [legA, legB] = lot.rows;
    const shipVer1b = shipVersion(lot.shipmentId);
    for (const row of [legA, legB]) {
      const patched = await send(dispatch, `/shipments/dispatch-detail-plan-rows/${row.fulfillmentId}/plan`, 'PATCH', {
        expectedFulfillmentVersion: ffVersion(row.fulfillmentId),
        expectedShipmentVersion: shipVer1b,
        carrierType: 'OWN', truckId: truckAId,
        classification: 'DOUBLE', plannedRevenue: 0, plannedCarrierCost: 0,
      });
      log(`probe1 plan-save fulfillment ${row.fulfillmentId} → ${patched.status} ${patched.status >= 400 ? JSON.stringify(patched.body).slice(0, 160) : ''}`);
    }
    const issue1 = await send(dispatch, `/shipments/${lot.shipmentId}/dispatch`, 'POST', {
      fulfillmentId: legA.fulfillmentId, expectedVersion: ffVersion(legA.fulfillmentId),
      plannedStartAt: at(8), plannedEndAt: at(12), endTimeConfirmed: true,
      carrierType: 'OWN', truckId: truckAId, driverId: driverAId, trailerId: trailerAId,
    });
    log(`probe1 issue leg1 → ${issue1.status} ${issue1.status >= 400 ? JSON.stringify(issue1.body).slice(0, 200) : `trip ${issue1.body?.trip?.id}`}`);
    const issue2 = await send(dispatch, `/shipments/${lot.shipmentId}/dispatch`, 'POST', {
      fulfillmentId: legB.fulfillmentId, expectedVersion: ffVersion(legB.fulfillmentId),
      plannedStartAt: at(8), plannedEndAt: at(12), endTimeConfirmed: true,
      carrierType: 'OWN', truckId: truckAId, driverId: driverAId, trailerId: trailerAId,
    });
    log(`probe1 issue leg2 → ${issue2.status} ${issue2.status >= 400 ? JSON.stringify(issue2.body).slice(0, 300) : `trip ${issue2.body?.trip?.id}`}`);
    const pairRow = psql(`SELECT id || '|' || pair_kind || '|' || status FROM trip_pairs
      WHERE first_trip_id IN (SELECT id FROM trips WHERE fulfillment_id IN (${legA.fulfillmentId},${legB.fulfillmentId}) AND deleted_at IS NULL)
        AND second_trip_id IN (SELECT id FROM trips WHERE fulfillment_id IN (${legA.fulfillmentId},${legB.fulfillmentId}) AND deleted_at IS NULL)
      ORDER BY id DESC LIMIT 1`);
    log(`probe1 trip_pairs row: '${pairRow || 'NONE'}'`);
    check('probe1 (TC6.2 unprovable): leg2 issue REFUSED with the soft warning (409 KEP_WEIGHT_WARNING)',
      issue2.status === 409 && JSON.stringify(issue2.body).includes('KEP_WEIGHT_WARNING'),
      `status=${issue2.status} body=${JSON.stringify(issue2.body).slice(0, 200)}`);
    check('probe1 (TC6.2 unprovable): NO silent pair row', pairRow === '', pairRow || 'no pair');
  }

  // ── PROBE 2 — TC6(2) "overload" branch: capacity KNOWN (40FT moóc),
  // containers 30.000 kg each (sum 60.000 > 30.000).
  {
    const lot = await makeLot('OVERLD', { lotWeight: null, containerWeight: 30000, nContainers: 2 });
    overldBl = lot.bl;
    log(`probe2 lot ${lot.bl} rows=${lot.rows.length}`);
    const driverDId = Number(psql(`SELECT d.id FROM drivers d JOIN users u ON u.id = d.user_id WHERE d.deleted_at IS NULL AND d.status = 'ACTIVE' AND u.deleted_at IS NULL AND u.status = 'ACTIVE' AND u.role = 'DRIVER' AND d.id <> ${driverAId} AND ${freeWithin('driver_id', 'd.id', winEndAll)} ORDER BY d.id DESC LIMIT 1`));
    log(`probe2 driver=${driverDId}`);
    const [legA, legB] = lot.rows;
    const shipVer2 = shipVersion(lot.shipmentId);
    for (const row of [legA, legB]) {
      await send(dispatch, `/shipments/dispatch-detail-plan-rows/${row.fulfillmentId}/plan`, 'PATCH', {
        expectedFulfillmentVersion: ffVersion(row.fulfillmentId),
        expectedShipmentVersion: shipVer2,
        carrierType: 'OWN', truckId: truckBId,
        classification: 'DOUBLE', plannedRevenue: 0, plannedCarrierCost: 0,
      });
    }
    const issue1 = await send(dispatch, `/shipments/${lot.shipmentId}/dispatch`, 'POST', {
      fulfillmentId: legA.fulfillmentId, expectedVersion: ffVersion(legA.fulfillmentId),
      plannedStartAt: at(8), plannedEndAt: at(12), endTimeConfirmed: true,
      carrierType: 'OWN', truckId: truckBId, driverId: driverDId, trailerId: trailerBId,
    });
    log(`probe2 issue leg1 → ${issue1.status} ${issue1.status >= 400 ? JSON.stringify(issue1.body).slice(0, 200) : `trip ${issue1.body?.trip?.id}`}`);
    const issue2 = await send(dispatch, `/shipments/${lot.shipmentId}/dispatch`, 'POST', {
      fulfillmentId: legB.fulfillmentId, expectedVersion: ffVersion(legB.fulfillmentId),
      plannedStartAt: at(8), plannedEndAt: at(12), endTimeConfirmed: true,
      carrierType: 'OWN', truckId: truckBId, driverId: driverDId, trailerId: trailerBId,
    });
    log(`probe2 issue leg2 → ${issue2.status} ${issue2.status >= 400 ? JSON.stringify(issue2.body).slice(0, 300) : `trip ${issue2.body?.trip?.id}`}`);
    check('probe2 (TC6.2 overload): leg2 issue REFUSED with the soft warning',
      issue2.status === 409 && JSON.stringify(issue2.body).includes('KEP_WEIGHT_WARNING'),
      `status=${issue2.status} body=${JSON.stringify(issue2.body).slice(0, 200)}`);
    // Confirmed retry proceeds (warn-once contract).
    const retry = await send(dispatch, `/shipments/${lot.shipmentId}/dispatch`, 'POST', {
      fulfillmentId: legB.fulfillmentId, expectedVersion: ffVersion(legB.fulfillmentId),
      plannedStartAt: at(8), plannedEndAt: at(12), endTimeConfirmed: true,
      carrierType: 'OWN', truckId: truckBId, driverId: driverDId, trailerId: trailerBId,
      kepWeightWarningConfirmed: true,
    });
    log(`probe2 confirmed retry → ${retry.status} ${retry.status >= 400 ? JSON.stringify(retry.body).slice(0, 200) : `trip ${retry.body?.trip?.id}`}`);
    check('probe2 (TC6.2 overload): confirmed retry proceeds', retry.status === 200 || retry.status === 201, `status=${retry.status}`);
  }

  // ── PROBE 3 — TC1: one lot, 4 ĐƠN legs, declared windows 08–12 / 14–18 /
  // 10–14 (overlap) / 18–22 on rig B (40FT, capacity sane, weights small).
  {
    // TC1's laws are window-scoped, so this busy shared DB only needs a
    // far-future day (nothing else lives there) and a rig with no IN_TRANSIT
    // trip at all (the driver-accept "xe đang chạy" gate is status-based).
    const day3 = new Date(Date.now() + 30 * 24 * 3600e3).toISOString().slice(0, 10);
    const at3 = (h) => new Date(`${day3}T${String(h).padStart(2, '0')}:00:00+07:00`).toISOString();
    const appointments = [
      { start: at3(8) }, { start: at3(14) }, { start: at3(10) }, { start: at3(18) },
    ];
    const lot = await makeLot('TC1', { lotWeight: 14000, containerWeight: 5000, nContainers: 4, appointments });
    log(`probe3 lot ${lot.bl} rows=${lot.rows.length}`);
    const truckCId = Number(psql(`SELECT tk.id FROM trucks tk WHERE tk.deleted_at IS NULL AND tk.status = 'ACTIVE'
      AND NOT EXISTS (SELECT 1 FROM trips t WHERE t.truck_id = tk.id AND t.deleted_at IS NULL AND t.status = 'IN_TRANSIT')
      AND NOT EXISTS (SELECT 1 FROM shipment_fulfillments sf WHERE sf.planned_vehicle_plate_number = tk.license_plate AND sf.canceled_at IS NULL)
      ORDER BY tk.id LIMIT 1`));
    const driverCId = Number(psql(`SELECT d.id FROM drivers d JOIN users u ON u.id = d.user_id WHERE d.deleted_at IS NULL AND d.status = 'ACTIVE' AND u.deleted_at IS NULL AND u.status = 'ACTIVE' AND u.role = 'DRIVER'
      AND NOT EXISTS (SELECT 1 FROM trips t WHERE t.driver_id = d.id AND t.deleted_at IS NULL AND t.status = 'IN_TRANSIT')
      ORDER BY d.id LIMIT 1`));
    log(`probe3 rig C truck=${truckCId} driver=${driverCId} (far day ${day3})`);
    const trailerC = await send(admin, '/trailers', 'POST', { licensePlate: `RS-S638C-${Date.now() % 100000}`, type: '40FT' });
    const trailerCId = trailerC.body?.id;
    const truckC = await send(admin, `/trucks/${truckCId}`);
    await send(admin, `/trucks/${truckCId}`, 'PUT', { licensePlate: truckC.body.licensePlate, currentTrailerId: trailerCId, status: 'ACTIVE' }, { 'If-Unmodified-Since': String(truckC.body.updatedAt) });
    log(`probe3 rig C truck=${truckCId} driver=${driverCId} trailer=${trailerCId}`);
    const rows = lot.rows.slice(0, 4);
    const ends = [at3(12), at3(18), at3(14), at3(22)];
    const planSave = async (row, end, confirm = false) => send(dispatch, `/shipments/dispatch-detail-plan-rows/${row.fulfillmentId}/plan`, 'PATCH', {
      expectedFulfillmentVersion: ffVersion(row.fulfillmentId),
      expectedShipmentVersion: shipVersion(lot.shipmentId),
      carrierType: 'OWN', truckId: truckCId,
      classification: 'SINGLE', plannedEndAt: end, plannedRevenue: 0, plannedCarrierCost: 0,
      ...(confirm ? { rigOverlapCompletedConfirmed: true } : {}),
    });
    // 1. assign A 08:00–12:00 → save clean.
    const a1 = await planSave(rows[0], ends[0]);
    log(`probe3 assign A 08:00-12:00 → ${a1.status} ${a1.status >= 400 ? JSON.stringify(a1.body).slice(0, 220) : ''}`);
    check('probe3.1 (TC1): A 08:00–12:00 saves', a1.status === 200, `status=${a1.status}`);
    // 2. assign B 14:00–18:00 (non-overlap) → the shift law SAVES.
    const b1 = await planSave(rows[1], ends[1]);
    log(`probe3 assign B 14:00-18:00 (pre-issue) → ${b1.status} ${b1.status >= 400 ? JSON.stringify(b1.body).slice(0, 220) : ''}`);
    check('probe3.2 (TC1): B 14:00–18:00 saves pre-issue (ca chiều, KHÔNG chặn 1 xe=1 lệnh/ngày)', b1.status === 200, `status=${b1.status}`);
    // 3. assign C 10:00–14:00 (overlaps A) → BLOCK.
    const c1 = await planSave(rows[2], ends[2]);
    log(`probe3 assign C 10:00-14:00 (overlap A) → ${c1.status} ${c1.status >= 400 ? JSON.stringify(c1.body).slice(0, 220) : ''}`);
    check('probe3.3 (TC1): C trùng giờ bị CHẶN', c1.status === 409, `status=${c1.status}`);
    // 4. issue A, then driver accepts → IN_TRANSIT.
    const issuedA = await send(dispatch, `/shipments/${lot.shipmentId}/dispatch`, 'POST', {
      fulfillmentId: rows[0].fulfillmentId, expectedVersion: ffVersion(rows[0].fulfillmentId),
      plannedStartAt: at3(8), plannedEndAt: at3(12), endTimeConfirmed: true,
      carrierType: 'OWN', truckId: truckCId, driverId: driverCId, trailerId: trailerCId,
    });
    log(`probe3 issue A → ${issuedA.status} ${issuedA.status >= 400 ? JSON.stringify(issuedA.body).slice(0, 220) : `trip ${issuedA.body?.trip?.id}`}`);
    const tripAId = issuedA.body?.trip?.id;
    const driverUsername = psql(`SELECT u.username FROM drivers d JOIN users u ON u.id = d.user_id WHERE d.id = ${driverCId}`);
    const drv = await login(driverUsername);
    const fid = rows[0].fulfillmentId;
        const accepted = tripAId != null
      ? await send(drv, `/driver/me/fulfillments/${fid}/progress`, 'POST', { eventType: 'ORDER_RECEIVED', occurredAt: new Date().toISOString(), expectedVersion: tripVersion(tripAId) })
      : { status: 'skipped-issue-failed' };
    log(`probe3 driver accepts A → ${accepted.status} ${accepted.status >= 400 ? JSON.stringify(accepted.body).slice(0, 220) : ''}`);
        const statusA = tripAId != null ? psql(`SELECT status FROM trips WHERE id = ${tripAId}`) : 'NO_TRIP';
    check('probe3.4 (TC1): leg A IN_TRANSIT after accept', statusA === 'IN_TRANSIT', `status=${statusA}`);
    // 5. assign D 18:00–22:00 same truck while A IN_TRANSIT — the QA case:
    // expectation = NOT silent ("xe đang bận thực hiện lệnh chưa hoàn tất").
    const d1 = await planSave(rows[3], ends[3]);
    log(`probe3 assign D 18:00-22:00 (A IN_TRANSIT) → ${d1.status} ${d1.status >= 400 ? JSON.stringify(d1.body).slice(0, 300) : ''}`);
    check('probe3.5 (TC1): D 18:00 không lưu im lặng khi xe đang chạy (cảnh báo xe bận)',
      d1.status === 409, `status=${d1.status} body=${JSON.stringify(d1.body).slice(0, 240)}`);
    // 6. The warn is confirmable — the dispatcher's confirmed retry proceeds
    // (rotation "xoay vòng ca sáng/chiều" stays possible, never 1 lệnh/ngày).
    const d2 = await planSave(rows[3], ends[3], true);
    log(`probe3 assign D confirmed retry → ${d2.status} ${d2.status >= 400 ? JSON.stringify(d2.body).slice(0, 220) : ''}`);
    check('probe3.6 (TC1): cảnh báo xe bận confirmable — retry được xác nhận lưu tiếp', d2.status === 200, `status=${d2.status}`);
  }

  log(failures === 0 ? 'REPRO COMPLETE — all expectation probes PASS (laws live)' : `REPRO COMPLETE — ${failures} expectation(s) FAILED (bug reproduced)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => { log(`PROBE CRASHED: ${err.message}`); process.exit(2); });
