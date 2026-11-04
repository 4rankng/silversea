// SIL-655 round-2 — shared helpers for the 4 API-level path probes (LOCAL dev
// stack only: ss-prod-db on localhost:5441). Run each probe from backend/:
//   npx tsx ../qa/scripts/2026-11-04-sil655-r2-<name>.mjs
// Evidence contract per path: (a) created row id, (b) source_shipment_container_id
// re-read from the db, (c) bridge / number-about-lot check, (d) the round-1
// mismatch + orphan queries (issue 762) = 0 rows after the flow.
import { execSync } from 'node:child_process';

export const PSQL_C = process.env.PSQL_CONTAINER ?? 'ss-prod-db';

/** Raw single-column values, one per line (empty when no rows). */
const oneLine = (sql) => sql.replace(/\s+/g, ' ').trim();
export const psql = (sql) => execSync(
  `docker exec ${PSQL_C} psql -U postgres -d silversea -qtAX -c ${JSON.stringify(oneLine(sql))}`,
).toString().trim();

/** Human-readable psql output (headers + "(0 rows)") — matches the round-1
 *  `qa/2026-11-03-sil655/2026-11-03_sil655_mismatch-query-localdb.log` shape. */
export const psqlPretty = (sql) => execSync(
  `docker exec ${PSQL_C} psql -U postgres -d silversea -c ${JSON.stringify(oneLine(sql))}`,
).toString().trim();

// ── Round-1 invariant queries, verbatim from issue 762 ("dùng lại") ─────────
// Q1: a linked trip_container whose number does not match its lot row.
export const Q_MISMATCH = `SELECT tc.id FROM trip_containers tc JOIN shipment_containers sc ON sc.id=tc.source_shipment_container_id WHERE tc.container_number IS NOT NULL AND (sc.container_number IS NULL OR sc.container_number<>tc.container_number);`;
// Q2: a numbered trip_container on a shipment-linked trip with NO link at all.
export const Q_ORPHAN = `SELECT tc.id FROM trip_containers tc JOIN trips t ON t.id=tc.trip_id WHERE tc.container_number IS NOT NULL AND t.shipment_id IS NOT NULL AND tc.source_shipment_container_id IS NULL;`;
// Q3: the round-1 summary counts (numbered vs linked vs numberless).
export const Q_SUMMARY = `SELECT count(*) FILTER (WHERE tc.container_number IS NOT NULL) AS numbered_rows, count(*) FILTER (WHERE tc.container_number IS NOT NULL AND tc.source_shipment_container_id IS NOT NULL) AS numbered_and_linked, count(*) FILTER (WHERE tc.container_number IS NULL) AS numberless_rows, count(*) AS total_rows FROM trip_containers tc;`;

const results = [];

export const check = (id, ok, detail) => {
  results.push({ id, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} :: ${detail}`);
  return ok;
};

export const finish = (label) => {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n== ${label}: ${results.length - failed.length}/${results.length} checks passed ==`);
  if (failed.length > 0) {
    console.log(`FAILED: ${failed.map((f) => f.id).join(', ')}`);
    process.exit(1);
  }
};

/** The two invariant queries must print "(0 rows)" — the strict-rule gate (d). */
export function assertMismatchZero(label) {
  const q1 = psqlPretty(Q_MISMATCH);
  const q2 = psqlPretty(Q_ORPHAN);
  console.log(`\n--- ${label}: mismatch query (issue 762, verbatim) ---\n${q1}`);
  console.log(`--- ${label}: orphan-with-number query ---\n${q2}`);
  check(`${label}.mismatch-0row`, q1.includes('(0 rows)'), 'Q1 = 0 rows');
  check(`${label}.orphan-0row`, q2.includes('(0 rows)'), 'Q2 = 0 rows');
}

// ISO 6346 check digit — the link law validates numbers, so probes generate
// valid ones (same helper as the 2026-10-24-sil173 probe).
const LETTER_VALUES = { A: 10, B: 12, C: 13, D: 14, E: 15, F: 16, G: 17, H: 18, I: 19, J: 20, K: 21, L: 23, M: 24, N: 25, O: 26, P: 27, Q: 28, R: 29, S: 30, T: 31, U: 32, V: 34, W: 35, X: 36, Y: 37, Z: 38 };
const checkDigit = (ownerCodeAndSerial) => {
  const digits = [...ownerCodeAndSerial].map((ch) => (/[0-9]/.test(ch) ? Number(ch) : LETTER_VALUES[ch]));
  let sum = 0;
  digits.forEach((value, index) => { sum += value * (2 ** index); });
  return sum % 11 % 10;
};
export const contNo = (base10) => `${base10}${checkDigit(base10)}`;

/** A globally-fresh, ISO-valid container number (owner TEMU + serial). */
export function freshNumber(seed = Date.now() % 1000000) {
  let n = seed;
  while (true) {
    const candidate = contNo(`TEMU${String(n).padStart(6, '0')}`);
    const [hit] = psql(`SELECT 1 FROM shipment_containers WHERE container_number='${candidate}' UNION ALL SELECT 1 FROM trip_containers WHERE container_number='${candidate}' LIMIT 1`).split('\n').filter(Boolean);
    if (!hit) return candidate;
    n += 1;
  }
}

/** A real user id to stamp createdBy (seeded dev db always has users). */
export const anyUserId = () => Number(psql('SELECT id FROM users WHERE deleted_at IS NULL ORDER BY id LIMIT 1'));

/**
 * Fixture lot+trip for the forwarder probes: copy an existing seed trip row
 * (guaranteed FK-valid, shipment-linked, accounting-unlocked) under a probe
 * trip_code with NO trip_containers, and add a fresh numbered shipment_container
 * to the SAME lot (the number is declared on the lot but absent from the
 * fixture trip — exactly the LINK precondition). Returns { tripId, shipmentId,
 * scId, number, version }. cleanupFixture() removes every row again.
 */
const FIXTURE_CODE_PREFIX = 'SIL655R2-';
export function makeFixture() {
  const base = psql(`
    SELECT t.id, t.shipment_id
    FROM trips t
    JOIN shipment_containers sc ON sc.shipment_id = t.shipment_id AND sc.container_number IS NOT NULL
    WHERE t.deleted_at IS NULL AND t.shipment_id IS NOT NULL AND t.status = 'CREATED'
      AND NOT EXISTS (SELECT 1 FROM trip_containers tc WHERE tc.trip_id = t.id AND tc.container_number IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM shipment_accounting_locks l WHERE l.shipment_id = t.shipment_id)
    GROUP BY t.id, t.shipment_id
    HAVING count(*) >= 1
    ORDER BY t.id DESC
    LIMIT 1`).split('\n').filter(Boolean);
  if (base.length === 0) throw new Error('no eligible CREATED shipment-linked seed trip without numbered containers');
  const [baseTripId, shipmentId] = base[0].split('|').map(Number);
  const number = freshNumber();
  const [scId] = psql(`
    INSERT INTO shipment_containers (shipment_id, container_number, cargo_weight_kg)
    VALUES (${shipmentId}, '${number}', '18000') RETURNING id`).split('\n').filter(Boolean).map(Number);
  const tripCode = `${FIXTURE_CODE_PREFIX}${Date.now()}P${process.pid}`;
  const [tripId] = psql(`
    INSERT INTO trips (trip_code, version, customer_id, route_id, container_count, status,
                       departure_date, shipment_id, source_shipment_version, created_by, created_at, updated_at)
    SELECT '${tripCode}', 1, customer_id, route_id, 1, 'CREATED',
           departure_date, shipment_id, source_shipment_version, created_by, now(), now()
    FROM trips WHERE id = ${baseTripId} RETURNING id`).split('\n').filter(Boolean).map(Number);
  const [version] = psql(`SELECT version FROM trips WHERE id=${tripId}`).split('\n').map(Number);
  console.log(`fixture: baseTrip=${baseTripId} lot=shipment#${shipmentId} fixtureTrip=${tripId} (v${version}) fixtureContainer=sc#${scId} number=${number}`);
  return { baseTripId, tripId, tripCode, shipmentId, scId, number, version };
}

export function cleanupFixture({ tripId, scId, label }) {
  psql(`DELETE FROM trip_container_seals WHERE trip_container_id IN (SELECT id FROM trip_containers WHERE trip_id=${tripId})`);
  psql(`DELETE FROM trip_containers WHERE trip_id=${tripId}`);
  psql(`DELETE FROM trip_legs WHERE trip_id=${tripId}`);
  psql(`DELETE FROM trips WHERE id=${tripId}`);
  psql(`DELETE FROM shipment_containers WHERE id=${scId}`);
  const left = psql(`SELECT (SELECT count(*) FROM trips WHERE id=${tripId}) || '|' || (SELECT count(*) FROM shipment_containers WHERE id=${scId}) || '|' || (SELECT count(*) FROM trip_containers WHERE trip_id=${tripId})`);
  check(`${label}.cleanup`, left === '0|0|0', `fixture rows removed (residual=${left})`);
}
