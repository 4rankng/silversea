/**
 * SIL-666 round-2 (id 773) — the TRIP-side rig scans obey the visibility law.
 *
 * QA round-3b (staging 6737cbf1): a brand-new SINGLE lot on 31/12 08:00
 * assigned to 15H-061.14 → 409 "Cần cả 2 cont cùng khai báo KẸP mới cho đi
 * chung xe" naming nothing, while the same truck on 21/12 saves clean —
 * date-dependent phantom. The plan-rows grid showed ZERO truck-39 rows on
 * 31/12 and QA never checked the trips table. Root cause: SIL-638 TC1 gave
 * the PLAN-ROW holder scans the visibility law (deleted lot / non-operational
 * lot / canceled fulfillment must not block), but the TRIP-side scans of the
 * same guards never got it — a trip whose lot was later deleted still claimed
 * the rig from the shadows (local repro: hidden DOUBLE trip 831, CREATED, lot
 * deleted, on 31/12 08:00 → the TC2 mismatch 409; qa/2026-11-04-sil666b/).
 *
 * The fix: `tripHolderVisibilitySql()` (dispatch-resource-availability.service,
 * beside the trip-claim SQL — the conflict-scan module is an import-cycle
 * leaf) spread into all three trip-conflict scans:
 *   1. assertPlanRowRigAvailable tripConflictsRaw (plan-assign PATCH gate),
 *   2. assertTripRigAvailable activeConflictsRaw (trip create/edit guard),
 *   3. assertResourceAvailability (issue/reassign gate).
 *
 * DB-free per the BE unit-only ruling (2026-10-19): the generated predicates
 * are pinned through PgDialect.sqlToQuery; the wiring through source scan;
 * the data-level before/after proof lives in
 * qa/scripts/2026-11-04-sil666b-date-phantom-repro.mjs (31/12 → 409 before,
 * 200 after; BULK-TR-0180 keeps its named hard tier in BOTH phases).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import { PgDialect } from 'drizzle-orm/pg-core';

import {
  OPERATIONAL_HOLDER_SHIPMENT_STATUSES,
  tripHolderVisibilitySql,
} from '../../services/dispatch-resource-availability.service';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (name: string): string =>
  readFileSync(path.join(here, '../../services', name), 'utf8');
const availabilitySource = read('dispatch-resource-availability.service.ts');
const conflictScanSource = read('dispatch-plan-conflict-scan.service.ts');
const detailPlanSource = read('dispatch-planning-detail-plan.service.ts');

describe('SIL-666 round-2 — the trip-side visibility law', () => {
  const dialect = new PgDialect();
  const arms = tripHolderVisibilitySql();
  const [ffArm, lotArm] = arms.map((predicate) => dialect.sqlToQuery(predicate));

  it('the builder emits exactly two predicates: the fulfillment arm and the lot arm', () => {
    assert.equal(arms.length, 2);
  });

  it('the fulfillment arm keeps fulfillment-LESS tasks (BULK) blocking', () => {
    // `fulfillment.id is null or fulfillment.canceled_at is null` — a trip
    // with NO fulfillment row carries no lot to hide and keeps its pinned
    // named hard tier (SIL-666 round-1, BULK-TR-0180).
    assert.match(ffArm.sql, /"shipment_fulfillments"\."id" is null/);
    assert.match(ffArm.sql, /"shipment_fulfillments"\."canceled_at" is null/);
    assert.deepEqual(ffArm.params, []);
  });

  it('the lot arm admits shipment-less trips and filters deleted/non-operational lots', () => {
    assert.match(lotArm.sql, /"shipments"\."id" is null/);
    assert.match(lotArm.sql, /"shipments"\."deleted_at" is null/);
    assert.match(lotArm.sql, /"shipments"\."status" in /);
    assert.deepEqual(lotArm.params, [...OPERATIONAL_HOLDER_SHIPMENT_STATUSES]);
  });

  it('the operational status set still mirrors the plan-row read filter verbatim', () => {
    assert.deepEqual(
      [...OPERATIONAL_HOLDER_SHIPMENT_STATUSES],
      ['READY_FOR_DISPATCH', 'DISPATCHED', 'IN_TRANSIT', 'COMPLETED'],
    );
  });

  it('ALL THREE trip-conflict scans spread the law', () => {
    // 1 — the plan-assign gate's dispatched-trip scan.
    const planGuardBlock = detailPlanSource.match(
      /const tripConflictsRaw = await tx\.select\(\{[\s\S]*?\n {4}\)\);/,
    );
    assert.ok(planGuardBlock, 'tripConflictsRaw must exist');
    assert.match(planGuardBlock[0], /\.\.\.tripHolderVisibilitySql\(\)/);
    // 2 — the trip create/edit guard's active-trip scan.
    const tripGuardBlock = conflictScanSource.match(
      /const activeConflictsRaw = await tx\.select\(\{[\s\S]*?\n {4}\)\);/,
    );
    assert.ok(tripGuardBlock, 'activeConflictsRaw must exist');
    assert.match(tripGuardBlock[0], /\.\.\.tripHolderVisibilitySql\(\)/);
    // 3 — the issue/reassign gate's conflict scan.
    const issueGateBlock = availabilitySource.match(
      /const conflicts = await tx\.select\(\{[\s\S]*?\n {4}\)\);/,
    );
    assert.ok(issueGateBlock, 'assertResourceAvailability conflict scan must exist');
    assert.match(issueGateBlock[0], /\.\.\.tripHolderVisibilitySql\(\)/);
  });

  it('the plan-row holder scans keep their own TC1 filters (no law regression)', () => {
    for (const scan of ['scanPlanRowHolders', 'scanLclPlanRowHolders']) {
      const block = conflictScanSource.match(
        new RegExp(`export async function ${scan}[\\s\\S]*?\\n}\\n`),
      );
      assert.ok(block, `${scan} must exist`);
      assert.match(block[0], /isNull\(s\.shipments\.deletedAt\)/);
      assert.match(block[0], /isNull\(s\.shipmentFulfillments\.canceledAt\)/);
      assert.match(block[0], /inArray\(s\.shipments\.status, \[\.\.\.OPERATIONAL_HOLDER_SHIPMENT_STATUSES\]\)/);
    }
  });
});
