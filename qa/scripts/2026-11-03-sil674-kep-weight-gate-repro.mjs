// SIL-674 — the Kẹp pair weight gate refuses EVERY second leg (409
// KEP_WEIGHT_WARNING) even when the pair total is far under the tractor's
// declared towing capacity. QA staging 5b0bdad3: legs 5t+5t on a 33t tractor
// (towCapacityTons 33.0) 409'd; GET /api/trips/222/223 carried
// vehicleCapacityKg null. Suspected cause (brief): the issue path resolves
// the capacity ONLY from the mooc-type bucket (TRAILER_CAPACITY_KG), and
// master-data imports leave the mooc type blank — the tractor spec-sheet
// tow rating (trucks.tow_capacity_tons) is never read, so the gate runs
// unprovable and the warn-once refusal fires on every attempt.
//
// This driver reproduces the QA matrix on LOCAL dev (BE of THIS worktree,
// lane port — never staging, never production):
//   PHASE=before (unfixed HEAD):
//     U  under  : 5t+5t, tow 33t, mooc type null → leg2 409 (the bug)
//     C  control: 5t+5t, mooc 40FT (30000 known)  → leg2 201 — the declared
//        carve works WITHOUT any pair row (SIL-668: manual pairing only),
//        so the carve is NOT the cause; only the null capacity differs.
//     O  over   : 25t+25t, tow 33t, mooc null    → leg2 409 once, confirmed
//        retry 201 (same observable as fixed, wrong reason: unprovable)
//   PHASE=after (fixed):
//     U  under  → leg2 201 clean + trip snapshot vehicleCapacityKg = 33000
//     C  control→ leg2 201 (unchanged precedence: bucket wins)
//     O  over   → leg2 409 once → confirmed retry 201
//     N  no spec: tow null + mooc null → 409 warn-once confirmable (kept law)
//     F  40' box on a DOUBLE leg → TC6(1) hard block message (unchanged)
//     P  pair rows: under-capacity clean issue creates NO auto pair (SIL-668)
//
//   SIL674_API=http://localhost:3017/api node qa/scripts/2026-11-03-sil674-kep-weight-gate-repro.mjs before|after
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const PHASE = process.argv[2] ?? 'before';
if (PHASE !== 'before' && PHASE !== 'after') {
  console.error('usage: node 2026-11-03-sil674-kep-weight-gate-repro.mjs before|after');
  process.exit(2);
}
const API = process.env.SIL674_API ?? 'http://localhost:3017/api';
const OUT = path.resolve('qa/2026-11-03-sil674');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, `driver-${PHASE}.log`);
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

// Each run gets its OWN probe day (7–26 days out): leftover PLAN rows of an
// earlier run (a canceled trip releases the rig, but the plan assignment and
// its classification stay) must never collide with the fresh run's plan-saves.
const day = new Date(Date.now() + (7 + Math.floor(Math.random() * 20)) * 24 * 3600e3).toISOString().slice(0, 10);
const at = (hh, mm = 0) => new Date(`${day}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+07:00`).toISOString();
const freeWithin = (column, id, winEnd) => `NOT EXISTS (
  SELECT 1 FROM trips t WHERE t.${column} = ${id} AND t.deleted_at IS NULL AND t.status IN ('CREATED','IN_TRANSIT')
    AND t.planned_start_at < '${winEnd}'::timestamptz
    AND coalesce(t.planned_end_at, t.planned_start_at + interval '8 hours') > '${at(6)}'::timestamptz)`;

const pickFree = (column, table, winEnd, exclude) => Number(psql(`SELECT x.id FROM ${table} x
  JOIN users u ON u.id = x.user_id
  WHERE x.deleted_at IS NULL AND x.status = 'ACTIVE' AND u.deleted_at IS NULL AND u.status = 'ACTIVE' AND u.role = 'DRIVER'
    AND ${freeWithin(column, 'x.id', winEnd)}
    ${exclude && exclude.length ? `AND x.id NOT IN (${exclude.join(',')})` : ''}
  ORDER BY x.id LIMIT 1`));

(async () => {
  const admin = await login('admin');
  const dispatch = await login('dieuvan');
  log(`SIL-674 driver phase=${PHASE} api=${API} probe day=${day}`);

  // Housekeeping — cancel ONLY this probe family's leftovers (BK-S674-*),
  // so rigs from earlier runs stop hogging trucks and drivers. Never
  // touches any other lane's or business data.
  const stale = psql(`SELECT t.id, t.version FROM trips t
    JOIN shipment_fulfillments sf ON sf.id = t.fulfillment_id
    JOIN shipments sh ON sh.id = sf.shipment_id
    WHERE sh.bl_number LIKE 'BK-S674%' AND t.deleted_at IS NULL
      AND t.status IN ('CREATED','IN_TRANSIT') ORDER BY t.id`).split('\n').filter(Boolean);
  for (const entry of stale) {
    const [tripId, version] = entry.split('|').map(Number);
    const cancel = await send(admin, `/trips/${tripId}/cancel`, 'POST', { expectedVersion: version, reason: 'SIL-674 repro housekeeping' });
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
  const type40 = (ctypesRes.body?.items ?? []).find((t) => /^40/.test(t.code ?? ''));
  const ports = portsRes.body?.items ?? [];
  const customer = (customersRes.body?.items ?? []).find((c) => c.status === 'ACTIVE' && !c.isCarrier);
  let siteRes = await send(admin, `/shipments/operational-sites?customerId=${customer.id}`);
  let site = (siteRes.body?.items ?? []).filter((x) => x.siteType === 'FACTORY' && (x.routeId == null || x.routeId === route.id)).at(-1);
  if (!site) {
    const made = await send(admin, '/shipments/operational-sites', 'POST', {
      customerId: customer.id, code: `S674-${Date.now() % 100000}`,
      name: `Nhà máy S674 repro ${Date.now() % 100000}`, siteType: 'FACTORY',
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

  async function makeLot(tag, { containerWeight, nContainers, containerType }) {
    const bl = `BK-S674-${tag}-${Date.now()}`;
    const created = await send(admin, '/shipments', 'POST', {
      customerId: customer.id, tradeDirection: 'IMPORT', cargoMode: 'FCL',
      blNumber: bl, expectedDeliveryDate: day,
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
        containerTypeId: (containerType ?? type20).id, routeId: route.id, operationalSiteId: site?.id,
        pickupPortId: (ports[0] ?? ports[1]).id, dropoffPortId: (ports[1] ?? ports[0]).id,
        ...(containerWeight != null ? { cargoWeightKg: containerWeight } : {}),
        customerAppointmentAt: at(8),
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
  // QA's exact shape: master-data-imported rig — mooc type BLANK (the common
  // import shape), tractor spec sheet carries tow_capacity_tons. This driver
  // stamps the tow rating on its own free trucks via the catalog API so the
  // repro is deterministic on the shared dev DB.
  const winEndAll = new Date(Date.now() + 8 * 24 * 3600e3).toISOString();
  const usedTrucks = [];
  const usedDrivers = [];
  async function rig(tag, { towTons, moocType }) {
    const trailer = await send(admin, '/trailers', 'POST', { licensePlate: `RS-S674${tag}-${Date.now() % 100000}`, type: moocType });
    const trailerId = trailer.body?.id;
    if (!trailerId) throw new Error(`trailer ${tag} create -> ${trailer.status}`);
    const truckId = Number(psql(`SELECT tk.id FROM trucks tk WHERE tk.deleted_at IS NULL AND tk.status = 'ACTIVE'
      ${usedTrucks.length ? `AND tk.id NOT IN (${usedTrucks.join(',')})` : ''} AND ${freeWithin('truck_id', 'tk.id', winEndAll)} ORDER BY tk.id LIMIT 1`));
    usedTrucks.push(truckId);
    const truck = await send(admin, `/trucks/${truckId}`);
    await send(admin, `/trucks/${truckId}`, 'PUT', {
      licensePlate: truck.body.licensePlate, currentTrailerId: trailerId, status: 'ACTIVE',
      towCapacityTons: towTons,
    }, { 'If-Unmodified-Since': String(truck.body.updatedAt) });
    const driverId = pickFree('driver_id', 'drivers', winEndAll, usedDrivers);
    usedDrivers.push(driverId);
    const towStored = psql(`SELECT tow_capacity_tons FROM trucks WHERE id = ${truckId}`);
    log(`rig ${tag}: truck=${truckId} tow_capacity_tons=${towStored} mooc=${trailerId} (type ${moocType ?? 'null'}) driver=${driverId}`);
    return { truckId, trailerId, driverId };
  }

  const rigU = await rig('U', { towTons: 33, moocType: null });   // QA: 33t tractor, mooc type blank
  const rigC = await rig('C', { towTons: null, moocType: '40FT' }); // control: bucket-known mooc
  const rigO = await rig('O', { towTons: 33, moocType: null });
  const rigsAfter = PHASE === 'after';
  const rigN = rigsAfter ? await rig('N', { towTons: null, moocType: null }) : null;

  /** Issue leg A then leg B of a 2-container Kẹp lot on one rig. */
  async function issuePair(tag, rig, { containerWeight, containerType } = {}) {
    const lot = await makeLot(tag, { containerWeight, nContainers: 2, containerType });
    log(`[${tag}] lot ${lot.bl} rows=${lot.rows.length}`);
    if (lot.rows.length < 2) throw new Error(`[${tag}] expected 2 plan rows, got ${lot.rows.length}`);
    const [legA, legB] = lot.rows;
    const shipVer = shipVersion(lot.shipmentId);
    for (const row of [legA, legB]) {
      const patched = await send(dispatch, `/shipments/dispatch-detail-plan-rows/${row.fulfillmentId}/plan`, 'PATCH', {
        expectedFulfillmentVersion: ffVersion(row.fulfillmentId),
        expectedShipmentVersion: shipVer,
        carrierType: 'OWN', truckId: rig.truckId,
        classification: 'DOUBLE', plannedRevenue: 0, plannedCarrierCost: 0,
      });
      if (patched.status !== 200) throw new Error(`[${tag}] plan-save leg -> ${patched.status} ${JSON.stringify(patched.body).slice(0, 220)}`);
    }
    const issueBody = (row, extra = {}) => send(dispatch, `/shipments/${lot.shipmentId}/dispatch`, 'POST', {
      fulfillmentId: row.fulfillmentId, expectedVersion: ffVersion(row.fulfillmentId),
      plannedStartAt: at(8), plannedEndAt: at(12), endTimeConfirmed: true,
      carrierType: 'OWN', truckId: rig.truckId, driverId: rig.driverId, trailerId: rig.trailerId,
      ...extra,
    });
    const leg1 = await issueBody(legA);
    const tripAId = leg1.body?.trip?.id;
    log(`[${tag}] issue leg1 → ${leg1.status} ${leg1.status >= 400 ? JSON.stringify(leg1.body).slice(0, 220) : `trip ${tripAId}`}`);
    const leg2 = await issueBody(legB);
    log(`[${tag}] issue leg2 → ${leg2.status} ${leg2.status >= 400 ? JSON.stringify(leg2.body).slice(0, 260) : `trip ${leg2.body?.trip?.id}`}`);
    return { lot, legA, legB, leg1, leg2, tripAId, issueBody };
  }

  // ── U — QA's exact bug shape: 5t + 5t on a 33t tractor, mooc type blank ──
  {
    const { lot, leg1, leg2, tripAId } = await issuePair('U', rigU, { containerWeight: 5000 });
    const towStored = psql(`SELECT tow_capacity_tons FROM trucks WHERE id = ${rigU.truckId}`);
    const snapA = tripAId != null ? psql(`SELECT vehicle_capacity_kg FROM trips WHERE id = ${tripAId}`) : 'NO_TRIP';
    log(`[U] evidence: truck tow_capacity_tons='${towStored}' leg1 trips.vehicle_capacity_kg='${snapA}'`);
    check('[U] leg1 5t issues clean', leg1.status === 200 || leg1.status === 201, `status=${leg1.status}`);
    if (PHASE === 'before') {
      check('[U] BUG: leg2 5t REFUSED with 409 KEP_WEIGHT_WARNING although 10t < 33t',
        leg2.status === 409 && JSON.stringify(leg2.body).includes('KEP_WEIGHT_WARNING'),
        `status=${leg2.status} body=${JSON.stringify(leg2.body).slice(0, 220)}`);
      check('[U] root cause evidence: leg1 trip snapshot vehicle_capacity_kg is NULL while the tractor declares 33t',
        towStored !== '33.0' ? false : (snapA === '' || snapA === 'NULL' || snapA == null),
        `tow='${towStored}' snapshot='${snapA}'`);
    } else {
      check('[U] FIXED: leg2 5t issues clean (10t < 33t sức kéo)',
        leg2.status === 200 || leg2.status === 201, `status=${leg2.status} body=${JSON.stringify(leg2.body).slice(0, 220)}`);
      check('[U] trip snapshot now carries the resolved capacity 33000',
        /33000/.test(snapA), `leg1 snapshot='${snapA}'`);
      const pairCount = Number(psql(`SELECT count(*) FROM trip_pairs tp
        WHERE tp.first_trip_id = ${tripAId} OR tp.second_trip_id = ${leg2.body?.trip?.id} OR tp.first_trip_id = ${leg2.body?.trip?.id} OR tp.second_trip_id = ${tripAId}`)) || 0;
      check('[P] SIL-668 kept: a clean issue creates NO automatic pair row', pairCount === 0, `trip_pairs=${pairCount}`);
    }
  }

  // ── C — control: same manual-pair context, mooc bucket KNOWN (40FT=30000) ──
  // Before the fix this already passed: the declared-share carve fires with
  // no pair row (SIL-668 manual pairing removed the auto pair — the carve is
  // pair-row-independent). If C passes while U fails, the null capacity —
  // not the carve — is the cause. Hypothesis B (SIL-668 interaction) rejected.
  {
    const { leg1, leg2 } = await issuePair('C', rigC, { containerWeight: 5000 });
    check('[C] control: leg1 issues', leg1.status === 200 || leg1.status === 201, `status=${leg1.status}`);
    check('[C] control: leg2 issues with KNOWN capacity (carve is pair-row-independent — hypothesis B rejected)',
      leg2.status === 200 || leg2.status === 201, `status=${leg2.status} body=${JSON.stringify(leg2.body).slice(0, 220)}`);
  }

  // ── O — over capacity: 25t + 25t = 50t vs 33t sức kéo ──
  {
    const { leg2, issueBody, legB } = await issuePair('O', rigO, { containerWeight: 25000 });
    check('[O] leg2 over capacity refused ONCE with the soft warning',
      leg2.status === 409 && JSON.stringify(leg2.body).includes('KEP_WEIGHT_WARNING'),
      `status=${leg2.status} body=${JSON.stringify(leg2.body).slice(0, 220)}`);
    // Warn-once contract: the same payload + kepWeightWarningConfirmed proceeds.
    const retry = await issueBody(legB, { kepWeightWarningConfirmed: true });
    log(`[O] confirmed retry → ${retry.status} ${retry.status >= 400 ? JSON.stringify(retry.body).slice(0, 220) : `trip ${retry.body?.trip?.id}`}`);
    check('[O] confirmed retry proceeds (warn-once, confirmable — TC6(2) kept)',
      retry.status === 200 || retry.status === 201, `status=${retry.status}`);
  }

  // ── N — no spec at all (tow null + mooc null): the DOC's "xe chưa cấu hình
  // tải moóc" branch stays warn-once confirmable (owner law, unchanged) ──
  if (rigsAfter && rigN) {
    const { leg2, issueBody, legB } = await issuePair('N', rigN, { containerWeight: 5000 });
    check('[N] unconfigured rig: leg2 refused ONCE with the soft warning',
      leg2.status === 409 && JSON.stringify(leg2.body).includes('KEP_WEIGHT_WARNING'),
      `status=${leg2.status}`);
    const retry = await issueBody(legB, { kepWeightWarningConfirmed: true });
    log(`[N] confirmed retry → ${retry.status}`);
    check('[N] unconfigured rig: confirmed retry proceeds (kept warn-once law)',
      retry.status === 200 || retry.status === 201, `status=${retry.status}`);
  }

  // ── F — TC6(1) regression pin: a 40' box on a DOUBLE leg hard-blocks ──
  // The DOC law lives at BOTH gates: the plan-save guard refuses the 40'
  // DOUBLE assignment outright, and assertKepIssuingContainerClass refuses
  // the issue. Either 409 with the DOC message is the pin holding.
  if (rigsAfter) {
    if (type40 == null) throw new Error('[F] no 40ft container type in the catalog — cannot build the pin');
    const lot = await makeLot('F', { containerWeight: 5000, nContainers: 1, containerType: type40 });
    const row = lot.rows[0];
    const planF = await send(dispatch, `/shipments/dispatch-detail-plan-rows/${row.fulfillmentId}/plan`, 'PATCH', {
      expectedFulfillmentVersion: ffVersion(row.fulfillmentId),
      expectedShipmentVersion: shipVersion(lot.shipmentId),
      carrierType: 'OWN', truckId: rigU.truckId,
      classification: 'DOUBLE', plannedRevenue: 0, plannedCarrierCost: 0,
    });
    log(`[F] 40' DOUBLE plan-save → ${planF.status} ${planF.status >= 400 ? JSON.stringify(planF.body).slice(0, 220) : ''}`);
    if (planF.status === 409 && JSON.stringify(planF.body).includes('02 container loại 20ft')) {
      check('[F] TC6(1) kept: 40ft Kẹp leg hard-blocks at plan-save with the DOC message', true, 'plan-save 409');
    } else {
      const issueF = await send(dispatch, `/shipments/${lot.shipmentId}/dispatch`, 'POST', {
        fulfillmentId: row.fulfillmentId, expectedVersion: ffVersion(row.fulfillmentId),
        plannedStartAt: at(14), plannedEndAt: at(18), endTimeConfirmed: true,
        carrierType: 'OWN', truckId: rigU.truckId, driverId: rigU.driverId, trailerId: rigU.trailerId,
      });
      log(`[F] 40' DOUBLE issue → ${issueF.status} ${JSON.stringify(issueF.body).slice(0, 220)}`);
      check('[F] TC6(1) kept: 40ft Kẹp leg hard-blocks with the DOC message',
        issueF.status === 409 && JSON.stringify(issueF.body).includes('02 container loại 20ft'),
        `status=${issueF.status}`);
    }
  }

  log(failures === 0
    ? `PHASE ${PHASE.toUpperCase()} COMPLETE — all expectations hold`
    : `PHASE ${PHASE.toUpperCase()} COMPLETE — ${failures} expectation(s) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => { log(`PROBE CRASHED: ${err.message}`); process.exit(2); });
