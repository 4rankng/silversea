/**
 * SIL-1020 — Ghép cặp Kẹp xong, cột PHÂN LOẠI trên /dispatch-detail và
 * /shipments-detail vẫn ghi "Đơn" (KB Ch.3 §3.5 K3.40: mỗi cặp ghép chỉ có
 * MỘT quan hệ ghép thống nhất trên mọi màn hình).
 *
 * Root cause: POST /trips/pairs wrote pairKind=KEP onto the trip-pair row but
 * left both fulfillments' dispatch_classification=SINGLE — and the PHÂN LOẠI
 * column (dispatch-detail grid `classification`, CUS container ledger
 * `DISPATCH_CLASSIFICATION_LABELS[row.classification]`) renders the stored
 * fulfillment classification, so Điều vận and CUS kept reading "Đơn" while
 * the driver app (pairKind reader) showed KẸP correctly.
 *
 * Fix: the pairing transaction stamps both legs' fulfillments with the kind's
 * classification (KEP→DOUBLE, KET_HOP→COMBINED) and every break path reverts
 * them to SINGLE, so the stored classification always agrees with the live
 * pair relation.
 *
 * BE unit-only ruling: the transactional write sites are pinned by
 * source-scan (the file's established pattern); the kind→classification
 * mapping is a pure law and is imported and asserted directly.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

import { classificationWithActivePair, pairClassificationForKind } from '../../services/trip-pair-rules.service';

const here = path.dirname(fileURLToPath(import.meta.url));
const pairsSource = readFileSync(
  path.join(here, '../../services/trip-pairs.service.ts'),
  'utf8',
);
const dispatchDetailSource = readFileSync(
  path.join(here, '../../services/dispatch-planning-detail-plan-read.service.ts'),
  'utf8',
);
const cusReadsSource = readFileSync(
  path.join(here, '../../services/cus-shipment-workspace-reads.service.ts'),
  'utf8',
);
const shipmentDetailReadsSource = readFileSync(
  path.join(here, '../../services/shipment-detail-reads.service.ts'),
  'utf8',
);
const lifecycleSource = readFileSync(
  path.join(here, '../../services/trip-lifecycle-ops.service.ts'),
  'utf8',
);
const pairingSource = readFileSync(
  path.join(here, '../../services/trip-pairing.service.ts'),
  'utf8',
);

describe('SIL-1020 — pair classification stamp keeps every screen on one relation', () => {
  it('KEP maps to DOUBLE and KET_HOP maps to COMBINED', () => {
    assert.equal(pairClassificationForKind('KEP'), 'DOUBLE');
    assert.equal(pairClassificationForKind('KET_HOP'), 'COMBINED');
  });

  it('createTripPairCoreInTx stamps both legs with the kind classification in the pairing tx', () => {
    // The stamp runs right after both trip updates, inside the same
    // transaction, driven by the shared pure mapping — never a hand-rolled
    // literal on one leg only.
    const stampBlock = pairsSource.match(
      /const legFulfillmentIds = \[locked\.first\.fulfillmentId, locked\.second\.fulfillmentId\]\s*\n\s*\.filter\(\(id\): id is number => id != null\);\s*\n\s*if \(legFulfillmentIds\.length > 0\) \{\s*\n\s*await tx\.update\(s\.shipmentFulfillments\)\s*\n\s*\.set\(\{\s*\n\s*dispatchClassification: pairClassificationForKind\(kind\),/,
    );
    assert.ok(stampBlock, 'the pairing tx must stamp both legs via pairClassificationForKind');
    const firstTripUpdateIdx = pairsSource.indexOf('await tx.update(s.trips).set(firstUpdate)');
    const stampIdx = pairsSource.indexOf('dispatchClassification: pairClassificationForKind(kind)');
    assert.ok(firstTripUpdateIdx > 0 && stampIdx > firstTripUpdateIdx,
      'the stamp must follow the trip updates inside the pairing transaction');
  });

  it('the pairing loader selects each leg\'s fulfillmentId', () => {
    const loaderBlock = pairsSource.match(/const rows = await tx\.select\(\{\s*\n\s*id: s\.trips\.id,[\s\S]*?fulfillmentId: s\.trips\.fulfillmentId,/);
    assert.ok(loaderBlock, 'loadTripsForPairing must carry fulfillmentId for the stamp');
  });

  it('breakPersistedTripPair reverts both legs to SINGLE on every break path', () => {
    const breakIdx = pairsSource.indexOf('async function breakPersistedTripPair');
    assert.ok(breakIdx > 0, 'breakPersistedTripPair must exist');
    const revertIdx = pairsSource.indexOf("dispatchClassification: 'SINGLE'", breakIdx);
    assert.ok(revertIdx > breakIdx, 'the break path must revert the legs to Đơn');
    // Both legs revert — the revert query rides the pair's two trip ids.
    const revertBlock = pairsSource.slice(revertIdx, revertIdx + 400);
    assert.match(revertBlock, /inArray\(s\.shipmentFulfillments\.id, legFulfillmentIds\)/,
      'the revert must cover every leg fulfillment of the broken pair');
  });
});

describe('SIL-1020 round 27 — the ACTIVE pair is the read-side classification authority', () => {
  it('an ACTIVE pair kind drives the classification regardless of a lagged stamp', () => {
    assert.equal(classificationWithActivePair('SINGLE', 'KEP'), 'DOUBLE',
      'a leg whose stamp lagged the pair write must still read Kẹp');
    assert.equal(classificationWithActivePair('SINGLE', 'KET_HOP'), 'COMBINED');
    assert.equal(classificationWithActivePair('DOUBLE', 'KEP'), 'DOUBLE');
  });

  it('without an ACTIVE pair the stored classification passes through untouched', () => {
    assert.equal(classificationWithActivePair('SINGLE', null), 'SINGLE');
    assert.equal(classificationWithActivePair('LCL', null), 'LCL');
    assert.equal(classificationWithActivePair('LCL_PICKUP', null), 'LCL_PICKUP');
    assert.equal(classificationWithActivePair(null, null), null);
  });

  it('Lẻ rows never inherit the clamp law — LCL/LCL_PICKUP keep their label', () => {
    assert.equal(classificationWithActivePair('LCL', 'KEP'), 'LCL');
    assert.equal(classificationWithActivePair('LCL', 'KET_HOP'), 'LCL');
    assert.equal(classificationWithActivePair('LCL_PICKUP', 'KET_HOP'), 'LCL_PICKUP');
  });

  it('dispatch-detail derives the PHÂN LOẠI cell from the ACTIVE pair', () => {
    assert.match(dispatchDetailSource, /classification: classificationWithActivePair\(\s*\n\s*row\.classification,\s*\n\s*row\.pairStatus === 'ACTIVE' \? row\.pairKind : null,/,
      'the dispatch-detail row must derive classification via classificationWithActivePair');
  });

  it('cus-workspace joins the ACTIVE pair onto assignment rows and derives the ledger cell', () => {
    assert.match(cusReadsSource, /\.leftJoin\(s\.tripPairs, and\(\s*\n\s*eq\(s\.tripPairs\.id, s\.trips\.activeTripPairId\),\s*\n\s*eq\(s\.tripPairs\.status, 'ACTIVE'\),/,
      'the assignment query must carry the ACTIVE trip pair');
    assert.match(cusReadsSource, /classification: classificationWithActivePair\(\s*\n\s*containerAssignment\?\.dispatchClassification,/,
      'the container spec cell must derive classification via classificationWithActivePair');
  });
});

describe('SIL-1020 — the chi tiết lô read carries the same one relation', () => {
  it('the detail pair decoration derives the leg classification via classificationWithActivePair', () => {
    assert.match(shipmentDetailReadsSource, /classification: classificationWithActivePair\(row\.dispatchClassification, pairKind\) \?\? fallbackClassification,/,
      'the chi tiết lô leg must derive PHÂN LOẠI exactly like /dispatch-detail and /shipments-detail');
  });

  it('the detail read joins the ACTIVE pair only — a broken pair never reads', () => {
    assert.match(shipmentDetailReadsSource, /\.leftJoin\(s\.tripPairs, and\(\s*\n\s*eq\(s\.tripPairs\.id, s\.trips\.activeTripPairId\),\s*\n\s*eq\(s\.tripPairs\.status, 'ACTIVE'\),/,
      'the detail pair join must ride the ACTIVE-pair law like the other two reads');
  });

  it('the "tên lô ghép cùng" names the partner leg with the house lot key', () => {
    assert.match(shipmentDetailReadsSource, /billOrBookNumberFor\(partnerLeg\.tradeDirection, partnerLeg\.blNumber, partnerLeg\.bookingRef\)/,
      'the partner member\'s name must be its Bill/Booking — the same key every screen names a lot with');
  });
});

describe('SIL-1020 round 29 — deleteTrip breaks the ACTIVE pair instead of orphaning it', () => {
  it('TRIP_DELETED is a first-class break reason', () => {
    assert.match(pairingSource, /\| 'TRIP_DELETED'/,
      'the break reason must ride the same union as UNPAIRED — no stringly row');
  });

  it('deleteTrip breaks the pair through breakPersistedTripPair inside its own tx', () => {
    const fnIdx = lifecycleSource.indexOf('export async function deleteTrip');
    assert.ok(fnIdx > 0, 'deleteTrip must exist');
    const body = lifecycleSource.slice(fnIdx, lifecycleSource.indexOf('export async function resolveReassignExternalVehicleId'));
    assert.match(body, /activeTripPairId: s\.trips\.activeTripPairId/,
      'the delete read must carry the pair link');
    assert.match(body, /breakReason: 'TRIP_DELETED'/,
      'the delete break must stamp TRIP_DELETED, not borrow a cancellation reason');
    assert.match(body, /await breakPersistedTripPair\(tx, \{/,
      'the break rides the one governed break — status, linkage, classification, economics');
    assert.match(body, /pair && pair\.status === 'ACTIVE'/,
      'a pair already broken (drift) never re-breaks — the delete still proceeds');
    assert.match(body, /tripId === pair\.secondTripId \? null : pair\.secondTripId/,
      'the toll-restore survivor is the second leg unless the deleted leg IS it');
  });

  it('the remaining leg releases its rig — truck and trailer go, the driver stays', () => {
    const fnIdx = lifecycleSource.indexOf('export async function deleteTrip');
    const body = lifecycleSource.slice(fnIdx, lifecycleSource.indexOf('export async function resolveReassignExternalVehicleId'));
    assert.match(body, /truckId: null,\s*\n\s*trailerId: null,/,
      'the remaining leg returns to chờ phân công with no rig claim');
    assert.match(body, /inArray\(s\.trips\.status, \[TripStatus\.CREATED, TripStatus\.IN_TRANSIT\]\)/,
      'only live schedules release — a terminal leg holds no rig claim');
    assert.match(body, /version: sql`\$\{s\.trips\.version\} \+ 1`/,
      'the release bumps the trip version so concurrent edits conflict honestly');
    assert.doesNotMatch(body, /driverId: null,/,
      'the driver stays on the remaining leg — the FB-081 acceptance law holds through a delete too');
  });

  it('clearActivePairOnTrips bumps the trip version on every break path', () => {
    const fnIdx = pairsSource.indexOf('async function clearActivePairOnTrips');
    assert.ok(fnIdx > 0, 'clearActivePairOnTrips must exist');
    const body = pairsSource.slice(fnIdx, pairsSource.indexOf('/** The one governed break every path rides'));
    assert.match(body, /version: sql`\$\{s\.trips\.version\} \+ 1`/,
      'a leg whose pair link was cleared must not keep a stale optimistic-lock '
      + 'version — the surviving leg held v3→v3 through an unpair (r28 live)');
    assert.match(body, /activeTripPairId: null,\s*\n\s*activeTripPairOrder: null,/,
      'the clear wipes both linkage fields on both legs');
  });
});
