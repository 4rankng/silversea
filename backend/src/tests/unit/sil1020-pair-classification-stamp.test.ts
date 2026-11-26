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
