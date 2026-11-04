// SIL-655 round-2 — probe 1: the seed path (seed/seed-bulk-data.ts, the trips
// segment that copies each lot's shipment_containers into trip_containers with
// sourceShipmentContainerId: sc.id at :715-718). The bulk seed is idempotent
// behind the BULK marker/BL guards, and this local db still holds the BULK
// rows from an earlier load, so the probe first wipes exactly the BULK-scoped
// rows (local dev db only — never staging), then executes the REAL
// seedBulkData() function and asserts the invariant on what it created.
// Evidence: (a) seeded trip_container ids, (b) source_shipment_container_id
// re-read per seeded row + number equality with its lot row, (c) number-about-
// lot (seed writes both sides consistently — no bridge call on this path),
// (d) mismatch + orphan queries 0 rows over the whole db after the flow.
// Run: cd backend && npx tsx ../qa/scripts/2026-11-04-sil655-r2-p1-seed-path-probe.mjs
import { seedBulkData } from '../../backend/src/seed/seed-bulk-data.js';
import {
  Q_MISMATCH, Q_ORPHAN, check, finish, psql, psqlPretty,
} from './2026-11-04-sil655-r2-lib.mjs';

const label = 'p1-seed-path';

// ── Pre-state ────────────────────────────────────────────────────────────────
const pre = psql(`SELECT (SELECT count(*) FROM shipments WHERE bl_number='BULK-MARKER-DO-NOT-DELETE') || '|' || (SELECT count(*) FROM shipments WHERE bl_number LIKE 'BULK-%' OR booking_ref LIKE 'BULK-%') || '|' || (SELECT count(*) FROM trip_containers)`).split('|');
check('p1.pre-bulk-present', Number(pre[1]) > 0, `pre-state: marker=${pre[0]} bulk shipments=${pre[1]} trip_containers total=${pre[2]} (guard would skip — wipe required to exercise the seed)`);

// ── Scoped BULK wipe (trips first: trips.shipment_id FK is SET NULL, so the
//    shipments delete would orphan them; trip children CASCADE from trips).
//    RESTRICT children of the bulk set are pre-deleted scoped, never broadly. ──
const bulkTripsCte = `SELECT id FROM trips WHERE trip_code LIKE 'BULK-TR-%' OR shipment_id IN (SELECT id FROM shipments WHERE bl_number LIKE 'BULK-%' OR booking_ref LIKE 'BULK-%')`;
const bulkShipCte = `SELECT id FROM shipments WHERE bl_number LIKE 'BULK-%' OR booking_ref LIKE 'BULK-%'`;
for (const [tbl, col] of [
  ['trip_financial_postings', 'trip_id'], ['billing_document_trip_claims', 'trip_id'],
  ['container_deposit_records', 'shipment_id'], ['debit_note_lots', 'shipment_id'],
  ['expense_accounting_sources', 'shipment_id'], ['ops_expense_entries', 'shipment_id'],
  ['shipment_accounting_locks', 'shipment_id'], ['shipment_cost_locks', 'shipment_id'],
  ['shipment_invoice_records', 'shipment_id'],
]) {
  const inSet = col === 'trip_id' ? bulkTripsCte : bulkShipCte;
  psql(`DELETE FROM ${tbl} WHERE ${col} IN (${inSet})`);
}
psql(`DELETE FROM expenses WHERE note LIKE '[BULK]%'`);
psql(`DELETE FROM trips WHERE id IN (${bulkTripsCte})`);
psql(`DELETE FROM shipments WHERE id IN (${bulkShipCte})`);
const wiped = psql(`SELECT (SELECT count(*) FROM shipments WHERE bl_number LIKE 'BULK-%' OR booking_ref LIKE 'BULK-%') || '|' || (SELECT count(*) FROM trips WHERE trip_code LIKE 'BULK-TR-%') || '|' || (SELECT count(*) FROM shipments WHERE bl_number='BULK-MARKER-DO-NOT-DELETE')`).split('|');
check('p1.wipe-clean', wiped.join('|') === '0|0|0', `bulk wiped: shipments=${wiped[0]} bulk trips=${wiped[1]} marker=${wiped[2]}`);

// ── The path under test: the real seed function ──────────────────────────────
const t0 = Date.now();
const result = await seedBulkData();
console.log(`seedBulkData() → created=${result.created} in ${Math.round((Date.now() - t0) / 1000)}s; stats=${JSON.stringify(result.stats)}`);
check('p1.seed-ran', result.created === true, 'seed executed (not skipped by the idempotency guard)');

// ── Assertions on what the seed created ──────────────────────────────────────
const stats = psql(`SELECT (SELECT count(*) FROM shipments WHERE bl_number LIKE 'BULK-%') || '|' || (SELECT count(*) FROM trips WHERE trip_code LIKE 'BULK-TR-%') || '|' || (SELECT count(*) FROM trip_containers tc JOIN trips t ON t.id=tc.trip_id WHERE t.trip_code LIKE 'BULK-TR-%')`).split('|');
check('p1.bulk-recreated', Number(stats[0]) > 0 && Number(stats[1]) > 0, `post-seed: bulk shipments=${stats[0]} bulk trips=${stats[1]} bulk trip_containers=${stats[2]}`);
check('p1.marker-restored', psql(`SELECT count(*) FROM shipments WHERE booking_ref='BULK-MARKER-DO-NOT-DELETE'`) === '1', 'BULK marker row present again (marker lives on booking_ref, seed-bulk-data.ts:510)');

// (a)+(b): every NUMBERED seeded trip_container must carry the link, and the
// linked lot row's number must equal the trip row's number (seed copies both
// from the same sc row). Numberless seeded rows are lawful.
const numbered = Number(psql(`SELECT count(*) FROM trip_containers tc JOIN trips t ON t.id=tc.trip_id WHERE t.trip_code LIKE 'BULK-TR-%' AND tc.container_number IS NOT NULL`));
const numberedLinked = Number(psql(`SELECT count(*) FROM trip_containers tc JOIN trips t ON t.id=tc.trip_id WHERE t.trip_code LIKE 'BULK-TR-%' AND tc.container_number IS NOT NULL AND tc.source_shipment_container_id IS NOT NULL`));
check('p1.numbered-linked', numbered > 0 && numbered === numberedLinked, `(b) seeded numbered trip_containers=${numbered}, with source_shipment_container_id=${numberedLinked}`);
const numberMismatch = Number(psql(`SELECT count(*) FROM trip_containers tc JOIN trips t ON t.id=tc.trip_id JOIN shipment_containers sc ON sc.id=tc.source_shipment_container_id WHERE t.trip_code LIKE 'BULK-TR-%' AND tc.container_number IS NOT NULL AND sc.container_number <> tc.container_number`));
check('p1.number-about-lot', numberMismatch === 0, `(c) seeded rows whose number differs from their lot row=${numberMismatch}`);

console.log('\n(a) sample of seeded linked rows (id → sc id, numbers):');
console.log(psqlPretty(`SELECT tc.id, tc.source_shipment_container_id AS sc_id, tc.container_number AS tc_num, sc.container_number AS sc_num FROM trip_containers tc JOIN trips t ON t.id=tc.trip_id JOIN shipment_containers sc ON sc.id=tc.source_shipment_container_id WHERE t.trip_code LIKE 'BULK-TR-%' ORDER BY tc.id LIMIT 5`));

// ── (d) invariant queries over the whole db after the flow ───────────────────
const q1 = psqlPretty(Q_MISMATCH);
const q2 = psqlPretty(Q_ORPHAN);
console.log(`\n--- ${label}: mismatch query (issue 762, verbatim) ---\n${q1}`);
console.log(`--- ${label}: orphan-with-number query ---\n${q2}`);
check(`${label}.mismatch-0row`, q1.includes('(0 rows)'), 'Q1 = 0 rows after seed');
check(`${label}.orphan-0row`, q2.includes('(0 rows)'), 'Q2 = 0 rows after seed');
console.log('\n--- summary counts (round-1 shape) ---');
console.log(psqlPretty(`SELECT count(*) FILTER (WHERE tc.container_number IS NOT NULL) AS numbered_rows, count(*) FILTER (WHERE tc.container_number IS NOT NULL AND tc.source_shipment_container_id IS NOT NULL) AS numbered_and_linked, count(*) FILTER (WHERE tc.container_number IS NULL) AS numberless_rows, count(*) AS total_rows FROM trip_containers tc;`));

finish(label);
process.exit(0);
