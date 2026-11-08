/**
 * SIL-729 r2 probe (QA integration — BE unit-only ruling: probes live here).
 *
 * Verifies the ALL-AGREE carrier law end-to-end on the real local stack:
 * shipment 1785 (dev seed) has ONE live OWN trip (1311, truck 42, plate
 * 60C-12345) and trip-less Ops 'chi hộ' fees attached to the SHIPMENT.
 *
 *   1. login hoapt → GET /expense-accounting/phoi-phieu/report?kind=TRA
 *      baseline;
 *   2. clone trip 1311 (new fulfillment + trip, SAME truck 42) ⇒ the shipment
 *      has 2 live trips of ONE carrier identity ⇒ the shared fees MUST still
 *      resolve into the internal-fleet bucket (before r2 the unique-trip law
 *      dropped them into 'Chưa xác định');
 *   3. re-point the CLONE's carrier info to an EXTERNAL CUSTOMER carrier ⇒
 *      mixed identity ⇒ the fees MUST fall back to 'Chưa xác định';
 *   4. cleanup deletes the probe trip + fulfillment + carrier info.
 *
 * Run: node qa/scripts/2026-11-08-sil729-shipment-fallback-allagree-probe.mjs
 */
import postgres from '../../backend/node_modules/postgres/src/index.js';

const BASE = process.env.PROBE_BASE ?? 'http://localhost:3002';
const DATABASE_URL = process.env.DEV_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5441/silversea';
const SHIPMENT_ID = 1785;
const BASE_TRIP_ID = 1311;
const INTERNAL_BUCKET = 'XE NHÀ — SILVER SEA';
const UNKNOWN = 'Chưa xác định';

const failures = [];
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(name);
}

const sql = postgres(DATABASE_URL, { max: 1 });
let cloneTripId = null;
let cloneFulfillmentId = null;

async function reportUnknownPhaiTra(auth) {
  const res = await fetch(`${BASE}/api/expense-accounting/phoi-phieu/report?kind=TRA`, { headers: auth });
  if (res.status !== 200) throw new Error(`report → ${res.status}: ${await res.text()}`);
  const { rows } = await res.json();
  return rows;
}

async function main() {
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'hoapt', password: 'Abc123' }),
  });
  const loginBody = await login.json().catch(() => ({}));
  check('login hoapt', login.status === 200 && typeof loginBody.token === 'string', `status ${login.status}`);
  const auth = { Authorization: `Bearer ${loginBody.token}` };

  // The shared fee money this shipment carries (trip-less, RECORDED).
  const fees = await sql`
    select coalesce(sum(case when e.amount < 0 then 0 else e.amount end), 0)::int AS total
    from expense_accounting_sources s
    join ops_expense_entries e on e.id = s.source_id
    where s.trip_id is null and s.shipment_id = ${SHIPMENT_ID} and s.status = 'RECORDED' and s.source_kind = 'OPS'`;
  const feeTotal = fees[0].total;
  check('fixture trip-less fee money exists', feeTotal > 0, `${feeTotal}₫`);

  // 2. clone the live trip — SAME truck (same carrier identity).
  const src = (await sql`select * from trips where id = ${BASE_TRIP_ID}`)[0];
  if (!src) throw new Error(`base trip ${BASE_TRIP_ID} missing`);
  const f = (await sql`select * from shipment_fulfillments where id = ${src.fulfillment_id}`)[0];
  const inserted = await sql`
    insert into shipment_fulfillments (shipment_id, fulfillment_type, cargo_mode, shipment_container_id,
      source_shipment_version, site_snapshot, version, dispatch_classification, created_at, updated_at)
    select shipment_id, fulfillment_type, cargo_mode, null,
      source_shipment_version, site_snapshot, version, dispatch_classification, now(), now()
    from shipment_fulfillments where id = ${src.fulfillment_id} returning id`;
  cloneFulfillmentId = inserted[0].id;
  const tripIns = await sql`
    insert into trips (trip_code, shipment_id, fulfillment_id, customer_id, route_id, status, departure_date,
      planned_start_at, planned_end_at, canonical_origin, canonical_destination, cargo_weight_kg,
      vehicle_capacity_kg, truck_id, trailer_id, driver_id, version, created_at, updated_at, source_shipment_version)
    select 'PROBE-SIL729R2', shipment_id, ${cloneFulfillmentId}, customer_id, route_id, status, departure_date,
      planned_start_at, planned_end_at, canonical_origin, canonical_destination, cargo_weight_kg,
      vehicle_capacity_kg, truck_id, trailer_id, driver_id, version, now(), now(), source_shipment_version
    from trips where id = ${BASE_TRIP_ID} returning id`;
  cloneTripId = tripIns[0].id;
  await sql`insert into trip_carrier_info (trip_id, carrier_type, external_entity_type, external_entity_id)
    select ${cloneTripId}, carrier_type, external_entity_type, external_entity_id from trip_carrier_info where trip_id = ${BASE_TRIP_ID}`;

  // All-agree: adding the 2nd live trip (same carrier identity) must NOT move
  // the shared fees anywhere — the r2 regression (unique-trip law) used to
  // drop them into 'Chưa xác định' the moment a shipment had 2 live trips.
  const tong = (row) => row.tienNang + row.tienHa + row.psKhac;
  const rowsBefore = await reportUnknownPhaiTra(auth);
  const internalBefore = rowsBefore.find((row) => row.party === INTERNAL_BUCKET);
  const unknownBefore = rowsBefore.find((row) => row.party === UNKNOWN);
  check('baseline: shared fees under the internal bucket (1 live trip)', internalBefore != null && tong(internalBefore) >= feeTotal,
    `internal ${tong(internalBefore) ?? 0}₫, fee ${feeTotal}₫`);

  let rows = await reportUnknownPhaiTra(auth);
  const internalRow = rows.find((row) => row.party === INTERNAL_BUCKET);
  const unknownRow = rows.find((row) => row.party === UNKNOWN);
  check('all-agree (2 live trips, same truck) → fees STAY under internal bucket', internalRow != null && tong(internalRow) === tong(internalBefore) && tong(unknownRow) === tong(unknownBefore),
    `internal ${tong(internalRow) ?? 0}₫ (was ${tong(internalBefore) ?? 0}₫), unknown ${tong(unknownRow) ?? 0}₫ (was ${tong(unknownBefore) ?? 0}₫)`);

  // 3. mixed identity: the clone re-points EXTERNAL CUSTOMER #4.
  await sql`update trip_carrier_info set carrier_type = 'EXTERNAL', external_entity_type = 'CUSTOMER', external_entity_id = 4 where trip_id = ${cloneTripId}`;
  rows = await reportUnknownPhaiTra(auth);
  const internalAfter = rows.find((row) => row.party === INTERNAL_BUCKET);
  const unknownAfter = rows.find((row) => row.party === UNKNOWN);
  check('mixed carrier → fees move to Chưa xác định (exactly the shared fee)', unknownAfter != null && tong(unknownAfter) === tong(unknownBefore) + feeTotal,
    `unknown ${tong(unknownAfter) ?? 0}₫ (was ${tong(unknownBefore) ?? 0}₫, fee ${feeTotal}₫)`);
  check('mixed carrier removed the fee from the internal bucket (moved, not duplicated)', internalAfter != null && tong(internalAfter) === tong(internalBefore) - feeTotal,
    `internal ${tong(internalAfter) ?? 0}₫ (was ${tong(internalBefore) ?? 0}₫)`);

  await cleanup();
  if (failures.length > 0) {
    console.error(`PROBE FAIL — ${failures.length} step(s): ${failures.join('; ')}`);
    process.exit(1);
  }
  console.log('PROBE PASS — all-agree resolves shared-lot fees; mixed identity keeps Chưa xác định; money moves, never duplicates.');
}

async function cleanup() {
  if (cloneTripId != null) {
    await sql`delete from trip_carrier_info where trip_id = ${cloneTripId}`;
    await sql`delete from trips where id = ${cloneTripId}`;
  }
  if (cloneFulfillmentId != null) {
    await sql`delete from shipment_fulfillments where id = ${cloneFulfillmentId}`;
  }
  console.log(`... cleanup: probe trip ${cloneTripId} + fulfillment ${cloneFulfillmentId} removed`);
}

main()
  .catch(async (cause) => {
    console.error('PROBE ERROR', cause);
    await cleanup().catch(() => {});
    await sql.end();
    process.exit(1);
  });
