// SIL-655 round-2 — probe 2: copyTrip link arm (trip-create.service.ts, the
// copyTrip insert of trip_containers). Path law: the copy carries
// source_shipment_id / source_shipment_container_id / source_shipment_version
// from every source row, while containerNumber/sealNumber stay NULL ("số cont
// phải mới") — a later number entered on the copy still bridges to the lot.
// Evidence: (a) copied row ids, (b) source_shipment_container_id re-read and
// compared to the source rows, (c) numbers/seals null per law, (d) mismatch +
// orphan queries 0 rows.
//
// EXECUTION FINDING (escalated, out of SIL-655 scope — no src fixes on this
// lane): under the current schema copyTrip CANNOT execute for a LIVE
// lot-linked source trip — the copy clones shipment_id/fulfillment_id/
// active_trip_pair_id+order (COPY_EXCLUDED_TRIP_FIELDS,
// trip-mutations-shared.service.ts:93, excludes none of them) and is reset to
// CREATED (live), so insert hits:
//   - trips_active_trip_pair_order_uniq        (source in an active pair)
//   - trips_fulfillment_id_live_uniq           (source has a fulfillment)
//   - trips_shipment_without_fulfillment_live_uniq (plain lot-linked source)
// The route (routes/trips/crud.ts:89 → copyTripWriteCommand → copyTripCommand)
// has NO guard, so "Sao chép chuyến" on a live lot-linked trip is an unhandled
// 23505. Arm 0 below captures that repro; arm 1 executes the copy arm under
// the ONLY schema-legal precondition — a CANCELED source (the copy becomes
// the lot's sole live trip). The canceled status is probe fixture prep on the
// LOCAL dev db and is restored + verified at the end.
// Run: cd backend && npx tsx ../qa/scripts/2026-11-04-sil655-r2-p2-copytrip-link-probe.mjs
import { copyTrip } from '../../backend/src/services/trip-create.service.js';
import {
  anyUserId, assertMismatchZero, check, finish, psql, psqlPretty,
} from './2026-11-04-sil655-r2-lib.mjs';

const label = 'p2-copytrip-link';
const userId = anyUserId();

// Source: a live shipment-linked seed trip whose containers are numbered AND
// lot-linked, no pair/fulfillment (the plain lot-linked class).
const src = psql(`
  SELECT t.id, t.shipment_id, t.status, count(tc.id)
  FROM trips t
  JOIN trip_containers tc ON tc.trip_id = t.id
    AND tc.source_shipment_container_id IS NOT NULL AND tc.container_number IS NOT NULL
  WHERE t.deleted_at IS NULL AND t.shipment_id IS NOT NULL
    AND t.active_trip_pair_id IS NULL AND t.fulfillment_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM shipment_accounting_locks l WHERE l.shipment_id = t.shipment_id)
  GROUP BY t.id, t.shipment_id, t.status
  ORDER BY t.id DESC LIMIT 1`).split('|');
if (src.length !== 4 || !src[0]) throw new Error('no numbered+linked lot-linked seed trip found');
const [sourceTripId, sourceShipmentId, sourceStatus, sourceCount] = [Number(src[0]), Number(src[1]), src[2], Number(src[3])];
console.log(`source trip=${sourceTripId} lot=shipment#${sourceShipmentId} status=${sourceStatus} numbered+linked containers=${sourceCount}`);

const sourceRows = psql(`SELECT id, source_shipment_container_id, container_number FROM trip_containers WHERE trip_id=${sourceTripId} AND source_shipment_container_id IS NOT NULL ORDER BY id`)
  .split('\n').filter(Boolean).map((l) => l.split('|'));
console.log('source rows:', sourceRows.map((r) => `tc#${r[0]}→sc#${r[1]} (${r[2]})`).join('  '));

// ── Arm 0: repro — copy of a LIVE lot-linked trip refuses with 23505 ────────
if (sourceStatus !== 'CANCELED') {
  let liveThrew = null;
  try { await copyTrip(sourceTripId, userId); } catch (e) { liveThrew = e; }
  const constraint = liveThrew?.cause?.constraint_name ?? liveThrew?.constraint_name ?? null;
  check('p2.live-copy-refused', liveThrew != null && constraint === 'trips_shipment_without_fulfillment_live_uniq',
    `(escalation repro) live-source copy → ${liveThrew ? `${liveThrew.constructor.name} constraint=${constraint}` : 'NO THROW — copy of live trip succeeded'}`);
}

// ── Fixture: cancel the source (local dev db), run the copy arm, restore ────
// NOTE: the source restore MUST happen after the probe copy is deleted — the
// copy occupies the lot's single live-trip slot while it exists, so restoring
// the source to a live status first would hit
// trips_shipment_without_fulfillment_live_uniq (that exact ordering bug left
// a leftover row in an earlier run; see qa/2026-11-04 REPORT.md).
psql(`UPDATE trips SET status='CANCELED', updated_at=now() WHERE id=${sourceTripId}`);
let copiedTrip = null;
let copyError = null;
try {
  copiedTrip = await copyTrip(sourceTripId, userId);
} catch (e) { copyError = e; }

// Assert region runs while the copy exists; the finally deletes the copy and
// restores the source on EVERY path (assert throw included) — deletion must
// precede the restore because the copy occupies the lot's single live-trip
// slot (trips_shipment_without_fulfillment_live_uniq).
try {
  const restored = psql(`SELECT status FROM trips WHERE id=${sourceTripId}`);
  check('p2.source-canceled-fixture', restored === 'CANCELED', `fixture: source trip ${sourceTripId} temporarily CANCELED during copy`);
  if (copyError != null) throw new Error(`copyTrip failed even on canceled source: ${copyError.message}`);
  check('p2.copy-trip-created', Number.isInteger(copiedTrip.id) && copiedTrip.id !== sourceTripId, `(a) copyTrip → trip id=${copiedTrip.id}`);
  check('p2.copy-stays-lot-linked', copiedTrip.shipmentId === sourceShipmentId, `copy shipment_id=${copiedTrip.shipmentId} expected ${sourceShipmentId}`);

  const copiedRows = psql(`SELECT id, source_shipment_container_id, source_shipment_id, container_number, seal_number
    FROM trip_containers WHERE trip_id=${copiedTrip.id} ORDER BY id`).split('\n').filter(Boolean)
    .map((l) => l.split('|'));
  const srcAll = psql(`SELECT id, source_shipment_container_id, container_number FROM trip_containers WHERE trip_id=${sourceTripId} ORDER BY id`)
    .split('\n').filter(Boolean).map((l) => l.split('|'));
  check('p2.copy-count', String(copiedRows.length) === String(srcAll.length), `copied container rows=${copiedRows.length} expected ${srcAll.length} (1:1 with all source rows)`);

  // Set-based pairing by lot link id: every source row must have exactly one
  // copied twin; every copied row must be numberless+sealless (copy law).
  const bySc = (rows) => rows.reduce((m, r) => { (m.get(r[1]) ?? m.set(r[1], []).get(r[1])).push(r); return m; }, new Map());
  const srcBySc = bySc(srcAll);
  const copyBySc = bySc(copiedRows);
  check('p2.link-set-parity', [...srcBySc.keys()].sort().join(',') === [...copyBySc.keys()].sort().join(','),
    `lot-link id sets identical (source=[${[...srcBySc.keys()].join(',')}] copy=[${[...copyBySc.keys()].join(',')}])`);
  for (const [scId, srcGroup] of srcBySc) {
    const copyGroup = copyBySc.get(scId) ?? [];
    check(`p2.sc${scId ?? 'null'}.parity`, copyGroup.length === srcGroup.length, `sc#${scId ?? 'null'}: ${srcGroup.length} source → ${copyGroup.length} copied`);
  }
  for (const [i, r] of copiedRows.entries()) {
    check(`p2.row${i}.id`, Number.isInteger(Number(r[0])), `(a) copied trip_container id=${r[0]}`);
    check(`p2.row${i}.link`, r[1] === 'NULL' || r[1] === '' || Number(r[1]) > 0, `(b) source_shipment_container_id=${r[1] || '<NULL>'} carried from its source row`);
    check(`p2.row${i}.numberless`, r[3] === 'NULL' || r[3] === '', `(c) containerNumber null per copy law (got ${r[3] || '<NULL>'})`);
    check(`p2.row${i}.sealless`, r[4] === 'NULL' || r[4] === '', `(c) sealNumber null per copy law (got ${r[4] || '<NULL>'})`);
  }
  const numberedCopies = copiedRows.filter((r) => r[3] !== 'NULL' && r[3] !== '').length;
  check('p2.zero-numbered-copies', numberedCopies === 0, `numbered copied rows=${numberedCopies} (law: numbers must be new)`);
  const lotAfter = psql(`SELECT container_number FROM shipment_containers WHERE id=${sourceRows[0][1]}`);
  check('p2.lot-number-intact', lotAfter === sourceRows[0][2], `(c) lot sc#${sourceRows[0][1]} container_number=${lotAfter} untouched by numberless copy`);
} finally {
  if (copiedTrip != null) {
    psql(`DELETE FROM trip_containers WHERE trip_id=${copiedTrip.id}`);
    psql(`DELETE FROM trip_legs WHERE trip_id=${copiedTrip.id}`);
    psql(`DELETE FROM trips WHERE id=${copiedTrip.id}`);
  }
  psql(`UPDATE trips SET status='${sourceStatus}', updated_at=now() WHERE id=${sourceTripId}`);
}
const restored = psql(`SELECT status FROM trips WHERE id=${sourceTripId}`);
check('p2.source-restored', restored === sourceStatus, `fixture undone: trip ${sourceTripId} status=${restored}`);
const residual = copiedTrip != null ? psql(`SELECT count(*) FROM trips WHERE id=${copiedTrip.id}`) : '0';
check('p2.cleanup', residual === '0', `probe copy removed (residual=${residual})`);

// ── (d) invariant queries after the flow (fixture fully undone) ──────────────
assertMismatchZero(label);
console.log('\n--- summary counts (round-1 shape) ---');
console.log(psqlPretty(`SELECT count(*) FILTER (WHERE tc.container_number IS NOT NULL) AS numbered_rows, count(*) FILTER (WHERE tc.container_number IS NOT NULL AND tc.source_shipment_container_id IS NOT NULL) AS numbered_and_linked, count(*) FILTER (WHERE tc.container_number IS NULL) AS numberless_rows, count(*) AS total_rows FROM trip_containers tc;`));
finish(label);
process.exit(0);
