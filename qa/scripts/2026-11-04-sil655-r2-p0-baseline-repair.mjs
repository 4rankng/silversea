// SIL-655 round-2 — probe 0 (preflight): ambient-baseline repair.
// The local dev db (ss-prod-db) was restored from an older snapshot after the
// 2026-11-03 round-1 verification, resurrecting 2 legacy mismatch rows
// (trip_containers 12 and 17 — lot rows with NULL container_number; the same
// rows the SIL-653 backfill had already repaired before round-1, see
// qa/2026-11-03-sil655/REPORT.md §3). These rows pre-date every insert path
// under test, so before the 4 path probes assert the round-1 mismatch query
// = 0 rows, this preflight repairs the ambient baseline with the CANONICAL
// repo code path — the SIL-653 identity bridge
// (syncShipmentIdentityFromTripContainers) — never hand-written SQL.
// Run: cd backend && npx tsx ../qa/scripts/2026-11-04-sil655-r2-p0-baseline-repair.mjs
import { db } from '../../backend/src/db/index.js';
import { syncShipmentIdentityFromTripContainers } from '../../backend/src/services/shipment-containers.service.js';
import { Q_MISMATCH, Q_ORPHAN, check, finish, psql, psqlPretty } from './2026-11-04-sil655-r2-lib.mjs';

const label = 'p0-baseline-repair';
console.log('--- baseline mismatch query BEFORE repair (issue 762, verbatim) ---');
const before = psqlPretty(Q_MISMATCH);
console.log(before);

const ids = psql(Q_MISMATCH).split('\n').filter(Boolean).map(Number);
if (ids.length === 0) {
  console.log('baseline already clean — nothing to repair');
  check('p0.noop', true, 'mismatch 0 rows before repair');
} else {
  check('p0.legacy-only', ids.every((id) => id <= 1000), `violating row ids=${ids.join(',')} (legacy rows, low ids)`);
  console.log(`repairing via canonical SIL-653 bridge: syncShipmentIdentityFromTripContainers(tx, [${ids.join(',')}])`);
  await db.transaction((tx) => syncShipmentIdentityFromTripContainers(tx, ids));
  const after = psqlPretty(Q_MISMATCH);
  console.log('--- mismatch query AFTER repair ---');
  console.log(after);
  check('p0.mismatch-0row', after.includes('(0 rows)'), 'Q1 = 0 rows after canonical bridge repair');
  // The repair mirrors trip numbers onto the lot rows — prove it landed.
  for (const id of ids) {
    const [tcNum, scNum] = psql(`SELECT tc.container_number, sc.container_number FROM trip_containers tc JOIN shipment_containers sc ON sc.id=tc.source_shipment_container_id WHERE tc.id=${id}`).split('|');
    check(`p0.row-${id}-mirrored`, tcNum === scNum && tcNum != null && tcNum !== '', `tc#${id}=${tcNum} == sc=${scNum}`);
  }
}

console.log('--- orphan-with-number query after ---');
console.log(psqlPretty(Q_ORPHAN));
check('p0.orphan-0row', psql(Q_ORPHAN) === '', 'Q2 = 0 rows');
finish(label);
process.exit(0);
