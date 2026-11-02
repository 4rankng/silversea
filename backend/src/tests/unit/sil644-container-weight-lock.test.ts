/**
 * SIL-644 (id 749) — the cargo-weight dead end. Lot 285 (SHP-2610-00194,
 * container TEST5810010, 40DC) had a vehicle assigned but the order never
 * issued: "Phát lệnh" 409'd (missing weight → no price) while EVERY weight
 * write path 409'd too ("Không thể thay đổi container sau khi đã phát hành
 * lệnh điều xe"), because both guards treated ANY live trip as issued. The
 * lot was permanently stuck.
 *
 * Owner law implemented (option (a), ticket's own key distinction): a live
 * trip still in CREATED is an ASSIGNMENT awaiting Phát lệnh, not an issued
 * order — the container stays editable there for its cargo measures
 * (trọng tải/CBM, the exact price input) and identity fields; only a trip
 * that LEFT CREATED (IN_TRANSIT/COMPLETED) locks the container. Pinned here
 * as source-wiring scans in the unit-only tree (2026-10-19 owner ruling: the
 * db-bound guards cannot boot); the behavioral half runs as the qa/scripts
 * integration probe against the local stack.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { sameInstantOrNull } from '@tingting/shared';

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative: string) => readFileSync(join(here, relative), 'utf8');
const containersService = read('../../services/shipment-containers.service.ts');
const writesService = read('../../services/cus-shipment-workspace-writes.service.ts');
const readsService = read('../../services/cus-shipment-workspace-reads.service.ts');

const guardSource = () => containersService.slice(
  containersService.indexOf('export async function reconcileShipmentContainersWithFulfillmentGuard'),
  containersService.indexOf('export function parsePlanUpdateSnapshot'),
);

describe('SIL-644 reconcile guard separates assignment from issuance', () => {
  test('the issued law is per-field since SIL-653 — no blanket throw may return', () => {
    const guard = guardSource();
    // SIL-653 (id 760) superseded the blanket issued 409 (it locked even the
    // container NUMBER — the driver app could never learn "CHƯA CÓ SỐ CONT"'s
    // value). The issued set now feeds a per-field lock below; pin that the
    // blanket throw never comes back.
    assert.match(guard, /const issuedFulfillments = activeFulfillments\.filter\(\s*\n\s*\(fulfillment\) => fulfillment\.tripId != null && fulfillment\.tripStatus !== 'CREATED',/);
    assert.doesNotMatch(guard, /issuedFulfillments\.length > 0/);
    assert.match(guard, /const issuedContainerIds = new Set\(issuedFulfillments/);
    // The old blanket law is gone: no 409 may key on tripId presence alone.
    assert.doesNotMatch(guard, /activeFulfillments\.some\(\(fulfillment\) => fulfillment\.tripId != null\)/);
  });

  test('an assigned container must survive the batch and may not change guarded plan fields', () => {
    const guard = guardSource();
    // Removing an assigned container stays behind the dispatch flow.
    assert.match(guard, /assignedContainerIds/);
    assert.match(guard, /Không thể bỏ container đã được điều xe\. Hãy hủy hoặc thay thế phân xe theo quy trình điều vận\./);
    // The guarded plan-field set the trip was built from.
    assert.match(guard, /next\.containerTypeId !== undefined/);
    assert.match(guard, /next\.routeId !== undefined/);
    assert.match(guard, /next\.operationalSiteId !== undefined/);
    assert.match(guard, /appointmentChanged/);
    assert.match(guard, /next\.classification !== undefined/);
  });

  test('only unassigned fulfillments are canceled — the dispatcher assignment survives', () => {
    const guard = guardSource();
    assert.match(guard, /const refreshableFulfillments = activeFulfillments\.filter\(\(fulfillment\) => fulfillment\.tripId == null\);/);
    assert.match(guard, /inArray\(s\.shipmentFulfillments\.id, refreshableFulfillments\.map\(\(fulfillment\) => fulfillment\.id\)\)/);
  });

  test('appointment equality treats omitted, null and instant equality honestly', () => {
    assert.equal(sameInstantOrNull(undefined, new Date('2026-10-29T05:00:00Z')), true);
    assert.equal(sameInstantOrNull(null, null), true);
    assert.equal(sameInstantOrNull(null, new Date('2026-10-29T05:00:00Z')), false);
    assert.equal(sameInstantOrNull('2026-10-29T05:00:00Z', null), false);
    assert.equal(sameInstantOrNull('2026-10-29T05:00:00Z', new Date('2026-10-29T05:00:00Z')), true);
    assert.equal(sameInstantOrNull('2026-10-29T12:00:00+07:00', new Date('2026-10-29T05:00:00Z')), true);
    assert.equal(sameInstantOrNull('2026-10-30T05:00:00Z', new Date('2026-10-29T05:00:00Z')), false);
  });
});

describe('SIL-644 workspace line write unlocks cargo measures in the assignment window', () => {
  test('weight/volume no longer count as blocking mutations while the trip is CREATED', () => {
    // The ledger container editor saves through updateCusShipmentContainerLine;
    // its value-aware trip guard must gate the cargo-measure clauses on the
    // ISSUED state, not on trip presence.
    assert.match(
      writesService,
      /\|\| \(trip != null && trip\.status !== 'CREATED'\s*\n\s*&& args\.input\.cargoWeightKg !== undefined && args\.input\.cargoWeightKg !== container\.cargoWeightKg\)/,
    );
    assert.match(
      writesService,
      /\|\| \(trip != null && trip\.status !== 'CREATED'\s*\n\s*&& args\.input\.cargoVolumeCbm !== undefined && args\.input\.cargoVolumeCbm !== container\.cargoVolumeCbm\)/,
    );
  });

  test('the type/route/factory/appointment/carrier denial keeps its trip presence gate', () => {
    assert.match(writesService, /if \(trip && requestedOperationalMutation\) \{/);
  });
});

describe('SIL-644 ledger fieldAccess opens the weight field in the assignment window', () => {
  test('the issuance-window override upgrades cargo measures for CREATED trips only', () => {
    assert.match(readsService, /function withIssuanceWindowFieldAccess\(/);
    assert.match(readsService, /line\.tripStatus !== TripStatus\.CREATED\) return line/);
    assert.match(readsService, /cargoWeightKg: \{ mode: 'DIRECT', reason \}/);
    assert.match(readsService, /cargoVolumeCbm: \{ mode: 'DIRECT', reason \}/);
  });

  test('BOTH ledger projections ride the override — detail editor and flat list', () => {
    // The workspace detail (the inline editor's `line`) ...
    assert.match(readsService, /\.map\(\(container, index\) => withIssuanceWindowFieldAccess\(/);
    // ... and the flat list row (the ledger cell affordance).
    assert.match(readsService, /const line = withIssuanceWindowFieldAccess\(/);
  });
});
