/**
 * SIL-750 overload-advisory probe (QA integration — BE unit-only ruling:
 * integration probes live here, never in backend/src/tests).
 *
 * Drives the REAL local stack through the QA repro shape (staging: trips
 * 462/463, 2×12t on a 22t rig, KẸP saved silently):
 *   1. login dungnv (Điều vận) → token;
 *   2. fixture: the dev-DB seeded pair TRP-202611-0121/0122 (trips 848/849,
 *      same truck, same day, capacity 22000, cargo 21000 each ⇒ proven
 *      overload 42000 > 22000) — canonical locations filled when missing;
 *   3. POST /api/trips/pairs (KET_HOP — the shell-size gates stay passable on
 *      container-less seeded trips; the SIL-750 advisory is kind-agnostic);
 *   4. MUST be 201 AND response.warnings MUST contain the DOC verbatim
 *      overload text (before the fix: 201 with NO warnings — silent save);
 *   5. MUST NOT carry the missing-capacity advisory (capacity is declared);
 *   6. the pair row must exist ACTIVE in trip_pairs.
 *
 * Run: node qa/scripts/2026-11-08-sil750-manual-pair-overload-probe.mjs
 */
import crypto from 'node:crypto';
import postgres from '../../backend/node_modules/postgres/src/index.js';

const BASE = process.env.PROBE_BASE ?? 'http://localhost:3002';
const DATABASE_URL = process.env.DEV_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5441/silversea';
const DOC_OVERLOAD_TEXT = 'Tổng tải trọng hàng ước tính có thể vượt tải trọng cho phép của phương tiện, Điều vận vui lòng kiểm tra lại';

const failures = [];
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(name);
}

const sql = postgres(DATABASE_URL, { max: 1 });

async function main() {
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'dungnv', password: 'Abc123' }),
  });
  const loginBody = await login.json().catch(() => ({}));
  check('login dungnv', login.status === 200 && typeof loginBody.token === 'string', `status ${login.status}`);
  const auth = { Authorization: `Bearer ${loginBody.token}`, 'Content-Type': 'application/json' };

  // Fixture: the seeded overloaded same-truck same-day pair.
  const trips = await sql`
    select id, trip_code as "tripCode", version, cargo_weight_kg as "cargoWeightKg",
           vehicle_capacity_kg as "vehicleCapacityKg", planned_start_at as "plannedStartAt",
           planned_end_at as "plannedEndAt", canonical_origin as "origin",
           canonical_destination as "destination", shipment_id as "shipmentId",
           active_trip_pair_id as "pairId", truck_id as "truckId", departure_date as "departureDate"
    from trips
    where id in (848, 849) and deleted_at is null and active_trip_pair_id is null
      and status = 'CREATED' order by id`;
  check('fixture trips 848+849 pairable', trips.length === 2, `found ${trips.length}`);
  if (trips.length !== 2) { await sql.end(); process.exit(1); }
  const [first, second] = trips;
  const sum = Number(first.cargoWeightKg) + Number(second.cargoWeightKg);
  const cap = Number(first.vehicleCapacityKg);
  check('fixture is a proven overload', sum > cap, `${sum}kg > ${cap}kg`);

  if (!first.origin || !first.destination || !second.origin || !second.destination) {
    await sql`update trips set canonical_origin = 'Tân Vũ', canonical_destination = 'Đình Vũ' where id in (${first.id}, ${second.id})`;
    first.origin ??= 'Tân Vũ'; first.destination ??= 'Đình Vũ';
    second.origin ??= 'Tân Vũ'; second.destination ??= 'Đình Vũ';
  }
  // Fresh versions after any fixture write.
  const fresh = await sql`select id, version from trips where id in (${first.id}, ${second.id})`;
  const versionOf = Object.fromEntries(fresh.map((row) => [row.id, row.version]));

  // Accounting locks would 409 the pair — assert the fixture is clean.
  const locked = await sql`
    select shipment_id from shipment_cost_locks
    where unlocked_at is null and shipment_id in (${first.shipmentId}, ${second.shipmentId})`;
  check('fixture shipments not cost-locked', locked.length === 0, `${locked.length} locks`);

  // Drafts derive from the trip-detail WIRE exactly like the real dialog
  // (useTripDetail → draftFor): the server serializes the naive timestamps in
  // its own zone and asserts the draft back against the same instant, so the
  // probe must echo the wire strings — never re-derive them from the DB rows.
  const detailOf = async (tripId) => {
    const res = await fetch(`${BASE}/api/trips/${tripId}`, { headers: auth });
    if (res.status !== 200) throw new Error(`GET /trips/${tripId} → ${res.status}`);
    return res.json();
  };
  const detail = { [first.id]: await detailOf(first.id), [second.id]: await detailOf(second.id) };
  const draft = (trip) => ({
    plannedStartAt: detail[trip.id].plannedStartAt,
    plannedEndAt: detail[trip.id].plannedEndAt,
    canonicalOrigin: detail[trip.id].canonicalOrigin,
    canonicalDestination: detail[trip.id].canonicalDestination,
    cargoWeightKg: Number(detail[trip.id].cargoWeightKg),
    vehicleCapacityKg: Number(detail[trip.id].vehicleCapacityKg),
    expectedVersion: detail[trip.id].version,
  });
  // KẸP — the exact QA repro kind: both fixtures are 20DC so the 2×20' size
  // gate passes, and KẸP is simultaneous (leg order irrelevant, same day ✓).
  const ordered = [first, second];

  const res = await fetch(`${BASE}/api/trips/pairs`, {
    method: 'POST',
    headers: { ...auth, 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({
      firstTripId: ordered[0].id,
      secondTripId: ordered[1].id,
      pairKind: 'KEP',
      firstTrip: draft(ordered[0]),
      secondTrip: draft(ordered[1]),
    }),
  });
  const body = await res.json().catch(() => ({}));
  check('POST /trips/pairs → 201', res.status === 201, `status ${res.status} body ${JSON.stringify(body).slice(0, 200)}`);
  const warnings = Array.isArray(body.warnings) ? body.warnings : [];
  check('response carries the DOC overload warning', warnings.includes(DOC_OVERLOAD_TEXT), `warnings ${JSON.stringify(warnings)}`);
  check('no missing-capacity advisory (capacity declared)', !warnings.some((w) => w.includes('chưa khai tải trọng')), `warnings ${JSON.stringify(warnings)}`);
  check('pair row ACTIVE', Number.isInteger(body.id), `pairId ${body.id}`);
  if (Number.isInteger(body.id)) {
    const pair = await sql`select status from trip_pairs where id = ${body.id}`;
    check('trip_pairs row exists ACTIVE', pair.length === 1 && pair[0].status === 'ACTIVE', `status ${pair[0]?.status}`);
  }

  await sql.end();
  if (failures.length > 0) {
    console.error(`PROBE FAIL — ${failures.length} step(s): ${failures.join('; ')}`);
    process.exit(1);
  }
  console.log('PROBE PASS — proven overload saves 201 WITH the DOC soft warning (dialog keeps it visible).');
}

main().catch(async (cause) => { console.error('PROBE ERROR', cause); await sql.end(); process.exit(1); });
