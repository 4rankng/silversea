// SIL-655 round-2 — probe 3: forwarder "Thêm container" POST
// (createTripContainerInClient, forwarder-container.service.ts:141).
// Path law: a numbered add resolves against the lot BEFORE insert —
//   matching number  → row inserted WITH source_shipment_container_id + the
//                      SIL-653 bridge runs (identity mirrors onto the lot row);
//   undeclared number→ 409, nothing stored.
// Evidence: (a) inserted row id, (b) link re-read from db, (c) bridge write on
// the lot row (seal mirror — number side is a diff-guarded no-op on a fresh
// LINK), (d) mismatch + orphan queries 0 rows.
// Run: cd backend && npx tsx ../qa/scripts/2026-11-04-sil655-r2-p3-forwarder-post-probe.mjs
import { createTripContainer } from '../../backend/src/services/forwarder-container.service.js';
import { ApiError } from '../../backend/src/errors.js';
import {
  anyUserId, assertMismatchZero, check, cleanupFixture, finish, freshNumber,
  makeFixture, psql, psqlPretty,
} from './2026-11-04-sil655-r2-lib.mjs';

const label = 'p3-forwarder-post';
const userId = anyUserId();
console.log(`actor userId=${userId}`);

const fx = makeFixture();

// ── Pre-state: the fixture lot row has NO seal (bridge must write it) ───────
const sealBefore = psql(`SELECT coalesce(seal_number,'<NULL>') FROM shipment_containers WHERE id=${fx.scId}`);
check('pre.lot-seal-null', sealBefore === '<NULL>', `sc#${fx.scId} seal before=${sealBefore}`);

// ── Arm 1: number declared on the lot → LINK + bridge ───────────────────────
const SEAL = 'SIL655R2-SEAL1';
const created = await createTripContainer({
  tripId: fx.tripId,
  containerNumber: fx.number.toLowerCase().replace(/(.{4})(.{4})/, '$1 $2'), // non-canonical input on purpose
  sealNumber: null,
  cargoWeightKg: '18000',
  notes: 'sil655-r2 p3 probe',
  createdBy: userId,
  seals: [{ sealNumber: SEAL }],
});
check('p3.inserted-id', Number.isInteger(created.id), `inserted trip_container id=${created.id}`);

const row = psql(`SELECT source_shipment_container_id, source_shipment_id, container_number, seal_number
  FROM trip_containers WHERE id=${created.id}`).split('|');
check('p3.link-set', row[0] === String(fx.scId), `(b) source_shipment_container_id=${row[0]} expected ${fx.scId}`);
check('p3.source-shipment', row[1] === String(fx.shipmentId), `source_shipment_id=${row[1]} expected ${fx.shipmentId}`);
check('p3.number-canonical', row[2] === fx.number, `container_number stored=${row[2]} expected ${fx.number} (normalized from spaced/lowercase input)`);
check('p3.primary-seal', row[3] === SEAL, `seal_number=${row[3]} expected ${SEAL}`);

const seals = psql(`SELECT count(*) FROM trip_container_seals WHERE trip_container_id=${created.id} AND seal_number='${SEAL}'`);
check('p3.seal-row', seals === '1', `trip_container_seals rows=${seals}`);

// (c) bridge: the SIL-653 identity sync mirrored the primary seal onto the lot
// row (number side was a diff-guarded no-op — the LINK just matched it).
const lot = psql(`SELECT coalesce(seal_number,'<NULL>'), container_number FROM shipment_containers WHERE id=${fx.scId}`).split('|');
check('p3.bridge-seal-mirrored', lot[0] === SEAL, `(c) lot sc#${fx.scId} seal after=${lot[0]} expected ${SEAL} (bridge wrote it)`);
check('p3.bridge-number-about-lot', lot[1] === fx.number, `(c) lot sc#${fx.scId} container_number=${lot[1]} = trip number`);

// ── Arm 2: number NOT declared on the lot → 409, nothing stored ─────────────
const undeclared = freshNumber();
const before = psql(`SELECT count(*) FROM trip_containers WHERE trip_id=${fx.tripId}`);
let threw = null;
try {
  await createTripContainer({
    tripId: fx.tripId, containerNumber: undeclared, sealNumber: null,
    notes: null, createdBy: userId,
  });
} catch (e) { threw = e; }
check('p3.undeclared-409', threw instanceof ApiError && threw.statusCode === 409,
  `undeclared ${undeclared} → ${threw ? `ApiError ${threw.statusCode}` : 'NO THROW'}`);
check('p3.undeclared-message', threw?.message?.includes('chưa được khai trên lô hàng của chuyến') ?? false,
  `message="${threw?.message}"`);
const after = psql(`SELECT count(*) FROM trip_containers WHERE trip_id=${fx.tripId}`);
check('p3.undeclared-no-row', after === before && after === '1', `trip rows before=${before} after=${after} (no orphan row stored)`);

// ── Arm 3: same number twice on one trip → 409 duplicate ────────────────────
threw = null;
try {
  await createTripContainer({
    tripId: fx.tripId, containerNumber: fx.number, sealNumber: null,
    notes: null, createdBy: userId,
  });
} catch (e) { threw = e; }
check('p3.duplicate-409', threw instanceof ApiError && threw.statusCode === 409,
  `duplicate ${fx.number} → ${threw ? `ApiError ${threw.statusCode}` : 'NO THROW'}`);
check('p3.duplicate-message', threw?.message?.includes('đã có trên chuyến này') ?? false, `message="${threw?.message}"`);

// ── (d) invariant queries after the whole flow ───────────────────────────────
assertMismatchZero(label);
console.log('\n--- summary counts (round-1 shape) ---');
console.log(psqlPretty(`SELECT count(*) FILTER (WHERE tc.container_number IS NOT NULL) AS numbered_rows, count(*) FILTER (WHERE tc.container_number IS NOT NULL AND tc.source_shipment_container_id IS NOT NULL) AS numbered_and_linked, count(*) FILTER (WHERE tc.container_number IS NULL) AS numberless_rows, count(*) AS total_rows FROM trip_containers tc;`));

cleanupFixture({ tripId: fx.tripId, scId: fx.scId, label });
finish(label);
process.exit(0);
