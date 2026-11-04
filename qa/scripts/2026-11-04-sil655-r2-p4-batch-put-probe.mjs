// SIL-655 round-2 — probe 4: trip-edit batch PUT (batchUpsertTripContainers,
// forwarder-container.service.ts:528). Path law: a numbered row (new, or
// existing-unlinked) resolves against the lot or the whole batch 409s —
// resolved rows get source_shipment_container_id, the batch mirrors number +
// primary seal onto the lot rows via the SIL-653 bridge, and trips.version
// bumps. A rejected batch must roll back completely (no rows, no version bump).
// Evidence: (a) inserted row id, (b) link re-read, (c) bridge write on the lot
// row (seal mirror), (d) mismatch + orphan queries 0 rows + rollback proof.
// Run: cd backend && npx tsx ../qa/scripts/2026-11-04-sil655-r2-p4-batch-put-probe.mjs
import { batchUpsertTripContainers } from '../../backend/src/services/forwarder-container.service.js';
import { ApiError } from '../../backend/src/errors.js';
import {
  anyUserId, assertMismatchZero, check, cleanupFixture, finish, freshNumber,
  makeFixture, psql, psqlPretty,
} from './2026-11-04-sil655-r2-lib.mjs';

const label = 'p4-batch-put';
const userId = anyUserId();
const fx = makeFixture();

// ── Arm 1: batch PUT with a lot-declared number → LINK + bridge + version bump
const SEAL = 'SIL655R2-BATCH';
const items = await batchUpsertTripContainers(fx.tripId, userId, [{
  containerNumber: ` ${fx.number.toLowerCase()} `, // non-canonical input on purpose
  sealNumber: SEAL,
  cargoWeightKg: '18000',
  notes: 'sil655-r2 p4 probe',
}], fx.version);
check('p4.batch-items', items.length === 1, `batch returned ${items.length} item(s)`);
const tcId = items[0].id;
check('p4.inserted-id', Number.isInteger(tcId), `(a) inserted trip_container id=${tcId}`);

const row = psql(`SELECT source_shipment_container_id, source_shipment_id, container_number, seal_number
  FROM trip_containers WHERE id=${tcId}`).split('|');
check('p4.link-set', row[0] === String(fx.scId), `(b) source_shipment_container_id=${row[0]} expected ${fx.scId}`);
check('p4.source-shipment', row[1] === String(fx.shipmentId), `source_shipment_id=${row[1]} expected ${fx.shipmentId}`);
check('p4.number-canonical', row[2] === fx.number, `container_number stored=${row[2]} expected ${fx.number}`);
check('p4.primary-seal', row[3] === SEAL, `seal_number=${row[3]} expected ${SEAL}`);

const version = psql(`SELECT version FROM trips WHERE id=${fx.tripId}`);
const [lotSeal, lotNumber] = psql(`SELECT coalesce(seal_number,'<NULL>'), container_number FROM shipment_containers WHERE id=${fx.scId}`).split('|');
check('p4.version-bumped', Number(version) === fx.version + 1, `trips.version=${version} expected ${fx.version + 1} (real batch path executed)`);
check('p4.bridge-seal-mirrored', lotSeal === SEAL, `(c) lot sc#${fx.scId} seal after=${lotSeal} expected ${SEAL} (bridge wrote it)`);
check('p4.bridge-number-about-lot', lotNumber === fx.number, `(c) lot sc#${fx.scId} container_number=${lotNumber} = trip number`);

// ── Arm 2: batch with an UNDECLARED number → 409 + FULL rollback ────────────
const undeclared = freshNumber();
let threw = null;
try {
  // Desired state = replace everything with one bogus-numbered row: the good
  // row from arm 1 falls outside the incoming id set, so the delete inside the
  // tx runs BEFORE the rejection — the rollback must bring it back.
  await batchUpsertTripContainers(fx.tripId, userId, [{
    containerNumber: undeclared, sealNumber: null, notes: null,
  }], fx.version + 1);
} catch (e) { threw = e; }
check('p4.undeclared-409', threw instanceof ApiError && threw.statusCode === 409,
  `undeclared ${undeclared} → ${threw ? `ApiError ${threw.statusCode}` : 'NO THROW'}`);
check('p4.undeclared-message', threw?.message?.includes('chưa được khai trên lô hàng của chuyến') ?? false, `message="${threw?.message}"`);
const after = psql(`SELECT count(*) FROM trip_containers WHERE trip_id=${fx.tripId}`);
const linkAfter = psql(`SELECT source_shipment_container_id FROM trip_containers WHERE id=${tcId}`);
const versionAfter = psql(`SELECT version FROM trips WHERE id=${fx.tripId}`);
check('p4.rollback-rows', after === '1' && linkAfter === String(fx.scId), `rejected batch left exactly the arm-1 row (rows=${after}, link=${linkAfter}) — full rollback`);
check('p4.rollback-version', versionAfter === String(fx.version + 1), `version=${versionAfter} unchanged by rejected batch`);

// ── (d) invariant queries after the whole flow ───────────────────────────────
assertMismatchZero(label);
console.log('\n--- summary counts (round-1 shape) ---');
console.log(psqlPretty(`SELECT count(*) FILTER (WHERE tc.container_number IS NOT NULL) AS numbered_rows, count(*) FILTER (WHERE tc.container_number IS NOT NULL AND tc.source_shipment_container_id IS NOT NULL) AS numbered_and_linked, count(*) FILTER (WHERE tc.container_number IS NULL) AS numberless_rows, count(*) AS total_rows FROM trip_containers tc;`));

cleanupFixture({ tripId: fx.tripId, scId: fx.scId, label });
finish(label);
process.exit(0);
