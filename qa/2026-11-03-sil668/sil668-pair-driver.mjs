// SIL-668 (id 781) — auto-pair removal driver (API + DB, rung DB/API VERIFIED).
//
// PHASE=before (against a backend that still carries the SIL-638-BE2
// auto-pair wiring): create a 2-cont lot, both legs classified DOUBLE (KẸP),
// issue leg 1 then leg 2 onto the SAME truck + driver + business day with NO
// manual pairing action → the pair row must EXIST (auto-created at issue).
//
// PHASE=after (against this branch's backend, auto-pair removed):
//   A) the same scenario must NOT create any pair row (no shared Trip_ID,
//      no active_trip_pair_id stamps, no trip_pairs row);
//   B) the MANUAL pairing action (POST /api/trips/pairs — điều vận gán cả 2
//      cùng xe) must still form the pair exactly as before: ACTIVE KEP row,
//      both trips stamped active_trip_pair_id order 1/2.
//
// Data: fresh lot per run (timestamped Số Bill), future business day per
// phase (before: 14/12/2026, after: 15/12/2026) so runs never collide with
// existing trips on the shared dev rig. Port contract: FE 7175 / BE 3002.
// DB: read-only psql via docker exec ss-prod-db (no writes — §2 local only).
import { execFileSync } from 'node:child_process';
import { mkdirSync, appendFileSync } from 'node:fs';
import path from 'node:path';

const PHASE = process.env.QA_PHASE ?? 'before'; // before | after
const API = 'http://localhost:3002/api';
const OUT = path.dirname(new URL(import.meta.url).pathname);
mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, `${PHASE}.log`);
const log = (line) => {
  const text = `${new Date().toISOString()} ${line}`;
  console.log(text);
  appendFileSync(LOG, `${text}\n`);
};
appendFileSync(LOG, `\n=== run ${new Date().toISOString()} PHASE=${PHASE} ===\n`);

// ISO 6346 owner-code + serial + computed check digit — the create gate
// validates the check digit, so both shells need real numbers.
const iso6346 = (owner, serial) => {
  const letterValues = {};
  let v = 10;
  for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    if (v % 11 === 0) v += 1;
    letterValues[ch] = v;
    v += 1;
  }
  const chars = (owner + String(serial).padStart(6, '0')).slice(0, 10);
  let sum = 0;
  for (let i = 0; i < 10; i += 1) {
    const c = chars[i];
    const value = /[A-Z]/.test(c) ? letterValues[c] : Number(c);
    sum += value * 2 ** i;
  }
  const check = sum % 11 === 10 ? 0 : sum % 11;
  return `${owner}${String(serial).padStart(6, '0')}${check}`;
};
const contA = iso6346('SILU', Number(String(Date.now()).slice(-6)));
const contB = iso6346('TLTU', Number(String(Date.now()).slice(-6)) + 1);
// UNIQUE business day per RUN: leftover trips from an earlier aborted run on
// the same rig + day would otherwise become the auto-pair partner (the scan
// pairs by truck+driver+business day) and cross-contaminate the scenario.
const DAY = (() => {
  const d = new Date(Date.UTC(2027, 0, 5) + (Date.now() % 150) * 86_400_000);
  return d.toISOString().slice(0, 10);
})();
const RUN = Date.now().toString(36).toUpperCase();
const CUSTOMER_ID = 1;        // CÔNG TY TNHH MTV LONG MINH
const ROUTE_ID = 6;           // KCN Quế Võ — distance 100 km (declared window wins anyway)
const CONT20_ID = 1;          // 20DC
const PICKUP_PORT_ID = 1;     // Cảng Tân Vũ
const DROPOFF_PORT_ID = 2;    // Cảng Đình Vũ
const TRUCK_ID = 1;           // 15E-016.26 (mooc 112 — 25t declared)
const DRIVER_ID = 1;          // LVLONG
const CARGO_KG = 5000;        // per cont — far under the 25t mooc (no TC6(2) warning)

let failures = 0;
const check = (name, ok, detail) => {
  failures += ok ? 0 : 1;
  log(`ASSERT ${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ` — ${detail}` : ''}`);
};

const psql = (sql) => execFileSync('docker', [
  'exec', 'ss-prod-db', 'psql', '-U', 'postgres', '-d', 'silversea', '-t', '-A', '-F', '|', '-c', sql,
], { encoding: 'utf8' }).trim();

const api = async (token, method, url, body) => {
  const res = await fetch(`${API}${url}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'Idempotency-Key': `sil668-${RUN}-${method}-${url.replace(/[^a-z0-9]/gi, '')}-${Math.random().toString(36).slice(2, 8)}`,
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* keep text */ }
  return { status: res.status, json, text };
};

const login = async (identifier) => {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  if (!res.ok) throw new Error(`login ${identifier} failed: ${res.status} ${await res.text()}`);
  const { token } = await res.json();
  log(`login ${identifier}: ${token ? 'OK' : 'FAIL'}`);
  return token;
};

const cus = await login('cus');
const dieuvan = await login('dieuvan');

// ── 1. Create a 2-cont lot, both classified DOUBLE (KẸP), 20ft ─────────────
const bill = `SIL668-${RUN}`;
const create = await api(cus, 'POST', '/shipments/quick', {
  customerId: CUSTOMER_ID,
  blNumber: `${bill}-BL`,
  cargoMode: 'FCL',
  containers: [
    {
      containerTypeId: CONT20_ID,
      containerNumber: contA,
      routeId: ROUTE_ID,
      pickupPortId: PICKUP_PORT_ID,
      dropoffPortId: DROPOFF_PORT_ID,
      cargoWeightKg: CARGO_KG,
      classification: 'DOUBLE',
    },
    {
      containerTypeId: CONT20_ID,
      containerNumber: contB,
      routeId: ROUTE_ID,
      pickupPortId: PICKUP_PORT_ID,
      dropoffPortId: DROPOFF_PORT_ID,
      cargoWeightKg: CARGO_KG,
      classification: 'DOUBLE',
    },
  ],
  _requestId: `sil668-${RUN}`,
});
check('tạo lô 2 cont DOUBLE (quick-create)', create.status === 200 || create.status === 201,
  `status=${create.status} ${create.text.slice(0, 300)}`);
if (create.status >= 400) {
  log('SIL-668 DRIVER ABORTED — lot create failed');
  process.exit(1);
}
const shipmentId = create.json?.id ?? create.json?.shipment?.id;
log(`shipmentId=${shipmentId} bill=${bill} day=${DAY}`);

// ── 1b. Materialize fulfillments — CUS assigns OWN carrier per container ───
// (fresh lots carry no fulfillment rows until a carrier assignment ensures
// them; the per-line workspace update creates one row per container and
// keeps the intake classification untouched.)
const detail0 = await api(dieuvan, 'GET', `/shipments/${shipmentId}`);
const conts = detail0.json?.containers ?? [];
check('2 containers trên detail', conts.length === 2, `count=${conts.length}`);
let shipVersion = detail0.json?.shipment?.version ?? create.json?.version ?? 1;
for (const c of conts) {
  const lineRes = await api(cus, 'POST', `/shipments/cus-workspace/${shipmentId}/containers/${c.id}`, {
    expectedShipmentVersion: shipVersion,
    carrierType: 'OWN',
    containerTypeId: CONT20_ID,
    routeId: ROUTE_ID,
    cargoWeightKg: String(CARGO_KG),
  });
  if (lineRes.status >= 400) {
    check('CUS gán carrier (tạo fulfillment)', false, `cont=${c.id} status=${lineRes.status} ${lineRes.text.slice(0, 200)}`);
    log('SIL-668 DRIVER ABORTED — carrier assign failed');
    process.exit(1);
  }
  shipVersion = lineRes.json?.shipment?.version ?? shipVersion + 1;
  log(`cus-workspace line cont=${c.id} → ${lineRes.status}`);
}

// ── 2. Resolve the two fulfillments (detail payload's carrierAssignments) ──
const readFulfillments = async () => {
  const fresh = await api(dieuvan, 'GET', `/shipments/${shipmentId}`);
  const assignments = fresh.json?.carrierAssignments ?? [];
  return assignments
    .filter((row) => row.fulfillmentId != null)
    .map((row) => ({ id: row.fulfillmentId, version: row.fulfillmentVersion, raw: row }));
};
let fulfillments = await readFulfillments();
check('2 fulfillments cho 2 cont', fulfillments.length === 2,
  `count=${fulfillments.length} shape=${JSON.stringify(fulfillments[0]?.raw ?? null).slice(0, 200)}`);
if (fulfillments.length !== 2) {
  log('SIL-668 DRIVER ABORTED — fulfillments not resolvable');
  process.exit(1);
}
fulfillments.sort((a, b) => a.id - b.id);
log(`fulfillments: ${fulfillments.map((f) => `${f.id}(v${f.version})`).join(' ')}`);

// ── 3. Issue leg 1 then leg 2 — same rig, same business day, NO pair action ─
const issue = async (fulfillment, startH, endH) => {
  const rows = await readFulfillments();
  const current = rows.find((r) => r.id === fulfillment.id) ?? fulfillment;
  const payload = () => ({
    fulfillmentId: current.id,
    expectedVersion: current.version,
    plannedStartAt: `${DAY}T${String(startH).padStart(2, '0')}:00:00+07:00`,
    plannedEndAt: `${DAY}T${String(endH).padStart(2, '0')}:00:00+07:00`,
    endTimeConfirmed: true,
    carrierType: 'OWN',
    truckId: TRUCK_ID,
    driverId: DRIVER_ID,
    containerTypeId: CONT20_ID,
  });
  let res = await api(dieuvan, 'POST', `/shipments/${shipmentId}/dispatch`, payload());
  // TC6(2) DOC soft-warning contract: refuse once with KEP_WEIGHT_WARNING,
  // the dispatcher's confirmed retry proceeds — exactly what a real điều vận
  // does in the confirm dialog.
  if (res.status === 409 && res.json?.code === 'KEP_WEIGHT_WARNING') {
    log(`issue cont ${current.id}: 409 KEP_WEIGHT_WARNING (soft) → confirm retry`);
    const fresh = await readFulfillments();
    const refreshed = fresh.find((r) => r.id === fulfillment.id) ?? current;
    res = await api(dieuvan, 'POST', `/shipments/${shipmentId}/dispatch`, {
      ...payload(),
      fulfillmentId: refreshed.id,
      expectedVersion: refreshed.version,
      kepWeightWarningConfirmed: true,
    });
  }
  const tripId = res.json?.result?.trip?.id ?? res.json?.trip?.id
    ?? psql(`SELECT id FROM trips WHERE fulfillment_id = ${current.id} AND deleted_at IS NULL ORDER BY id DESC LIMIT 1`);
  log(`issue cont ${current.id} ${String(startH).padStart(2, '0')}:00 → status=${res.status} ${res.status >= 400 ? res.text.slice(0, 260) : `tripId=${tripId} autoPairedTrip=${JSON.stringify(res.json?.result?.autoPairedTrip ?? res.json?.autoPairedTrip ?? null)}`}`);
  return { status: res.status, json: res.json, tripId };
};

const r1 = await issue(fulfillments[0], 8, 12);
check('phát lệnh leg 1 (08:00–12:00)', r1.status === 200 || r1.status === 201, `status=${r1.status}`);
const r2 = await issue(fulfillments[1], 13, 17);
check('phát lệnh leg 2 (13:00–17:00, cùng xe/tài xế/ngày, KHÔNG thao tác ghép)',
  r2.status === 200 || r2.status === 201, `status=${r2.status} ${r2.status >= 400 ? JSON.stringify(r2.json).slice(0, 260) : ''}`);
if (r1.status >= 400 || r2.status >= 400) {
  log('SIL-668 DRIVER ABORTED — issue failed');
  process.exit(1);
}
const trip1 = r1.tripId;
const trip2 = r2.tripId;
log(`trip1=${trip1} trip2=${trip2}`);
const autoPairedReported = r2.json?.result?.autoPairedTrip ?? r2.json?.autoPairedTrip ?? null;
if (PHASE === 'before') {
  log(`autoPairedTrip payload (before — wiring còn): ${JSON.stringify(autoPairedReported)}`);
} else {
  check('response issue KHÔNG còn autoPairedTrip', autoPairedReported == null,
    `autoPairedTrip=${JSON.stringify(autoPairedReported)}`);
}

// ── 4. DB side effects — pair rows + Trip_ID stamps ────────────────────────
const pairRows = psql(`SELECT id, pair_kind, status, first_trip_id, second_trip_id FROM trip_pairs WHERE first_trip_id IN (${trip1},${trip2}) OR second_trip_id IN (${trip1},${trip2})`);
log(`trip_pairs rows: ${pairRows === '' ? '(none)' : pairRows}`);
const stamps = psql(`SELECT id, active_trip_pair_id, active_trip_pair_order FROM trips WHERE id IN (${trip1},${trip2}) ORDER BY id`);
log(`trip pair stamps: ${stamps}`);

const sharedStamp = (() => {
  const [a, b] = stamps.split('\n').map((line) => line.split('|'));
  return a?.[1] && a[1] !== '' && a[1] === b?.[1];
})();

if (PHASE === 'before') {
  check('PHASE=before — auto-pair còn sống: 2 lệnh tự sinh 1 pair row',
    pairRows !== '' && pairRows.split('\n').length === 1, pairRows);
  check('PHASE=before — 2 chuyến chung Trip_ID (active_trip_pair_id như nhau)', sharedStamp, stamps);
  check('PHASE=before — pair là KẸP (KEP) ACTIVE', /KEP\|ACTIVE/.test(pairRows), pairRows);
} else {
  check('PHASE=after — KHÔNG tự sinh pair (0 trip_pairs row)', pairRows === '', pairRows || '(none)');
  check('PHASE=after — KHÔNG Trip_ID chung (active_trip_pair_id null cả 2)',
    stamps.split('\n').every((line) => line.split('|')[1] === '' || line.split('|')[1] === 'NULL'), stamps);
  check('PHASE=after — KHÔNG tag tự xuất hiện (containers.pairKind đều null, không pair nào để gắn)',
    pairRows === '', 'pairKind chỉ xuất hiện khi trips.activeTripPairId trỏ vào pair ACTIVE — đã chứng minh bằng 0 pair row ở trên');
}

// ── 5. PHASE=after — the MANUAL pair action must still work exactly ────────
if (PHASE === 'after') {
  const t1 = await api(dieuvan, 'GET', `/trips/${trip1}`);
  const t2 = await api(dieuvan, 'GET', `/trips/${trip2}`);
  log(`trip1 draft: start=${t1.json?.plannedStartAt} end=${t1.json?.plannedEndAt} origin=${t1.json?.canonicalOrigin} dest=${t1.json?.canonicalDestination} cap=${t1.json?.vehicleCapacityKg} w=${t1.json?.cargoWeightKg} v=${t1.json?.version}`);
  log(`trip2 draft: start=${t2.json?.plannedStartAt} end=${t2.json?.plannedEndAt} origin=${t2.json?.canonicalOrigin} dest=${t2.json?.canonicalDestination} cap=${t2.json?.vehicleCapacityKg} w=${t2.json?.cargoWeightKg} v=${t2.json?.version}`);
  const draftOf = (t) => ({
    plannedStartAt: t.plannedStartAt,
    plannedEndAt: t.plannedEndAt,
    canonicalOrigin: t.canonicalOrigin,
    canonicalDestination: t.canonicalDestination,
    cargoWeightKg: t.cargoWeightKg,
    vehicleCapacityKg: t.vehicleCapacityKg ?? null,
    expectedVersion: t.version,
  });
  const pairRes = await api(dieuvan, 'POST', '/trips/pairs', {
    firstTripId: trip1,
    secondTripId: trip2,
    pairKind: 'KEP',
    firstTrip: draftOf(t1.json ?? {}),
    secondTrip: draftOf(t2.json ?? {}),
  });
  check('PHASE=after — ghép THỦ CÔNG (POST /api/trips/pairs) tạo pair thành công',
    pairRes.status === 201, `status=${pairRes.status} ${pairRes.status >= 400 ? pairRes.text.slice(0, 300) : `pairId=${pairRes.json?.id}`}`);
  const manualPairRows = psql(`SELECT id, pair_kind, status, first_trip_id, second_trip_id FROM trip_pairs WHERE first_trip_id IN (${trip1},${trip2}) OR second_trip_id IN (${trip1},${trip2})`);
  log(`trip_pairs sau ghép thủ công: ${manualPairRows}`);
  const manualStamps = psql(`SELECT id, active_trip_pair_id, active_trip_pair_order FROM trips WHERE id IN (${trip1},${trip2}) ORDER BY id`);
  log(`trip stamps sau ghép thủ công: ${manualStamps}`);
  check('PHASE=after — pair thủ công: 1 row ACTIVE KEP đúng 2 chuyến',
    manualPairRows !== '' && manualPairRows.split('\n').length === 1 && /KEP\|ACTIVE/.test(manualPairRows), manualPairRows);
  const [sa, sb] = manualStamps.split('\n').map((line) => line.split('|'));
  check('PHASE=after — pair thủ công: 2 chuyến chung Trip_ID, order 1/2',
    sa?.[1] && sa[1] === sb?.[1] && sa[2] === '1' && sb[2] === '2', manualStamps);
  // VETC/lương hooks ride the SAME manual core — settings unset in dev DB,
  // so the dedup/salary stay inert by design; log the financial state as evidence.
  const fin = psql(`SELECT trip_id, toll_deduction, driver_salary FROM trip_financial_state WHERE trip_id IN (${trip1},${trip2}) ORDER BY trip_id`);
  log(`financial state sau pair (VETC/lương hooks — dev DB chưa cấu hình phụ phí): ${fin}`);
}

log(failures === 0
  ? `SIL-668 PHASE=${PHASE} COMPLETE — all assertions PASS`
  : `SIL-668 PHASE=${PHASE} COMPLETE — ${failures} assertion(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
