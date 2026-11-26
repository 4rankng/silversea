// SIL-1020 + SIL-1021 round-27 FAIL harvest — verify-first API probe.
// LOCAL dev only (BE :3002, db container ss-prod-db). Never staging.
//
//   node qa/scripts/2026-11-26-sil1020-1021-repro.mjs
//
// Repro of Muse QA 23:27Z/23:30Z 25/11 on staging 55c063cc:
//   1020: fresh KEP pair still renders PHÂN LOẠI 'Đơn' on dispatch-detail
//         (row.classification) and shipments-detail (cus-workspace container
//         flat row classification) while the driver app shows KẸP.
//   1021: unpair succeeds but (a) both legs keep the same truck + window
//         (double-booked) and (b) re-pairing the same two trips 409s with
//         'first_trip_id, second_trip_id đã tồn tại' (full unique index
//         trip_pairs_trip_order_uniq_idx still held by the broken row).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const API = 'http://127.0.0.1:3002/api';
const OUT = path.resolve('qa/2026-11-26_sil1020-1021_repro');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, 'repro-driver.log');
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

// Both legs share the SAME window — the QA repro shape (xe 15C-167.31 at
// 26/11 08:00). KEP needs the same departure DAY, not distinct windows.
const startAt = new Date(Date.now() + 8 * 3600e3);
startAt.setMinutes(0, 0, 0);
const endAt = new Date(startAt.getTime() + 4 * 3600e3);
const day = startAt.toISOString().slice(0, 10);
const win = () => ({ start: startAt.toISOString(), end: endAt.toISOString() });
const windows = [win(), win()];
const freeWithin = (column, id) => `NOT EXISTS (
  SELECT 1 FROM trips t WHERE t.${column} = ${id} AND t.deleted_at IS NULL AND t.status IN ('CREATED','IN_TRANSIT')
    AND t.planned_start_at < '${endAt.toISOString()}'::timestamptz
    AND coalesce(t.planned_end_at, t.planned_start_at + interval '8 hours') > '${startAt.toISOString()}'::timestamptz)`;

(async () => {
  const dispatch = await login('dungnv');
  const admin = await login('admin');
  log(`logged in dieuvan/admin — window ${windows[0].start} (both legs identical)`);

  // Housekeeping: cancel THIS probe's earlier trips so reruns find a free rig.
  const stale = psql(`SELECT t.id, t.version FROM trips t
    JOIN shipment_fulfillments sf ON sf.id = t.fulfillment_id
    JOIN shipments sh ON sh.id = sf.shipment_id
    WHERE sh.bl_number LIKE 'BK-S1021R-%' AND t.deleted_at IS NULL
      AND t.status IN ('CREATED','IN_TRANSIT') ORDER BY t.id`).split('\n').filter(Boolean);
  for (const entry of stale) {
    const [tripId, version] = entry.split('|').map(Number);
    const cancel = await send(admin, `/trips/${tripId}/cancel`, 'POST', { expectedVersion: version, reason: 'S1021 repro housekeeping' });
    log(`housekeeping: cancel trip ${tripId} → ${cancel.status}`);
  }

  // Free rig + driver for the shared window.
  const truckId = Number(psql(`SELECT tk.id FROM trucks tk WHERE tk.deleted_at IS NULL AND tk.status = 'ACTIVE' AND ${freeWithin('truck_id', 'tk.id')} ORDER BY tk.id LIMIT 1`));
  const driverId = Number(psql(`SELECT d.id FROM drivers d JOIN users u ON u.id = d.user_id
    WHERE d.deleted_at IS NULL AND d.status = 'ACTIVE' AND u.deleted_at IS NULL AND u.status = 'ACTIVE' AND u.role = 'DRIVER'
      AND ${freeWithin('driver_id', 'd.id')} ORDER BY d.id LIMIT 1`));
  check('setup: free truck + driver', Number.isInteger(truckId) && truckId > 0 && Number.isInteger(driverId) && driverId > 0, `truck=${truckId} driver=${driverId}`);

  // Fresh FCL lot with two 20' containers, submitted for dispatch.
  const [ctypesRes, portsRes, customersRes] = await Promise.all([
    send(admin, '/container-types?limit=50'),
    send(admin, '/ports?limit=50'),
    send(admin, '/customers?limit=100'),
  ]);
  const type20 = (ctypesRes.body?.items ?? []).find((t) => /^20/.test(t.code ?? ''));
  const ports = portsRes.body?.items ?? [];
  const customer = (customersRes.body?.items ?? []).find((c) => c.status === 'ACTIVE' && !c.isCarrier);
  const sitesRes = await send(admin, `/shipments/operational-sites?customerId=${customer.id}`);
  const site = (sitesRes.body?.items ?? []).find((x) => x.siteType === 'FACTORY') ?? null;
  // Route must match the factory's configured route (the container reconcile
  // refuses a mismatch) AND be priced in the local DB — a site-configured
  // route wins; otherwise the most-used real container route.
  const siteRouteId = site?.routeId != null ? Number(site.routeId) : null;
  const pricedRouteId = Number(psql(`SELECT sc.route_id FROM shipment_containers sc
    JOIN shipments s ON s.id = sc.shipment_id
    WHERE sc.route_id IS NOT NULL AND s.deleted_at IS NULL
    GROUP BY sc.route_id ORDER BY count(*) DESC LIMIT 1`));
  const routeId = siteRouteId ?? pricedRouteId;
  const routesRes = await send(admin, `/routes?limit=100`);
  const route = (routesRes.body?.items ?? []).find((r) => r.id === routeId) ?? (routesRes.body?.items ?? [])[0];
  check('setup: reference data', Boolean(route && type20 && ports.length >= 1 && customer && site), `route=${route?.id} type20=${type20?.id} site=${site?.id}`);
  const bl = `BK-S1021R-${Date.now()}`;
  const created = await send(admin, '/shipments', 'POST', {
    customerId: customer.id, tradeDirection: 'IMPORT', cargoMode: 'FCL',
    blNumber: bl, expectedDeliveryDate: day, cargoWeightKg: 14000,
  });
  check('setup: lot created', created.status === 201, JSON.stringify(created.body).slice(0, 120));
  const shipmentId = created.body?.shipment?.id ?? created.body?.id;
  const cur = await send(admin, `/shipments/${shipmentId}`);
  const curVersion = cur.body?.version ?? cur.body?.shipment?.version ?? 0;
  const serialBase = Number(String(Date.now()).slice(-6));
  const check10 = (prefix10) => {
    const MAP = { A: 10, B: 12, C: 13, D: 14, E: 15, F: 16, G: 18, H: 19, I: 20, J: 21, K: 22, L: 23, M: 24, N: 25, O: 26, P: 27, Q: 28, R: 29, S: 30, T: 31, U: 32, V: 34, W: 35, X: 36, Y: 37, Z: 38 };
    let sum = 0; const POW = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512];
    [...prefix10].forEach((ch, i) => { sum += (/\d/.test(ch) ? Number(ch) : MAP[ch]) * POW[i]; });
    return `${prefix10}${sum % 11 === 10 ? 0 : sum % 11}`;
  };
  const conts = await send(admin, `/shipments/${shipmentId}/containers`, 'PUT', {
    expectedVersion: curVersion,
    containers: [0, 1].map((i) => ({
      containerNumber: check10(`TSTU${String(serialBase + i).padStart(6, '0')}`),
      containerTypeId: type20.id, routeId: route.id,
      ...(site ? { operationalSiteId: site.id } : {}),
      pickupPortId: (ports[0] ?? ports[1]).id, dropoffPortId: (ports[1] ?? ports[0]).id,
      cargoWeightKg: 14000,
    })),
  });
  check(`setup: two 20' containers declared (${bl})`, conts.status === 200 || conts.status === 201, JSON.stringify(conts.body).slice(0, 120));
  const after = await send(admin, `/shipments/${shipmentId}`);
  const submitted = await send(admin, `/shipments/${shipmentId}/submit-for-dispatch`, 'POST', { expectedVersion: after.body?.version ?? after.body?.shipment?.version ?? curVersion });
  check('setup: lot submitted', submitted.status === 200 || submitted.status === 201, JSON.stringify(submitted.body).slice(0, 100));

  // Issue BOTH legs on the SAME truck+driver+window (the double-booked shape).
  const rows = await send(dispatch, `/shipments/dispatch-detail-plan-rows?q=${encodeURIComponent(bl)}&limit=50`);
  const candidates = (rows.body?.items ?? []).filter((r) => r.dispatch?.tripId == null && r.dispatch?.carrierType !== 'EXTERNAL').slice(0, 2);
  check('setup: two unissued rows found', candidates.length === 2, `got ${candidates.length}`);
  const trips = [];
  for (const [i, row] of candidates.entries()) {
    const issued = await send(dispatch, `/shipments/${shipmentId}/dispatch`, 'POST', {
      fulfillmentId: row.fulfillmentId, expectedVersion: row.version,
      plannedStartAt: windows[i].start, plannedEndAt: windows[i].end,
      endTimeConfirmed: true, carrierType: 'OWN',
      truckId, driverId,
      // Both legs share the rig+window by design (QA repro shape) — confirm
      // the same-rig overlap advisory like the dispatcher's Vẫn lưu? click.
      rigOverlapCompletedConfirmed: true,
    });
    check(`setup: issued leg ${i + 1} (fulfillment ${row.fulfillmentId})`, issued.status === 201 || issued.status === 200, JSON.stringify(issued.body).slice(0, 140));
    trips.push(issued.body?.trip?.id);
  }
  const fulfillmentOf = (tripId) => Number(psql(`SELECT fulfillment_id FROM trips WHERE id = ${tripId}`));
  const fulfillments = trips.map(fulfillmentOf).filter((id) => Number.isInteger(id) && id > 0);
  log(`trips ${trips.join('+')} fulfillments ${fulfillments.join('+')}`);
  if (fulfillments.length !== 2) {
    log('setup incomplete — aborting before pair (see FAIL lines above)');
    process.exit(1);
  }

  // ── SIL-1020: pair KEP, then read both screens' classification sources. ──
  const draftOf = (tripId) => {
    const row = psql(`SELECT version, planned_start_at, planned_end_at, canonical_origin, canonical_destination, cargo_weight_kg, vehicle_capacity_kg FROM trips WHERE id = ${tripId}`);
    const [version, plannedStartAt, plannedEndAt, origin, destination, cargo, capacity] = row.split('|');
    return {
      expectedVersion: Number(version),
      plannedStartAt: new Date(plannedStartAt + 'Z').toISOString(),
      plannedEndAt: new Date(plannedEndAt + 'Z').toISOString(),
      canonicalOrigin: origin === '' ? 'Cảng QA' : origin,
      canonicalDestination: destination === '' ? 'Cảng QA' : destination,
      cargoWeightKg: cargo === '' ? 0 : Number(cargo),
      vehicleCapacityKg: capacity === '' ? null : Number(capacity),
    };
  };
  const drafts = trips.map(draftOf);
  log(`drafts: ${JSON.stringify(drafts)}`);
  const paired = await send(dispatch, '/trips/pairs', 'POST', {
    firstTripId: trips[0], secondTripId: trips[1], pairKind: 'KEP',
    firstTrip: drafts[0], secondTrip: drafts[1],
  });
  check('1020: KEP pair created', paired.status === 201, JSON.stringify(paired.body).slice(0, 200));
  const pairId = paired.body?.id;
  const dbStamp = psql(`SELECT id, dispatch_classification, version FROM shipment_fulfillments WHERE id IN (${fulfillments.join(',')}) ORDER BY id`).split('\n');
  log(`db fulfillment rows after pair: ${dbStamp.join(' | ')}`);
  check('1020: DB stamp DOUBLE on both fulfillments', dbStamp.length === 2 && dbStamp.every((r) => r.includes('DOUBLE')), dbStamp.join(' | '));

  const gridAfter = await send(dispatch, `/shipments/dispatch-detail-plan-rows?q=${encodeURIComponent(bl)}&limit=50`);
  const gridClass = (gridAfter.body?.items ?? []).map((r) => `${r.fulfillmentId}:${r.classification}:pair=${r.dispatch?.pairKind ?? '-'}`);
  log(`dispatch-detail rows: ${gridClass.join(' | ')}`);
  check('1020: dispatch-detail classification != Đơn on both rows', (gridAfter.body?.items ?? []).filter((r) => fulfillments.includes(r.fulfillmentId)).every((r) => r.classification === 'DOUBLE'), gridClass.join(' | '));

  const ws = await send(dispatch, `/shipments/cus-workspace/containers?searchSuffix=${encodeURIComponent(bl)}&limit=50`);
  const flat = (ws.body?.items ?? [])
    .filter((r) => r.shipmentId === shipmentId)
    .map((r) => `${r.containerNumber}:${r.classification}`);
  log(`shipments-detail container classifications (${ws.status}, ${(ws.body?.items ?? []).length} rows): ${flat.join(' | ')}`);
  check('1020: shipments-detail container rows != Đơn', flat.length === 2 && flat.every((f) => f.endsWith('DOUBLE')), flat.join(' | '));

  // ── SIL-1021: unpair, inspect schedule + re-pair feasibility. ──
  const tripRowBefore = psql(`SELECT id, truck_id, driver_id, planned_start_at, status FROM trips WHERE id IN (${trips.join(',')}) ORDER BY id`).split('\n');
  log(`trips before unpair: ${tripRowBefore.join(' | ')}`);
  const unpaired = await send(dispatch, `/trips/pairs/${pairId}/unpair`, 'POST', {});
  check('1021: unpair succeeded', unpaired.status === 200, JSON.stringify(unpaired.body).slice(0, 160));
  const tripRowAfter = psql(`SELECT id, truck_id, driver_id, planned_start_at, planned_end_at, status FROM trips WHERE id IN (${trips.join(',')}) ORDER BY id`).split('\n');
  log(`trips after unpair: ${tripRowAfter.join(' | ')}`);
  const pairRowAfter = psql(`SELECT id, status, break_reason FROM trip_pairs WHERE id = ${pairId}`);
  log(`pair row after unpair: ${pairRowAfter}`);

  // (b) re-pair the SAME two trips — K3.50 'thử lại không nhân đôi' + the
  // round-27 blocker: the broken row must not hold the unique key.
  const repair1 = await send(dispatch, '/trips/pairs', 'POST', {
    firstTripId: trips[0], secondTripId: trips[1], pairKind: 'KEP',
    firstTrip: trips.map(draftOf)[0], secondTrip: trips.map(draftOf)[1],
  });
  log(`re-pair attempt #1 → ${repair1.status} ${JSON.stringify(repair1.body).slice(0, 200)}`);
  check('1021: re-pair same two trips returns 201', repair1.status === 201, `got ${repair1.status}`);

  // (a) end-state schedule: two surviving Đơn legs must not share the rig in
  // the same window after unpair (K3.50 'không để lịch trùng').
  // NOTE: this is evaluated on the CURRENT unpair end-state — the re-pair
  // above (when green) restores the shared rig legitimately; the overlap law
  // is pinned by the unit test, this probe observes the pre-fix end state.
  if (repair1.status !== 201) {
    const both = tripRowAfter.map((r) => r.split('|'));
    const overlap = both.length === 2 && both[0][1] === both[1][1] && both[0][3] === both[1][3];
    log(`overlap check on unpair end-state: truck=${both[0]?.[1]}/${both[1]?.[1]} start=${both[0]?.[3]}/${both[1]?.[3]} → ${overlap ? 'OVERLAP REMAINS' : 'no overlap'}`);
  }

  log(failures === 0 ? 'ALL GREEN' : `${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => { log(`PROBE ERROR: ${err.message} | cause: ${err.cause?.message ?? err.cause?.code ?? '-'}`); console.error(err); process.exit(2); });
