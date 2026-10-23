#!/usr/bin/env node
/**
 * Wave4 staging verify driver (build 11720424 on vantai.tingting.vip — the
 * Makefile "demo server" / staging; prod silversea.tingting.vip untouched).
 *
 * Mission pin said "build f3a2ec5d at demo.tingting.vip" — evidence in the
 * report shows demo.tingting.vip is a stale vhost on the SAME staging server
 * (167.172.76.214) whose FE bundle lacks the wave4 code; the deployed wave4
 * build lives at vantai.tingting.vip (buildHash = main HEAD 11720424).
 *
 * Cases:
 *   c1 — cargoMode filter on dispatch-detail-plan-rows (fix 171026154000)
 *   c2 — FB-038/072 verify-fail 3 overlap guard (fix-fb038-overlap-silent-glm @ 9d109c0d)
 *   c3 — Cước trả ĐV group-cost lookup on issue (fix 171026142500)
 *   c4setup — fixtures for the container-buttons UI case (fix 171026182554)
 *   teardown/census — product deletes + registry purge check
 *
 * Every write carries an Idempotency-Key. All fixtures are named QA-W4-*.
 * State persists to state.json; full log in driver.log.
 */
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const API = 'https://vantai.tingting.vip/api';
const EXPECT_BUILD = '11720424';
const DIR = new URL('.', import.meta.url).pathname;
const STATE_FILE = `${DIR}state.json`;
const LOG_FILE = `${DIR}driver.log`;
const TS = () => new Date().toISOString();
const rand = Math.random().toString(16).slice(2, 8).toUpperCase();

function log(line) {
  appendFileSync(LOG_FILE, `${TS()} ${line}\n`);
  console.log(line);
}
function save(state) { writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); }
function load() { return existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : {}; }

const failures = [];
function check(name, cond, detail) {
  const verdict = cond ? 'PASS' : 'FAIL';
  log(`  [${verdict}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures.push({ name, detail });
  return cond;
}

async function api(token, method, path, body, idem, extraHeaders = {}) {
  const headers = { 'Content-Type': 'application/json', ...extraHeaders };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (method !== 'GET') headers['Idempotency-Key'] = idem ?? randomUUID();
  const res = await fetch(`${API}${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}

/** Read-only SQL against the staging DB container (evidence gathering). */
function psql(sql) {
  const b64 = Buffer.from(sql, 'utf8').toString('base64');
  const out = execSync(
    `ssh -o BatchMode=yes -o ConnectTimeout=10 root@vantai.tingting.vip ` +
    `"docker exec vantai-postgres-1 sh -c 'printf %s ${b64} | base64 -d > /tmp/w4.sql && psql -U \\"\\$POSTGRES_USER\\" -d \\"\\$POSTGRES_DB\\" -At -v ON_ERROR_STOP=1 -f /tmp/w4.sql && rm -f /tmp/w4.sql'"`,
    { encoding: 'utf8', timeout: 30000 },
  );
  return out.trim();
}

async function login(state, key, identifier) {
  const res = await api(null, 'POST', '/auth/login', { identifier, password: 'Abc123' });
  check(`login ${identifier}`, res.status === 200 && !!res.json.token, `status ${res.status}`);
  state[key] = res.json.token;
  return res.json.token;
}

const phase = process.argv[2];
if (!phase) {
  console.error('usage: node driver.mjs <health|recon|c1|c2|restore|c3|c4setup|teardown|census>');
  process.exit(2);
}

const state = load();
state.idem ??= {};

// ── phase: health ───────────────────────────────────────────────────────────
if (phase === 'health') {
  const v = await fetch(`${API}/health`).then((r) => r.json());
  log(`vantai health: ${JSON.stringify(v)}`);
  check('health gate: staging buildHash = wave4 build', v.buildHash === EXPECT_BUILD, `got ${v.buildHash}, expected ${EXPECT_BUILD}`);
  const d = await fetch('https://demo.tingting.vip/api/health').then((r) => r.json());
  log(`demo.tingting.vip health (mission pin): ${JSON.stringify(d)}`);
  check("mission-pin literal gate: demo vhost reports 'f3a2ec5d'", d.build === 'f3a2ec5d' || d.buildHash === 'f3a2ec5d', `got build=${d.build} buildHash=${d.buildHash}`);
  // Bundle discriminator: wave4 case-1 FE code introduces `cargoMode` into the
  // dispatch filter client; a bundle without it cannot be carrying wave4.
  for (const host of ['vantai.tingting.vip', 'demo.tingting.vip']) {
    const html = await fetch(`https://${host}/`).then((r) => r.text());
    const m = html.match(/\/assets\/index[^"']+\.js/);
    const bundle = m ? await fetch(`https://${host}${m[0]}`).then((r) => r.text()) : '';
    const hits = (bundle.match(/cargoMode/g) || []).length;
    log(`  bundle ${host} ${m?.[0] ?? '(none)'}: cargoMode occurrences = ${hits}`);
    if (host === 'vantai.tingting.vip') check('staging FE bundle carries wave4 cargoMode filter code', hits > 0, `${hits} hits`);
    else log(`  (demo vhost: ${hits === 0 ? 'NO wave4 code — stale deployment' : 'has wave4 code'})`);
  }
  save(state);
  if (failures.length) process.exit(1);
}

// ── phase: recon — c2 entities (read-only) ─────────────────────────────────
if (phase === 'recon') {
  const adm = await login(state, 'admin', 'admin');
  const lot = await api(adm, 'GET', '/shipments/298');
  log(`GET /api/shipments/298 → ${lot.status}`);
  const lotBody = lot.json.shipment ?? lot.json;
  log(`  lot 298: bl=${lotBody.blNumber} cargoMode=${lotBody.cargoMode} status=${lotBody.status} expectedDeliveryDate=${lotBody.expectedDeliveryDate}`);
  const trip = await api(adm, 'GET', '/trips/117');
  log(`GET /api/trips/117 → ${trip.status}`);
  const t = trip.json.trip ?? trip.json;
  log(`  trip 117: status=${t.status} departureDate=${t.departureDate} plannedStartAt=${t.plannedStartAt} truckId=${t.truckId} plate=${t.truck?.licensePlate ?? t.plateNumber ?? t.licensePlate ?? '(none)'}`);
  // Plan rows ff 198/199 — scan the wide window, filter by fulfillmentId.
  let found = [];
  for (let page = 1; page <= 20 && found.length < 2; page += 1) {
    const rows = await api(adm, 'GET',
      `/shipments/dispatch-detail-plan-rows?page=${page}&limit=50&dateFrom=2026-01-01&dateTo=2027-01-01&q=${encodeURIComponent(lotBody.blNumber ?? '')}`);
    const items = rows.json.items ?? [];
    log(`  plan-rows page ${page}: ${items.length} items (total ${rows.json.total})`);
    if (items.length === 0) break;
    found = items.filter((r) => r.fulfillmentId === 198 || r.fulfillmentId === 199);
  }
  for (const r of found) {
    log(`  ff ${r.fulfillmentId}: version=${r.version} cargoMode=${r.cargoMode} containerId=${r.shipmentContainerId} deliveryDate=${r.time?.deliveryDate} taskStatus=${r.taskStatus} plate=${r.dispatch?.assignedPlate ?? '(?)'}`);
  }
  check('recon: ff 198 + ff 199 both visible on plan rows', found.length === 2, `found ${found.map((r) => r.fulfillmentId).join(',')}`);
  check('recon: ff 198/199 are FCL container-less (the FB-038-03A shape)',
    found.every((r) => r.cargoMode === 'FCL' && (r.shipmentContainerId == null)),
    found.map((r) => `ff${r.fulfillmentId}:${r.cargoMode}/cont=${r.shipmentContainerId}`).join(' '));
  state.c2 = {
    lot298: { bl: lotBody.blNumber, cargoMode: lotBody.cargoMode, status: lotBody.status, expectedDeliveryDate: lotBody.expectedDeliveryDate },
    trip117: {
      status: t.status, departureDate: t.departureDate, plannedStartAt: t.plannedStartAt ?? null,
      plate: t.truck?.licensePlate ?? t.plateNumber ?? t.licensePlate ?? null,
    },
    rows: found.map((r) => ({
      fulfillmentId: r.fulfillmentId, version: r.version, cargoMode: r.cargoMode,
      shipmentId: r.shipmentId, shipmentVersion: r.shipmentVersion,
      shipmentContainerId: r.shipmentContainerId, deliveryDate: r.time?.deliveryDate,
      taskStatus: r.taskStatus,
      plate: r.dispatch?.assignedPlate ?? null,
    })),
  };
  save(state);
  log(`recon c2 fixture read-only done. trip117=${JSON.stringify(state.c2.trip117)}`);
  if (failures.length) process.exit(1);
}

// ── phase: c1 — cargoMode filter (API, read-only) ──────────────────────────
if (phase === 'c1') {
  await login(state, 'dispatcher', 'dungnv');
  const tk = state.dispatcher;
  const window = 'dateFrom=2026-10-01&dateTo=2026-10-31';
  const dist = (items) => items.reduce((acc, r) => { acc[r.cargoMode] = (acc[r.cargoMode] ?? 0) + 1; return acc; }, {});

  const base = await api(tk, 'GET', `/shipments/dispatch-detail-plan-rows?page=1&limit=50&${window}`);
  log(`C1-0 baseline (no cargoMode): total=${base.json.total} counts=${JSON.stringify(base.json.assignmentStatusCounts)} page1 modes=${JSON.stringify(dist(base.json.items))}`);
  check('C1-0 baseline 200 with items', base.status === 200 && (base.json.items ?? []).length > 0, `status ${base.status}`);

  const lcl = await api(tk, 'GET', `/shipments/dispatch-detail-plan-rows?page=1&limit=50&${window}&cargoMode=LCL`);
  const lclItems = lcl.json.items ?? [];
  log(`C1-1 LCL filter: total=${lcl.json.total} page1 modes=${JSON.stringify(dist(lclItems))} counts=${JSON.stringify(lcl.json.assignmentStatusCounts)}`);
  check('C1-1a cargoMode=LCL accepted (200, total>0)', lcl.status === 200 && lcl.json.total > 0, `status ${lcl.status} total=${lcl.json.total}`);
  check('C1-1b every page-1 row is LCL', lclItems.length > 0 && lclItems.every((r) => r.cargoMode === 'LCL'), `modes ${JSON.stringify(dist(lclItems))}`);
  check('C1-1c page 1 reaches LCL rows without pagination', lclItems.some((r) => r.cargoMode === 'LCL'), `${lclItems.length} rows`);
  const lclCounts = lcl.json.assignmentStatusCounts ?? {};
  check('C1-1d assignmentStatusCounts partitions the filtered total',
    (lclCounts.UNASSIGNED ?? 0) + (lclCounts.ASSIGNED ?? 0) === lcl.json.total,
    `UNASSIGNED ${lclCounts.UNASSIGNED} + ASSIGNED ${lclCounts.ASSIGNED} vs total ${lcl.json.total}`);

  const fcl = await api(tk, 'GET', `/shipments/dispatch-detail-plan-rows?page=1&limit=50&${window}&cargoMode=FCL`);
  const fclItems = fcl.json.items ?? [];
  log(`C1-2 FCL filter: total=${fcl.json.total} page1 modes=${JSON.stringify(dist(fclItems))} counts=${JSON.stringify(fcl.json.assignmentStatusCounts)}`);
  check('C1-2a every page-1 row is FCL', fclItems.length > 0 && fclItems.every((r) => r.cargoMode === 'FCL'), `modes ${JSON.stringify(dist(fclItems))}`);
  const fclCounts = fcl.json.assignmentStatusCounts ?? {};
  check('C1-2b counts partition FCL total',
    (fclCounts.UNASSIGNED ?? 0) + (fclCounts.ASSIGNED ?? 0) === fcl.json.total,
    `UNASSIGNED ${fclCounts.UNASSIGNED} + ASSIGNED ${fclCounts.ASSIGNED} vs total ${fcl.json.total}`);

  const base2 = await api(tk, 'GET', `/shipments/dispatch-detail-plan-rows?page=1&limit=50&${window}`);
  const ids1 = (base.json.items ?? []).map((r) => r.fulfillmentId ?? r.shipmentContainerId);
  const ids2 = (base2.json.items ?? []).map((r) => r.fulfillmentId ?? r.shipmentContainerId);
  check('C1-3 omitted param unchanged (same rows, same order)', JSON.stringify(ids1) === JSON.stringify(ids2) && base.json.total === base2.json.total,
    `total ${base.json.total} vs ${base2.json.total}`);

  const bad = await api(tk, 'GET', `/shipments/dispatch-detail-plan-rows?page=1&limit=50&${window}&cargoMode=XXL`);
  log(`C1-4 invalid value: status=${bad.status} body=${JSON.stringify(bad.json).slice(0, 200)}`);
  check('C1-4 invalid cargoMode → 400 Vietnamese', bad.status === 400 && /cargoMode không hợp lệ/.test(String(bad.json.message ?? bad.json.error ?? '')),
    `status ${bad.status}`);

  // Wide-window totals: LCL-filter total must equal the LCL rows counted across
  // the unfiltered pagination (the "total equals the LCL count" contract).
  let page = 1; let seen = { FCL: 0, LCL: 0 };
  for (;;) {
    const r = await api(tk, 'GET', `/shipments/dispatch-detail-plan-rows?page=${page}&limit=50&${window}`);
    const items = r.json.items ?? [];
    if (items.length === 0) break;
    for (const it of items) seen[it.cargoMode] = (seen[it.cargoMode] ?? 0) + 1;
    if (page * 50 >= r.json.total) break;
    page += 1;
  }
  log(`C1-5 unfiltered scan over ${page} pages: ${JSON.stringify(seen)}`);
  check('C1-5 LCL-filter total equals the unfiltered LCL count', lcl.json.total === seen.LCL,
    `filter total ${lcl.json.total} vs scanned LCL ${seen.LCL}`);
  check('C1-5b FCL-filter total equals the unfiltered FCL count', fcl.json.total === seen.FCL,
    `filter total ${fcl.json.total} vs scanned FCL ${seen.FCL}`);

  writeFileSync(`${DIR}evidence-c1.json`, JSON.stringify({
    baseline: { total: base.json.total, counts: base.json.assignmentStatusCounts, page1Modes: dist(base.json.items) },
    lcl: { total: lcl.json.total, counts: lclCounts, page1Modes: dist(lclItems) },
    fcl: { total: fcl.json.total, counts: fclCounts, page1Modes: dist(fclItems) },
    scanned: seen,
  }, null, 2));
  save(state);
  if (failures.length) process.exit(1);
}

// ── phase: c2 — overlap guard writes on the FB-038 repro rows ──────────────
if (phase === 'c2') {
  const tk = await login(state, 'dispatcher', 'dungnv');
  const c2 = state.c2;
  if (!c2) { log('ABORT: run recon first'); process.exit(2); }
  const QAPLATE = `QA-W4OV-${rand}`.slice(0, 20);
  const idem = (tag) => { const k = `QA-W4-c2-${tag}-${rand}`; state.idem[tag] = k; return k; };
  const adm2 = await login(state, 'admin', 'admin');

  // QA-W4 carrier customer — rows take an EXTERNAL carrier first, then a
  // free-text external plate. A unique QA plate keeps these drives clear of
  // every real rig (a `truckId` pick would collide with live fleet claims).
  const car = await api(adm2, 'POST', '/customers', { name: `QA-W4 BX2 ${rand}`, isCarrier: true, status: 'ACTIVE' }, idem('c2-carrier'));
  const carId = car.json.id ?? car.json.data?.id;
  state.c2extra ??= { lots: [], tripIds: [], customerIds: [] };
  state.c2extra.lots ??= [];
  state.c2extra.tripIds = (state.c2extra.tripIds ?? []).filter(Boolean);
  state.c2extra.customerIds ??= [];
  state.c2extra.customerIds.push(carId);
  log(`C2 QA carrier customer: id=${carId} status=${car.status}`);

  const row198 = c2.rows.find((r) => r.fulfillmentId === 198);
  const row199 = c2.rows.find((r) => r.fulfillmentId === 199);
  const before198 = row198.plate;
  const before199 = row199.plate;
  log(`C2 before-state: ff198 plate=${before198} v${row198.version}; ff199 plate=${before199} v${row199.version}`);

  const assignCarrier = async (ff, version) => api(tk, 'PATCH', `/shipments/dispatch-detail-plan-rows/${ff}/carrier`,
    { expectedVersion: version, carrierType: 'EXTERNAL', externalCarrierId: carId }, idem(`c2-car-${ff}`));
  const allRows = async () => {
    const out = [];
    for (let p = 1; p <= 20; p += 1) {
      const rows = await api(tk, 'GET', `/shipments/dispatch-detail-plan-rows?page=${p}&limit=50&dateFrom=2026-01-01&dateTo=2027-01-01`);
      const items = rows.json.items ?? [];
      out.push(...items);
      if (items.length === 0 || out.length >= (rows.json.total ?? 0)) break;
    }
    return out;
  };
  const freshRow = async (ff) => (await allRows()).find((r) => r.fulfillmentId === ff);
  const c198 = await assignCarrier(198, (await freshRow(198)).version);
  log(`C2-0 ff198 carrier assign: status=${c198.status}`);
  const v198 = (await freshRow(198)).version;

  // FB038-03A — same plate on two container-less rows of the SAME lot/day:
  // second save must warn once (409 RIG_OVERLAP_COMPLETED), never save silently.
  const a1 = await api(tk, 'PATCH', '/shipments/dispatch-detail-plan-rows/198/plate',
    { expectedVersion: v198, plateNumber: QAPLATE }, idem('c2-a1'));
  log(`C2-1 first row save: status=${a1.status} ${JSON.stringify(a1.json).slice(0, 200)}`);
  check('C2-1 first row (ff 198) saves (200)', a1.status === 200, `status ${a1.status}`);

  const cur199 = await freshRow(199);
  const c199 = await assignCarrier(199, cur199.version);
  const v199 = (await freshRow(199)).version;
  const a2 = await api(tk, 'PATCH', '/shipments/dispatch-detail-plan-rows/199/plate',
    { expectedVersion: v199, plateNumber: QAPLATE }, idem('c2-a2'));
  log(`C2-2 same-lot second save: status=${a2.status} body=${JSON.stringify(a2.json).slice(0, 300)}`);
  check('C2-2a same-lot/same-day double-plate REFUSED once (409)', a2.status === 409, `status ${a2.status}`);
  check('C2-2b refusal carries RIG_OVERLAP_COMPLETED code',
    a2.json?.code === 'RIG_OVERLAP_COMPLETED' || a2.json?.payload?.code === 'RIG_OVERLAP_COMPLETED' || JSON.stringify(a2.json).includes('RIG_OVERLAP_COMPLETED'),
    JSON.stringify(a2.json).slice(0, 200));
  check('C2-2c refusal is the same-lot holder warn ("container khác của lô này") — the LEFT-join claim',
    String(a2.json?.error ?? a2.json?.message ?? '').includes('container khác của lô này'), String(a2.json?.error ?? a2.json?.message ?? '').slice(0, 160));
  check('C2-2d refusal asks "Vẫn lưu?" (warn-once, not hard block)',
    String(a2.json?.error ?? a2.json?.message ?? '').includes('Vẫn lưu?'), String(a2.json?.error ?? a2.json?.message ?? '').slice(0, 160));

  const a3 = await api(tk, 'PATCH', '/shipments/dispatch-detail-plan-rows/199/plate',
    { expectedVersion: v199, plateNumber: QAPLATE, rigOverlapCompletedConfirmed: true }, idem('c2-a3'));
  log(`C2-3 confirmed retry: status=${a3.status} ${JSON.stringify(a3.json).slice(0, 200)}`);
  check('C2-3 confirm-flag retry saves (no hard block)', a3.status === 200, `status ${a3.status}`);

  // FB038-03B sub-drives. B1 = the mission's named entity (trip 117 ·
  // BLCUSa24BB): stage a QA row on 2026-10-04 (trip 117's day) and aim its
  // truck plate at it. B2 = the DISCRIMINATING shape of the Gap-B fix: a
  // date-only COMPLETED trip (planned_start_at NULL) must claim its day —
  // pre-fix such trips were invisible to the scan. Trip 117 today carries
  // planned timestamps (10:30–13:52 on 10-04; recorded in the report), so B2
  // stages its own QA-W4 completed date-only trip.
  const trip = c2.trip117;
  state.c2extra.lots ??= [];
  state.c2extra.tripIds ??= [];
  const findRow = async (shipmentId) => (await allRows()).find((r) => r.shipmentId === shipmentId && r.fulfillmentId != null) ?? null;
  const stageLot = async (tag, date) => {
    const bl = `QA-W4${tag}-${rand}`;
    const ship = await api(adm2, 'POST', '/shipments', {
      blNumber: bl, customerId: 1, tradeDirection: 'IMPORT', cargoMode: 'LCL', expectedDeliveryDate: date,
    }, idem(`lot-${tag}`));
    const id = ship.json.id ?? ship.json.shipment?.id;
    log(`C2 staged LCL lot ${bl} on ${date}: status=${ship.status} id=${id}`);
    state.c2extra.lots.push(id);
    let row = await findRow(id);
    if (row) {
      // LCL rows take the CUS-allocation carrier channel before any rig pick.
      const cr = await api(tk, 'PATCH', `/shipments/dispatch-detail-plan-rows/${row.fulfillmentId}/carrier`,
        { expectedVersion: row.version, carrierType: 'EXTERNAL', externalCarrierId: carId }, idem(`car-${tag}`));
      log(`C2 staged row carrier assign (ff${row.fulfillmentId}): status=${cr.status}`);
      row = await findRow(id);
    }
    return { id, row };
  };
  const driveClaim = async (label, row, plate, tag, expectCompletedMessage = true) => {
    const b1 = await api(tk, 'PATCH', `/shipments/dispatch-detail-plan-rows/${row.fulfillmentId}/plate`,
      { expectedVersion: row.version, plateNumber: plate }, idem(`${tag}-warn`));
    log(`${label} claim drive: status=${b1.status} body=${JSON.stringify(b1.json).slice(0, 300)}`);
    check(`${label}a COMPLETED trip claim warns (409), never silent`, b1.status === 409, `status ${b1.status}`);
    check(`${label}b carries RIG_OVERLAP_COMPLETED`,
      JSON.stringify(b1.json).includes('RIG_OVERLAP_COMPLETED'), JSON.stringify(b1.json).slice(0, 160));
    if (expectCompletedMessage) {
      check(`${label}c message names completed trips ("chuyến đã hoàn thành")`,
        String(b1.json?.error ?? b1.json?.message ?? '').includes('chuyến đã hoàn thành'), String(b1.json?.error ?? b1.json?.message ?? '').slice(0, 160));
    }
    const b2 = await api(tk, 'PATCH', `/shipments/dispatch-detail-plan-rows/${row.fulfillmentId}/plate`,
      { expectedVersion: row.version, plateNumber: plate, rigOverlapCompletedConfirmed: true }, idem(`${tag}-confirm`));
    log(`${label} confirm retry: status=${b2.status} ${JSON.stringify(b2.json).slice(0, 200)}`);
    check(`${label}d confirm-flag retry saves (warn-once, way on)`, b2.status === 200, `status ${b2.status}`);
  };

  if (trip.plate) {
    // B1 — named entity trip 117 (timed completed holder, same law family).
    const lotA = await stageLot('C2A', String(trip.departureDate).slice(0, 10));
    if (lotA.row) {
      await driveClaim('C2-B1', lotA.row, trip.plate, 'b1', false);
    } else {
      check('C2-B1 staged plan row on trip 117 date', false, 'row not found');
    }

    // B2 — date-only COMPLETED trip (the Gap-B discriminating shape). OWN
    // trips require a driverId — take a staging DRIVER account's user id.
    // The trip links to its own staged lot so the ACCOUNTANT direct-close
    // (POST /shipments/:id/complete, confirmNoPhoto override) can close it —
    // the governed close-maker path hard-requires evidence photos.
    const boot = await api(adm2, 'GET', '/catalogs/bootstrap');
    const users = await api(adm2, 'GET', '/auth/users');
    const driverList = (users.json.items ?? users.json.users ?? users.json ?? []);
    const drv = Array.isArray(driverList) ? (driverList.find((u) => u.username === 'bqhuong' && u.role === 'DRIVER') ?? driverList.find((u) => u.role === 'DRIVER')) : null;
    log(`C2-B2 driver pick: ${drv ? `${drv.username} (id ${drv.id})` : `none (status ${users.status})`}`);
    const D = '2026-10-28';
    const tripLot = await stageLot('C2T', D);
    const mk = await api(adm2, 'POST', '/trips', {
      customerId: 1, routeId: boot.json.routes[0].id,
      cargoTypeId: boot.json.cargoTypes[0].id, containerTypeId: boot.json.containerTypes[0].id,
      departureDate: D, truckId: 39, driverId: drv?.id, shipmentId: tripLot.id,
      customerReference: `QA-W4C2B-${rand}`,
    }, idem('b2-trip'));
    const qaTripId = mk.json.id ?? mk.json.trip?.id;
    log(`C2-B2 QA date-only trip: status=${mk.status} id=${qaTripId} body=${JSON.stringify(mk.json).slice(0, 160)}`);
    check('C2-B2-0 QA trip created on truck 39', mk.status === 201 && !!qaTripId, `status ${mk.status}`);
    if (qaTripId) {
      state.c2extra.tripIds.push(qaTripId);
      const dsp = await api(adm2, 'POST', `/trips/${qaTripId}/dispatch`, {}, idem('b2-dispatch'));
      log(`C2-B2 dispatch → IN_TRANSIT: status=${dsp.status} ${dsp.status >= 400 ? JSON.stringify(dsp.json).slice(0, 200) : ''}`);
      const acct = await login(state, 'accountant', 'hoapt');
      const freshTrip = await api(acct, 'GET', `/trips/${qaTripId}`);
      const tripVersion = freshTrip.json.version ?? freshTrip.json.trip?.version ?? 2;
      const freshShip = await api(acct, 'GET', `/shipments/${tripLot.id}`);
      const shipVersion = freshShip.json.version ?? freshShip.json.shipment?.version;
      const cmp = await api(acct, 'POST', `/shipments/${tripLot.id}/complete`, {
        expectedVersion: shipVersion, vatRate: 0,
        trips: [{ tripId: qaTripId, expectedVersion: tripVersion }],
        confirmZeroRevenue: true, confirmNoPhoto: true,
      }, idem('b2-complete'));
      log(`C2-B2 direct close (confirmNoPhoto) → COMPLETED: status=${cmp.status} ${cmp.status >= 400 ? JSON.stringify(cmp.json).slice(0, 250) : ''}`);
      check('C2-B2-1 QA trip reached COMPLETED (ACCOUNTANT direct close)', cmp.status === 200, `dispatch ${dsp.status} close ${cmp.status}`);
      const shape = psql(`select status, planned_start_at is null as date_only from trips where id = ${qaTripId};`);
      log(`C2-B2 QA trip shape (DB read-only): ${shape}`);
      check('C2-B2-2 QA trip is date-only COMPLETED (the pre-fix-invisible shape)',
        shape.startsWith('COMPLETED|t'), shape);
      const lotB = await stageLot('C2B', D);
      if (lotB.row) {
        await driveClaim('C2-B2', lotB.row, trip.plate, 'b2');
      } else {
        check('C2-B2 staged plan row on QA trip date', false, 'row not found');
      }
    }
  } else {
    check('C2-B1 trip 117 exposes a plate to collide with', false, 'trip117 plate missing');
  }

  // Restore: clear plates we set everywhere (ff rows + staged QA rows), and
  // put ff 198/199's carrier channel back to OWN (their before-state).
  for (const [ff, tag] of [[198, 'r198'], [199, 'r199']]) {
    const row = (await allRows()).find((r) => r.fulfillmentId === ff);
    if (!row) continue;
    const want = ff === 198 ? before198 : before199;
    const now = row.dispatch?.assignedPlate ?? null;
    if (now !== want) {
      const body = want
        ? { expectedVersion: row.version, plateNumber: want, rigOverlapCompletedConfirmed: true }
        : { expectedVersion: row.version, clear: true };
      const rr = await api(tk, 'PATCH', `/shipments/dispatch-detail-plan-rows/${ff}/plate`, body, idem(tag));
      log(`C2 restore ff${ff}: now=${now} → want=${want ?? '(cleared)'} status=${rr.status}`);
      check(`C2-restore ff${ff} back to before-state`, rr.status === 200, `status ${rr.status}`);
    }
    const fresh = (await allRows()).find((r) => r.fulfillmentId === ff);
    const cc = await api(tk, 'PATCH', `/shipments/dispatch-detail-plan-rows/${ff}/carrier`,
      { expectedVersion: fresh.version, carrierType: 'OWN', externalCarrierId: null }, idem(`rcar-${ff}`));
    log(`C2 restore ff${ff} carrier → OWN: status=${cc.status}`);
    check(`C2-restore ff${ff} carrier channel to OWN`, cc.status === 200, `status ${cc.status}`);
  }
  for (const lotId of state.c2extra?.lots ?? []) {
    const row = await findRow(lotId);
    if (!row) continue;
    const now = row.dispatch?.assignedPlate ?? null;
    if (now != null) {
      const rr = await api(tk, 'PATCH', `/shipments/dispatch-detail-plan-rows/${row.fulfillmentId}/plate`,
        { expectedVersion: row.version, clear: true }, idem(`rlot-${lotId}`));
      log(`C2 restore staged row (lot ${lotId} ff${row.fulfillmentId}): now=${now} cleared status=${rr.status}`);
      check(`C2-restore staged row (lot ${lotId}) cleared`, rr.status === 200, `status ${rr.status}`);
    }
  }
  save(state);
  if (failures.length) process.exit(1);
}

// ── phase: c3 — group-cost money lands at issue time ───────────────────────
if (phase === 'c3') {
  const adm = await login(state, 'admin', 'admin');
  const tk = await login(state, 'dispatcher', 'dungnv');
  const idem = (tag) => { const k = `QA-W4-c3-${tag}-${rand}`; state.idem[tag] = k; return k; };
  const LOT_DATE = '2026-10-20';
  const GENERIC_PRICE = 5_000_000;
  const VENDOR_PRICE = 4_500_000;
  state.c3 ??= { pricingIds: [], customerIds: [], supplierIds: [], shipmentIds: [], tripIds: [], routeId: null };

  // Catalogs: vehicle class 2.5T.
  let classes = await api(adm, 'GET', '/vehicle-size-classes');
  if (classes.status !== 200) classes = await api(adm, 'GET', '/config/vehicle-size-classes');
  const clsList = classes.json.items ?? classes.json.data ?? classes.json;
  const truckClass = Array.isArray(clsList) ? clsList.find((c) => c.code === '2.5T') : null;
  check('C3-0 vehicle class 2.5T exists in catalog', !!truckClass, `status ${classes.status}`);
  if (!truckClass) { save(state); process.exit(1); }

  // Route (own QA lane so the pricing rows are uniquely mine).
  const route = await api(adm, 'POST', '/routes', { name: `QA-W4 TUYEN ${rand}` }, idem('route'));
  log(`C3 route create: status=${route.status} body=${JSON.stringify(route.json).slice(0, 160)}`);
  state.c3.routeId = route.json.id ?? route.json.data?.id ?? null;
  check('C3-0b QA route created', route.status === 201 && !!state.c3.routeId, `status ${route.status}`);
  if (!state.c3.routeId) { save(state); process.exit(1); }

  // Supplier (CARRIER) + carrier customer linked to it ("BIỂN XANH" scene).
  const sup = await api(adm, 'POST', '/suppliers', { name: `QA-W4 NCC ${rand}`, types: ['CARRIER'], primaryType: 'CARRIER' }, idem('sup'));
  const supId = sup.json.id ?? sup.json.data?.id;
  state.c3.supplierIds.push(supId);
  const car = await api(adm, 'POST', '/customers', { name: `QA-W4 BX ${rand}`, isCarrier: true, status: 'ACTIVE', linkedSupplierId: supId }, idem('car'));
  const carId = car.json.id ?? car.json.data?.id;
  state.c3.customerIds.push(carId);
  await api(adm, 'PATCH', `/suppliers/${supId}`, { linkedCustomerId: carId }, idem('suplink'));
  log(`C3 carrier: customer ${carId} ↔ supplier ${supId} (status ${car.status})`);

  // Pricing: generic + vendor rows (effective ≤ lot date).
  const p1 = await api(adm, 'POST', '/carrier-route-pricing', {
    routeId: state.c3.routeId, vehicleSizeClassId: truckClass.id, price: GENERIC_PRICE, effectiveDate: '2026-10-01', note: `QA-W4 pricing ${rand}`,
  }, idem('price1'));
  const p2 = await api(adm, 'POST', '/carrier-route-pricing', {
    routeId: state.c3.routeId, vehicleSizeClassId: truckClass.id, supplierId: supId, price: VENDOR_PRICE, effectiveDate: '2026-10-01', note: `QA-W4 pricing ${rand}`,
  }, idem('price2'));
  state.c3.pricingIds.push(p1.json.id, p2.json.id);
  check('C3-1 pricing rows created (generic + vendor)', p1.status === 201 && p2.status === 201, `${p1.status}/${p2.status}`);

  // Customer + 3 LCL lots (born-ready fulfillments).
  const cust = await api(adm, 'POST', '/customers', { name: `QA-W4 KH ${rand}` }, idem('cust'));
  const custId = cust.json.id ?? cust.json.data?.id;
  state.c3.customerIds.push(custId);
  const lotRefs = [1, 2, 3].map((n) => `QA-W4C3-L0${n}-${rand}`);
  for (let i = 0; i < 3; i += 1) {
    const ship = await api(adm, 'POST', '/shipments', {
      customerId: custId, blNumber: lotRefs[i], tradeDirection: 'IMPORT', cargoMode: 'LCL',
      routeId: state.c3.routeId, expectedDeliveryDate: LOT_DATE,
      packageCount: 5, packageType: 'PALLET', cargoWeightKg: 1922, cargoVolumeCbm: 4,
    }, idem(`lot${i + 1}`));
    log(`C3 lot ${lotRefs[i]}: status=${ship.status} id=${ship.json.id ?? ship.json.shipment?.id}`);
    state.c3.shipmentIds.push(ship.json.id ?? ship.json.shipment?.id);
  }
  check('C3-2 three LCL lots created', state.c3.shipmentIds.every(Boolean) && state.c3.shipmentIds.length === 3, JSON.stringify(state.c3.shipmentIds));

  // Locate their fulfillments + versions on the plan grid.
  const rowsOf = async () => {
    for (let p = 1; p <= 20; p += 1) {
      const rows = await api(tk, 'GET', `/shipments/dispatch-detail-plan-rows?page=${p}&limit=50&dateFrom=2026-01-01&dateTo=2027-01-01`);
      const items = rows.json.items ?? [];
      const mine = items.filter((r) => state.c3.shipmentIds.includes(r.shipmentId));
      if (mine.length >= 3) return mine;
      if (items.length === 0) break;
    }
    return [];
  };
  let rows = await rowsOf();
  check('C3-3 plan grid shows the 3 QA rows before any trip', rows.length === 3, `rows ${rows.map((r) => `ff${r.fulfillmentId}@v${r.version}`).join(',')}`);
  check('C3-3b all three READY (no trip yet)', rows.every((r) => r.taskStatus === 'READY'), rows.map((r) => r.taskStatus).join(','));

  // "Gán xe nhóm" BEFORE dispatch — the card's exact ordering.
  const grp = await api(tk, 'POST', '/shipments/lcl/cost-group', {
    shipmentIds: state.c3.shipmentIds,
    vehicleSizeClassId: truckClass.id,
    actualTruckNo: `QA-W4X${rand}`.slice(0, 20),
    carrierType: 'EXTERNAL',
    carrierId: carId,
  }, idem('group'));
  log(`C3-4 gán xe nhóm: status=${grp.status} body=${JSON.stringify(grp.json).slice(0, 200)}`);
  check('C3-4 cost-group assign accepted on trip-less lots (201)', grp.status === 201, `status ${grp.status}`);

  // "Phát lệnh" ×3 — the real issue command path (POST /:id/dispatch).
  rows = await rowsOf();
  for (let i = 0; i < 3; i += 1) {
    const shipmentId = state.c3.shipmentIds[i];
    const row = rows.find((r) => r.shipmentId === shipmentId);
    const disp = await api(tk, 'POST', `/shipments/${shipmentId}/dispatch`, {
      fulfillmentId: row.fulfillmentId,
      expectedVersion: row.version,
      plannedStartAt: `${LOT_DATE}T08:00:00+07:00`,
      plannedEndAt: `${LOT_DATE}T12:00:00+07:00`,
      endTimeConfirmed: true,
      carrierType: 'EXTERNAL',
      externalCarrierId: carId,
    }, idem(`dispatch${i + 1}`));
    log(`C3-5 dispatch lot${i + 1} (${lotRefs[i]}): status=${disp.status} body=${JSON.stringify(disp.json).slice(0, 250)}`);
    check(`C3-5 lot${i + 1} dispatch order accepted`, disp.status === 200 || disp.status === 201, `status ${disp.status}`);
    const tripId = disp.json.trip?.id ?? disp.json.tripId ?? disp.json.id ?? disp.json.outcome?.trip?.id;
    if (tripId) state.c3.tripIds.push(tripId);
  }
  check('C3-5b three trips created by the issue path', state.c3.tripIds.length === 3, JSON.stringify(state.c3.tripIds));

  // The money law must be on the trips the issue created.
  const rowsSql = psql(
    `select t.shipment_id, tci.external_freight_cost from trips t ` +
    `left join trip_carrier_info tci on tci.trip_id = t.id ` +
    `where t.id in (${state.c3.tripIds.join(',')}) order by t.id;`);
  log(`C3-6 trip_carrier_info (DB read-only): ${JSON.stringify(rowsSql)}`);
  const costs = rowsSql.split('\n').map((l) => l.split('|')[1] ?? l.split('\t')[1] ?? l);
  const sorted = state.c3.tripIds.map((id, idx) => ({ id, cost: costs[idx] ?? null }));
  log(`C3-6 mapped: ${JSON.stringify(sorted)}`);
  check('C3-6a Lô 1 trip carries the vendor price 4,500,000', String(sorted[0]?.cost) === String(VENDOR_PRICE), `got ${sorted[0]?.cost}`);
  check('C3-6b members zeroed ("nhảy tiền") — 0 / 0',
    String(sorted[1]?.cost) === '0' && String(sorted[2]?.cost) === '0', `${sorted[1]?.cost} / ${sorted[2]?.cost}`);

  // The chốt-debit board (the "Thiếu cước trả ĐV" column's own service).
  const board = await api(adm, 'GET', `/accounting/debit-board?dateFrom=${LOT_DATE}&dateTo=${LOT_DATE}`);
  const items = board.json.items ?? [];
  const mine = state.c3.shipmentIds.map((sid) => items.find((it) => it.shipmentId === sid));
  log(`C3-7 debit-board: status=${board.status}, QA rows=${mine.filter(Boolean).length}`);
  if (mine.every(Boolean)) {
    const vals = mine.map((m) => m.tra?.cuocTraDv ?? m.tra?.cuocTraDV ?? null);
    log(`C3-7 cuocTraDv per lot: ${JSON.stringify(vals)}`);
    check('C3-7a debit board shows 4,500,000 on Lô 1', String(vals[0]) === String(VENDOR_PRICE), `got ${vals[0]}`);
    check('C3-7b members show 0 (not "Thiếu"/null)', String(vals[1]) === '0' && String(vals[2]) === '0', `${vals[1]} / ${vals[2]}`);
  } else {
    check('C3-7 debit board rows found for QA lots', false, `found ${mine.filter(Boolean).length}/3`);
  }

  writeFileSync(`${DIR}evidence-c3.json`, JSON.stringify({
    lotRefs, shipmentIds: state.c3.shipmentIds, tripIds: state.c3.tripIds,
    tripCosts: sorted, cuocTraDv: mine.map((m) => m?.tra?.cuocTraDv ?? null),
  }, null, 2));
  save(state);
  if (failures.length) process.exit(1);
}

// ── phase: c4setup — one FCL lot + 2 containers for the UI case ────────────
if (phase === 'c4setup') {
  const adm = await login(state, 'admin', 'admin');
  const cus = await login(state, 'cus', 'cus');
  const idem = (tag) => `QA-W4-c4-${tag}-${rand}`;
  state.c4 ??= {};
  const bl = `QA-W4C4-${rand}`;
  const ship = await api(adm, 'POST', '/shipments', {
    customerId: 1, blNumber: bl, tradeDirection: 'IMPORT', cargoMode: 'FCL',
    expectedDeliveryDate: '2026-10-25',
  }, idem('lot'));
  const lotId = ship.json.id ?? ship.json.shipment?.id;
  log(`C4 lot ${bl}: status=${ship.status} id=${lotId}`);
  check('C4-1 QA-W4 FCL lot created', ship.status === 201 && !!lotId, `status ${ship.status}`);
  // ISO 6346: 4 letters + 6-digit serial + check digit (verified server-side).
  const isoCheck = (letters4, serial6) => {
    const vals = {
      A: 10, B: 12, C: 13, D: 14, E: 15, F: 16, G: 17, H: 18, I: 19, J: 20,
      K: 21, L: 23, M: 24, N: 25, O: 26, P: 27, Q: 28, R: 29, S: 30, T: 31,
      U: 32, V: 34, W: 35, X: 36, Y: 37, Z: 38,
    };
    let sum = 0;
    (letters4 + serial6).split('').forEach((c, i) => {
      const v = /\d/.test(c) ? Number(c) : vals[c];
      sum += v * (2 ** i);
    });
    return String(sum % 11 === 10 ? 0 : sum % 11);
  };
  const boxes = [
    `QAWA470001${isoCheck('QAWA', '470001')}`.slice(0, 11),
    `QAWB470002${isoCheck('QAWB', '470002')}`.slice(0, 11),
  ]; // QA-W4 tag rides the lot's BL; box numbers satisfy ISO 6346
  for (const box of boxes) {
    const fresh = await api(cus, 'GET', `/shipments/${lotId}`);
    const shipVersion = fresh.json.version ?? fresh.json.shipment?.version;
    const add = await api(cus, 'POST', `/shipments/cus-workspace/${lotId}/containers`,
      { containerNumber: box, expectedShipmentVersion: shipVersion }, idem(`cont-${box}`));
    log(`C4 container ${box}: status=${add.status} body=${JSON.stringify(add.json).slice(0, 160)}`);
    check(`C4-2 container ${box} added via the overview drawer's API`, add.status === 200 || add.status === 201, `status ${add.status}`);
  }
  state.c4 = { lotId, bl, boxes };
  save(state);
  if (failures.length) process.exit(1);
}

// ── phase: b2retry — last bounded attempt at a date-only COMPLETED trip ────
if (phase === 'b2retry') {
  const tk = await login(state, 'dispatcher', 'dungnv');
  const adm2 = await login(state, 'admin', 'admin');
  const tripId = (state.c2extra?.tripIds ?? []).filter(Boolean).pop();
  log(`B2RETRY trip ${tripId}`);
  if (!tripId) { log('no staged trip in state'); process.exit(2); }
  // Staff close for external-carrier trips carries NO evidence gate; try it on
  // the OWN staged trip first (expected to reject), then as admin.
  for (const [who, tok] of [['dispatcher', tk], ['admin', adm2], ['accountant', await login(state, 'accountant', 'hoapt')]]) {
    const r = await api(tok, 'POST', `/trips/${tripId}/complete-external`, {}, `QA-W4-b2x-${who}-${rand}`);
    log(`B2RETRY complete-external as ${who}: ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
    const shape = psql(`select status, planned_start_at is null as date_only from trips where id = ${tripId};`);
    log(`B2RETRY shape: ${shape}`);
    if (shape.startsWith('COMPLETED|t')) break;
  }
  const shape = psql(`select status, planned_start_at is null as date_only from trips where id = ${tripId};`);
  check('B2RETRY-1 staged trip is date-only COMPLETED', shape.startsWith('COMPLETED|t'), shape);
  if (shape.startsWith('COMPLETED|t')) {
    // Re-drive the claim against the staged claim row (lot 881 / ff646 family).
    const allRows = async () => {
      const out = [];
      for (let p = 1; p <= 20; p += 1) {
        const rows = await api(tk, 'GET', `/shipments/dispatch-detail-plan-rows?page=${p}&limit=50&dateFrom=2026-01-01&dateTo=2027-01-01`);
        const items = rows.json.items ?? [];
        out.push(...items);
        if (items.length === 0 || out.length >= (rows.json.total ?? 0)) break;
      }
      return out;
    };
    const claimLotId = (state.c2extra?.lots ?? []).slice(-1)[0];
    const row = (await allRows()).find((r) => r.shipmentId === claimLotId && r.fulfillmentId != null);
    log(`B2RETRY claim row: ${row ? `ff${row.fulfillmentId} lot ${row.shipmentId} v${row.version}` : 'NOT FOUND'}`);
    if (row) {
      const b1 = await api(tk, 'PATCH', `/shipments/dispatch-detail-plan-rows/${row.fulfillmentId}/plate`,
        { expectedVersion: row.version, plateNumber: '15H-061.14' }, `QA-W4-b2r-warn-${rand}`);
      log(`B2RETRY claim drive: status=${b1.status} body=${JSON.stringify(b1.json).slice(0, 300)}`);
      check('B2RETRY-2a date-only COMPLETED claim warns (409), never silent', b1.status === 409, `status ${b1.status}`);
      check('B2RETRY-2b carries RIG_OVERLAP_COMPLETED', JSON.stringify(b1.json).includes('RIG_OVERLAP_COMPLETED'), JSON.stringify(b1.json).slice(0, 160));
      check('B2RETRY-2c message names completed trips ("chuyến đã hoàn thành")',
        String(b1.json?.error ?? b1.json?.message ?? '').includes('chuyến đã hoàn thành'), String(b1.json?.error ?? b1.json?.message ?? '').slice(0, 160));
      const fresh = (await allRows()).find((r) => r.fulfillmentId === row.fulfillmentId);
      const b2 = await api(tk, 'PATCH', `/shipments/dispatch-detail-plan-rows/${row.fulfillmentId}/plate`,
        { expectedVersion: fresh.version, plateNumber: '15H-061.14', rigOverlapCompletedConfirmed: true }, `QA-W4-b2r-confirm-${rand}`);
      log(`B2RETRY confirm retry: status=${b2.status}`);
      check('B2RETRY-2d confirm-flag retry saves (warn-once, way on)', b2.status === 200, `status ${b2.status}`);
      const fresh2 = (await allRows()).find((r) => r.fulfillmentId === row.fulfillmentId);
      const rr = await api(tk, 'PATCH', `/shipments/dispatch-detail-plan-rows/${row.fulfillmentId}/plate`,
        { expectedVersion: fresh2.version, clear: true }, `QA-W4-b2r-restore-${rand}`);
      log(`B2RETRY restore clear: status=${rr.status}`);
      check('B2RETRY-2e claim row restored (plate cleared)', rr.status === 200, `status ${rr.status}`);
    } else {
      check('B2RETRY claim row staged', false, 'no row');
    }
  }
  save(state);
  if (failures.length) process.exit(1);
}

// ── phase: b2final — date-only COMPLETED trip via the staff external close ─
if (phase === 'b2final') {
  const tk = await login(state, 'dispatcher', 'dungnv');
  const adm2 = await login(state, 'admin', 'admin');
  const idem = (tag) => `QA-W4-b2f-${tag}-${rand}`;
  const D = '2026-09-01'; // past: the staff close stamps completion = today
  const allRows = async () => {
    const out = [];
    for (let p = 1; p <= 20; p += 1) {
      const rows = await api(tk, 'GET', `/shipments/dispatch-detail-plan-rows?page=${p}&limit=50&dateFrom=2026-01-01&dateTo=2027-01-01`);
      const items = rows.json.items ?? [];
      out.push(...items);
      if (items.length === 0 || out.length >= (rows.json.total ?? 0)) break;
    }
    return out;
  };
  const findRow = async (sid) => (await allRows()).find((r) => r.shipmentId === sid && r.fulfillmentId != null) ?? null;
  const stageLot = async (tag, date) => {
    const bl = `QA-W4${tag}-${rand}`;
    const ship = await api(adm2, 'POST', '/shipments', {
      blNumber: bl, customerId: 1, tradeDirection: 'IMPORT', cargoMode: 'LCL', expectedDeliveryDate: date,
    }, idem(`lot-${tag}`));
    const id = ship.json.id ?? ship.json.shipment?.id;
    state.c2extra.lots.push(id);
    let row = await findRow(id);
    if (row) {
      const cr = await api(tk, 'PATCH', `/shipments/dispatch-detail-plan-rows/${row.fulfillmentId}/carrier`,
        { expectedVersion: row.version, carrierType: 'EXTERNAL', externalCarrierId: carIdOf() }, idem(`car-${tag}`));
      log(`B2F staged lot ${bl} (id ${id}) carrier assign ff${row.fulfillmentId}: ${cr.status}`);
      row = await findRow(id);
    } else {
      log(`B2F staged lot ${bl} (id ${id}): no plan row found`);
    }
    return { id, row };
  };
  function carIdOf() { return state.c2extra.customerIds[state.c2extra.customerIds.length - 1]; }

  const boot = await api(adm2, 'GET', '/catalogs/bootstrap');
  const users = await api(adm2, 'GET', '/auth/users');
  const driverList = (users.json.items ?? users.json.users ?? users.json ?? []);
  const drv = Array.isArray(driverList) ? driverList.find((u) => u.username === 'bqhuong' && u.role === 'DRIVER') : null;
  const tripLot = await stageLot('C2T2', D);
  const mk = await api(adm2, 'POST', '/trips', {
    customerId: 1, routeId: boot.json.routes[0].id,
    cargoTypeId: boot.json.cargoTypes[0].id, containerTypeId: boot.json.containerTypes[0].id,
    departureDate: D, truckId: 39, driverId: drv?.id, shipmentId: tripLot.id,
    customerReference: `QA-W4B2F-${rand}`,
  }, idem('trip'));
  const qaTripId = mk.json.id ?? mk.json.trip?.id;
  log(`B2F date-only trip: status=${mk.status} id=${qaTripId}`);
  check('B2F-0 QA trip created (truck 39, date-only)', mk.status === 201 && !!qaTripId, `status ${mk.status}`);
  if (qaTripId) {
    state.c2extra.tripIds.push(qaTripId);
    const dsp = await api(adm2, 'POST', `/trips/${qaTripId}/dispatch`, {}, idem('dispatch'));
    log(`B2F dispatch: ${dsp.status}`);
    const ce = await api(tk, 'POST', `/trips/${qaTripId}/complete-external`, {}, idem('cext'));
    log(`B2F complete-external (staff close, no evidence gate): ${ce.status} ${ce.status >= 400 ? JSON.stringify(ce.json).slice(0, 200) : ''}`);
    const shape = psql(`select status, planned_start_at is null as date_only from trips where id = ${qaTripId};`);
    log(`B2F shape (DB read-only): ${shape}`);
    check('B2F-1 trip is date-only COMPLETED (the pre-fix-invisible shape)', shape.startsWith('COMPLETED|t'), shape);
    if (shape.startsWith('COMPLETED|t')) {
      const claimLot = await stageLot('C2U', D);
      if (claimLot.row) {
        const b1 = await api(tk, 'PATCH', `/shipments/dispatch-detail-plan-rows/${claimLot.row.fulfillmentId}/plate`,
          { expectedVersion: claimLot.row.version, plateNumber: '15H-061.14' }, idem('warn'));
        log(`B2F claim drive: status=${b1.status} body=${JSON.stringify(b1.json).slice(0, 300)}`);
        check('B2F-2a date-only COMPLETED claim warns (409), never silent', b1.status === 409, `status ${b1.status}`);
        check('B2F-2b carries RIG_OVERLAP_COMPLETED', JSON.stringify(b1.json).includes('RIG_OVERLAP_COMPLETED'), JSON.stringify(b1.json).slice(0, 160));
        check('B2F-2c message names completed trips ("chuyến đã hoàn thành")',
          String(b1.json?.error ?? b1.json?.message ?? '').includes('chuyến đã hoàn thành'), String(b1.json?.error ?? b1.json?.message ?? '').slice(0, 160));
        const fresh = await findRow(claimLot.id);
        const b2 = await api(tk, 'PATCH', `/shipments/dispatch-detail-plan-rows/${claimLot.row.fulfillmentId}/plate`,
          { expectedVersion: fresh.version, plateNumber: '15H-061.14', rigOverlapCompletedConfirmed: true }, idem('confirm'));
        log(`B2F confirm retry: ${b2.status}`);
        check('B2F-2d confirm-flag retry saves (warn-once, way on)', b2.status === 200, `status ${b2.status}`);
        const fresh2 = await findRow(claimLot.id);
        const rr = await api(tk, 'PATCH', `/shipments/dispatch-detail-plan-rows/${claimLot.row.fulfillmentId}/plate`,
          { expectedVersion: fresh2.version, clear: true }, idem('restore'));
        log(`B2F restore clear: ${rr.status}`);
        check('B2F-2e claim row restored (plate cleared)', rr.status === 200, `status ${rr.status}`);
      } else {
        check('B2F claim row staged', false, 'no row');
      }
    }
  }
  save(state);
  if (failures.length) process.exit(1);
}

// ── phase: b2reassign — FB038-03B "Phân xe lại" against trip 117's day ────
if (phase === 'b2reassign') {
  const adm2 = await login(state, 'admin', 'admin');
  const idem = (tag) => `QA-W4-b2r-${tag}-${rand}`;
  const fleet = await api(adm2, 'GET', '/shipments/dispatch-fleet?resource=TRUCK&limit=50');
  const trucks = fleet.json.trucks ?? fleet.json.items ?? [];
  const other = Array.isArray(trucks) ? trucks.find((t) => (t.id ?? t.truckId) !== 39 && (t.licensePlate ?? t.plate)) : null;
  const otherId = other?.id ?? other?.truckId;
  const otherPlate = other?.licensePlate ?? other?.plate;
  log(`B2R fleet pick: truck ${otherId} (${otherPlate}) — status ${fleet.status}, ${trucks.length} trucks`);
  check('B2R-0 second rig available for the reassign repro', !!otherId, `status ${fleet.status}`);
  const users = await api(adm2, 'GET', '/auth/users');
  const driverList = (users.json.items ?? users.json.users ?? users.json ?? []);
  const drv = Array.isArray(driverList) ? driverList.find((u) => u.username === 'bqhuong' && u.role === 'DRIVER') : null;
  const boot = await api(adm2, 'GET', '/catalogs/bootstrap');
  let mk = await api(adm2, 'POST', '/trips', {
    customerId: 1, routeId: boot.json.routes[0].id,
    cargoTypeId: boot.json.cargoTypes[0].id, containerTypeId: boot.json.containerTypes[0].id,
    departureDate: '2026-10-04', truckId: otherId, driverId: drv?.id,
    customerReference: `QA-W4B2R-${rand}`,
  }, idem('trip'));
  if (mk.status === 409 && JSON.stringify(mk.json).includes('RIG_OVERLAP_COMPLETED')) {
    log(`B2R create warned on the repro rig (incidental — not the drive under test): ${JSON.stringify(mk.json).slice(0, 160)} — confirming`);
    mk = await api(adm2, 'POST', '/trips', {
      customerId: 1, routeId: boot.json.routes[0].id,
      cargoTypeId: boot.json.cargoTypes[0].id, containerTypeId: boot.json.containerTypes[0].id,
      departureDate: '2026-10-04', truckId: otherId, driverId: drv?.id,
      customerReference: `QA-W4B2R-${rand}`, confirmOverlap: true,
    }, idem('trip-confirm'));
  }
  const t3 = mk.json.id ?? mk.json.trip?.id;
  log(`B2R repro trip (CREATED, rig ${otherPlate}, day 2026-10-04): status=${mk.status} id=${t3}`);
  check('B2R-1 repro trip created', mk.status === 201 && !!t3, `status ${mk.status}`);
  if (t3) {
    state.c2extra.tripIds.push(t3);
    const fresh = await api(adm2, 'GET', `/trips/${t3}`);
    const v = fresh.json.version ?? fresh.json.trip?.version ?? 1;
    const rs = await api(adm2, 'PATCH', `/trips/${t3}/reassign`, {
      reason: 'QA-W4 staging verify — FB038-03B Phân xe lại repro (đổi sang xe 15H-061.14)',
      expectedVersion: v, carrierType: 'OWN', truckId: 39, driverId: drv?.id,
    }, idem('reassign'));
    log(`B2R reassign → truck 39 (15H-061.14, day of COMPLETED trip 117): status=${rs.status} body=${JSON.stringify(rs.json).slice(0, 300)}`);
    check('B2R-2a reassign onto trip-117 rig WARNs (409), never silent', rs.status === 409, `status ${rs.status}`);
    check('B2R-2b carries RIG_OVERLAP_COMPLETED', JSON.stringify(rs.json).includes('RIG_OVERLAP_COMPLETED'), JSON.stringify(rs.json).slice(0, 160));
    if (String(rs.json?.error ?? rs.json?.message ?? '').includes('chuyến đã hoàn thành')) {
      log('B2R-2c message = completed-trip tier ("chuyến đã hoàn thành") ✓');
    } else {
      log(`B2R-2c message tier note: ${String(rs.json?.error ?? rs.json?.message ?? '').slice(0, 160)}`);
    }
    const fresh2 = await api(adm2, 'GET', `/trips/${t3}`);
    const v2 = fresh2.json.version ?? fresh2.json.trip?.version ?? v;
    const rs2 = await api(adm2, 'PATCH', `/trips/${t3}/reassign`, {
      reason: 'QA-W4 staging verify — FB038-03B confirm retry',
      expectedVersion: v2, carrierType: 'OWN', truckId: 39, driverId: drv?.id,
      rigOverlapCompletedConfirmed: true,
    }, idem('reassign-confirm'));
    log(`B2R confirm retry: status=${rs2.status} ${rs2.status >= 400 ? JSON.stringify(rs2.json).slice(0, 160) : ''}`);
    check('B2R-2d confirm-flag retry saves (warn-once, way on)', rs2.status === 200, `status ${rs2.status}`);
  }
  save(state);
  if (failures.length) process.exit(1);
}

// ── phase: restore — idempotent cleanup of any c2 leftovers ───────────────
if (phase === 'restore') {
  const tk = await login(state, 'dispatcher', 'dungnv');
  const allRows = async () => {
    const out = [];
    for (let p = 1; p <= 20; p += 1) {
      const rows = await api(tk, 'GET', `/shipments/dispatch-detail-plan-rows?page=${p}&limit=50&dateFrom=2026-01-01&dateTo=2027-01-01`);
      const items = rows.json.items ?? [];
      out.push(...items);
      if (items.length === 0 || out.length >= (rows.json.total ?? 0)) break;
    }
    return out;
  };
  const idem = (tag) => `QA-W4-rs-${tag}-${rand}`;
  const items = await allRows();
  const targets = [
    ...[198, 199].map((ff) => items.find((r) => r.fulfillmentId === ff)).filter(Boolean),
    ...items.filter((r) => (state.c2extra?.lots ?? []).includes(r.shipmentId)),
  ];
  for (const row of targets) {
    const now = row.dispatch?.assignedPlate ?? null;
    if (now != null) {
      const rr = await api(tk, 'PATCH', `/shipments/dispatch-detail-plan-rows/${row.fulfillmentId}/plate`,
        { expectedVersion: row.version, clear: true }, idem(`p-${row.fulfillmentId}`));
      log(`RESTORE ff${row.fulfillmentId} (lot ${row.shipmentId}): clear plate '${now}' → ${rr.status}`);
      check(`RESTORE ff${row.fulfillmentId} plate cleared`, rr.status === 200, `status ${rr.status}`);
    }
  }
  for (const ff of [198, 199]) {
    const row = (await allRows()).find((r) => r.fulfillmentId === ff);
    if (!row) continue;
    if (row.dispatch?.carrierType && row.dispatch.carrierType !== 'OWN') {
      const cc = await api(tk, 'PATCH', `/shipments/dispatch-detail-plan-rows/${ff}/carrier`,
        { expectedVersion: row.version, carrierType: 'OWN', externalCarrierId: null }, idem(`c-${ff}`));
      log(`RESTORE ff${ff} carrier '${row.dispatch.carrierType}' → OWN: status=${cc.status}`);
      check(`RESTORE ff${ff} carrier OWN`, cc.status === 200, `status ${cc.status}`);
    } else {
      log(`RESTORE ff${ff} carrier already ${row.dispatch?.carrierType ?? '(none)'} — untouched`);
    }
  }
  // Leftover staged fixtures from earlier runs: remove before any re-drive so
  // their claims cannot pollute a fresh overlap-guard probe.
  const adm = await login(state, 'admin', 'admin');
  for (const tripId of state.c2extra?.tripIds ?? []) {
    if (!tripId) continue;
    const t = await api(adm, 'GET', `/trips/${tripId}`);
    const version = t.json.version ?? t.json.trip?.version;
    const c = await api(adm, 'POST', `/trips/${tripId}/cancel`, { expectedVersion: version, reason: 'QA-W4 restore — leftover staged fixture' }, idem(`ct-${tripId}`));
    const d = await api(adm, 'DELETE', `/trips/${tripId}`, version != null ? { expectedVersion: version } : undefined, idem(`dt-${tripId}`));
    log(`RESTORE trip ${tripId}: cancel ${c.status} ${JSON.stringify(c.json).slice(0, 80)} | delete ${d.status}`);
  }
  for (const sid of state.c2extra?.lots ?? []) {
    const row = await api(adm, 'GET', `/shipments/${sid}`);
    const v = row.json.version ?? row.json.shipment?.version;
    const d = await api(adm, 'DELETE', `/shipments/${sid}`, v != null ? { version: v } : undefined, idem(`ds-${sid}`));
    log(`RESTORE lot ${sid}: delete ${d.status} ${d.status >= 400 ? JSON.stringify(d.json).slice(0, 120) : ''}`);
  }
  state.c2extra.lots = [];
  state.c2extra.tripIds = [];
  save(state);
  if (failures.length) process.exit(1);
}

// ── phase: teardown — product deletes of every QA-W4 fixture ──────────────
if (phase === 'teardown') {
  const adm = await login(state, 'admin', 'admin');
  const idem = (tag) => `QA-W4-td-${tag}-${rand}`;
  const delWithToken = async (path, tag) => {
    const row = await api(adm, 'GET', path);
    const upd = row.json.updatedAt ?? row.json.data?.updatedAt;
    const del = await api(adm, 'DELETE', path, undefined, idem(tag),
      upd ? { 'If-Unmodified-Since': new Date(upd).toISOString() } : {});
    log(`  delete ${path} → ${del.status}`);
    return del.status === 200 || del.status === 204;
  };

  // c4 lot + containers (containers go with the shipment delete).
  if (state.c4?.lotId) {
    const row = await api(adm, 'GET', `/shipments/${state.c4.lotId}`);
    const version = row.json.version ?? row.json.shipment?.version;
    const del = await api(adm, 'DELETE', `/shipments/${state.c4.lotId}`, version != null ? { version } : undefined, idem('c4lot'));
    log(`  delete c4 shipment ${state.c4.lotId} (v${version}) → ${del.status} ${del.status >= 400 ? JSON.stringify(del.json).slice(0, 120) : ''}`);
    check('TD-1 c4 lot deleted (or left for registry purge)', del.status === 200 || del.status === 204 || del.status === 409, `status ${del.status}`);
  }
  // c3 trips → then lots.
  for (const tripId of state.c3?.tripIds ?? []) {
    const t = await api(adm, 'GET', `/trips/${tripId}`);
    const version = t.json.version ?? t.json.trip?.version;
    const cancel = await api(adm, 'POST', `/trips/${tripId}/cancel`, { expectedVersion: version, reason: 'QA-W4 teardown' }, idem(`cancel-${tripId}`));
    log(`  cancel trip ${tripId} → ${cancel.status} ${cancel.status >= 400 ? JSON.stringify(cancel.json).slice(0, 120) : ''}`);
    const del = await api(adm, 'DELETE', `/trips/${tripId}`, version != null ? { expectedVersion: version } : undefined, idem(`deltrip-${tripId}`));
    log(`  delete trip ${tripId} → ${del.status}`);
    if (state.c2Lot?.id == null) { /* keep */ }
    check(`TD-2 trip ${tripId} removed or canceled`, cancel.status < 400 || del.status < 400, `cancel ${cancel.status} del ${del.status}`);
  }
  for (const sid of state.c3?.shipmentIds ?? []) {
    const row = await api(adm, 'GET', `/shipments/${sid}`);
    const version = row.json.version ?? row.json.shipment?.version;
    const del = await api(adm, 'DELETE', `/shipments/${sid}`, version != null ? { version } : undefined, idem(`dels-${sid}`));
    log(`  delete c3 shipment ${sid} → ${del.status} ${del.status >= 400 ? JSON.stringify(del.json).slice(0, 120) : ''}`);
    check(`TD-3 c3 lot ${sid} deleted (or left for registry purge)`, del.status === 200 || del.status === 204 || del.status === 409, `status ${del.status}`);
  }
  for (const tripId of state.c2extra?.tripIds ?? []) {
    if (!tripId) continue;
    const t = await api(adm, 'GET', `/trips/${tripId}`);
    const version = t.json.version ?? t.json.trip?.version;
    const cancel = await api(adm, 'POST', `/trips/${tripId}/cancel`, { expectedVersion: version, reason: 'QA-W4 teardown' }, idem(`c2cancel-${tripId}`));
    log(`  cancel c2 QA trip ${tripId} → ${cancel.status}`);
    const del = await api(adm, 'DELETE', `/trips/${tripId}`, version != null ? { expectedVersion: version } : undefined, idem(`c2deltrip-${tripId}`));
    log(`  delete c2 QA trip ${tripId} → ${del.status}`);
    check(`TD-4 c2 QA trip ${tripId} canceled or deleted`, cancel.status < 400 || del.status < 400, `cancel ${cancel.status} del ${del.status}`);
  }
  for (const sid of state.c2extra?.lots ?? []) {
    const row = await api(adm, 'GET', `/shipments/${sid}`);
    const version = row.json.version ?? row.json.shipment?.version;
    const del = await api(adm, 'DELETE', `/shipments/${sid}`, version != null ? { version } : undefined, idem(`delc2-${sid}`));
    log(`  delete c2 staged lot ${sid} → ${del.status} ${del.status >= 400 ? JSON.stringify(del.json).slice(0, 120) : ''}`);
    check(`TD-5 c2 staged lot ${sid} deleted (or left for registry purge)`, del.status === 200 || del.status === 204 || del.status === 409, `status ${del.status}`);
  }
  for (const pid of state.c3?.pricingIds ?? []) {
    if (!pid) continue;
    await delWithToken(`/carrier-route-pricing/${pid}`, `price-${pid}`);
  }
  for (const cid of [...(state.c3?.customerIds ?? []), ...(state.c2extra?.customerIds ?? [])]) {
    if (!cid) continue;
    await delWithToken(`/customers/${cid}`, `cust-${cid}`);
  }
  for (const sid of state.c3?.supplierIds ?? []) {
    await delWithToken(`/suppliers/${sid}`, `sup-${sid}`);
  }
  if (state.c3?.routeId) await delWithToken(`/routes/${state.c3.routeId}`, 'route');
  save(state);
  if (failures.length) process.exit(1);
}

// ── phase: census — nothing QA-W4 live remains ─────────────────────────────
if (phase === 'census') {
  const adm = await login(state, 'admin', 'admin');
  const search = async (path, label) => {
    const res = await api(adm, 'GET', `${path}?q=${encodeURIComponent('QA-W4')}`);
    const items = res.json.items ?? res.json.data ?? [];
    const hits = Array.isArray(items) ? items.filter((it) => JSON.stringify(it).includes('QA-W4')).length : 0;
    log(`  census ${label}: ${hits} QA-W4 hits (status ${res.status})`);
    return hits;
  };
  const shipHits = await search('/shipments', 'shipments');
  const custHits = await search('/customers', 'customers');
  const supHits = await search('/suppliers', 'suppliers');
  check('CENSUS: no live QA-W4 shipments/customers/suppliers', shipHits + custHits + supHits === 0,
    `shipments ${shipHits} customers ${custHits} suppliers ${supHits}`);
  const rows = await api(adm, 'GET', '/shipments/dispatch-detail-plan-rows?page=1&limit=50&dateFrom=2026-01-01&dateTo=2027-01-01&q=QA-W4');
  const rowHits = (rows.json.items ?? []).filter((it) => JSON.stringify(it).includes('QA-W4')).length;
  check('CENSUS: no QA-W4 plan rows', rowHits === 0, `${rowHits} hits`);
  if (failures.length) process.exit(1);
}

log(`PHASE ${phase} DONE — failures=${failures.length}`);
if (failures.length) { log(JSON.stringify(failures, null, 2)); process.exit(1); }
