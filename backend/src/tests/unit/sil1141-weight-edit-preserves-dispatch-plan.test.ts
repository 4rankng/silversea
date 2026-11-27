/**
 * SIL-1141 — a weight-only "Sửa lô hàng" save WIPED the dispatch allocation
 * (QA: lot 629, QBOBD39C, allocated SilverSea 15H-104.03 + driver
 * Bùi Tiến Dũng; the save returned success and on reopen the vehicle/driver
 * columns were empty; re-assigning a different vehicle could not restore).
 *
 * Root cause: the container-batch reconcile's refresh mechanism
 * (reconcileShipmentContainersWithFulfillmentGuard) keyed "assigned" on
 * `tripId != null` only. A pre-issue allocation lives on the fulfillment as
 * plannedCarrierType + plannedVehiclePlateNumber with NO trip row yet (the
 * trip is born at Phát lệnh), so every container reconcile — the edit form's
 * PUT /shipments/:id/containers runs on every Sửa lô hàng save — canceled the
 * allocated row ('REPLACED') and the next decomposition rebuilt it with NULL
 * planned columns. Silent data loss on a metadata-only save.
 *
 * Fix law: the refresh may only tear down a fulfillment that carries NEITHER
 * a live trip NOR a pre-issue dispatch plan (isRefreshableFulfillment); a
 * plan-carrying row survives and its site snapshot is re-projected in place
 * from the same authority the re-decompose would have read. Only explicit
 * dispatch actions (plan save, unassign, issue) change the planned columns.
 *
 * BE unit-only ruling (2026-10-19): the db-bound reconcile cannot boot here,
 * so the state machine runs against the extracted pure law and the
 * transactional wiring is pinned by source-scan (this file's established
 * pattern); the behavioral half runs as the qa/scripts probe against the
 * local stack.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  isRefreshableFulfillment,
  stableJsonStringify,
} from '../../services/shipment-containers.service';

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative: string) => readFileSync(join(here, relative), 'utf8');
const containersService = read('../../services/shipment-containers.service.ts');
const detailPlanService = read('../../services/dispatch-planning-detail-plan.service.ts');
const detailPlanRead = read('../../services/dispatch-planning-detail-plan-read.service.ts');
const fulfillmentService = read('../../services/shipment-fulfillment.service.ts');

const guardSource = () => containersService.slice(
  containersService.indexOf('export async function reconcileShipmentContainersWithFulfillmentGuard'),
  containersService.indexOf('export function parsePlanUpdateSnapshot'),
);

/** The lot-629 shape: OWN carrier + planned plate, driver resolved from the
 * plate by the plan read, no trip row yet (pre-Phát-lệnh). */
const lot629AllocatedRow = { tripId: null, plannedCarrierType: 'OWN' };

describe('SIL-1141 — the refresh law keeps the dispatch plan through a metadata-only save', () => {
  it('QA repro state — an allocated-but-unissued row is NOT refreshable, so a weight edit cannot wipe it', () => {
    assert.equal(isRefreshableFulfillment(lot629AllocatedRow), false);
  });

  it('every other plan-carrying state is protected too', () => {
    // Assignment awaiting Phát lệnh (trip born in CREATED).
    assert.equal(isRefreshableFulfillment({ tripId: 41, plannedCarrierType: 'OWN' }), false);
    // Issued order (trip left CREATED) — the SIL-644 law, unchanged.
    assert.equal(isRefreshableFulfillment({ tripId: 42, plannedCarrierType: 'EXTERNAL' }), false);
    // External-carrier allocation without a plate yet ("Bổ sung sau").
    assert.equal(isRefreshableFulfillment({ tripId: null, plannedCarrierType: 'EXTERNAL' }), false);
  });

  it('plan-less trip-less rows keep the old refresh mechanism', () => {
    assert.equal(isRefreshableFulfillment({ tripId: null, plannedCarrierType: null }), true);
  });

  it('clearing the plan in the dispatch editor restores the refreshable shape', () => {
    // SIL-708 unassign writes plannedCarrierType null on the live row.
    assert.equal(isRefreshableFulfillment({ tripId: null, plannedCarrierType: null }), true);
  });

  it('the plate carries the driver: the plan read resolves the driver column from plannedVehiclePlateNumber', () => {
    // The driver column on the dispatch plan is plate-derived (truck
    // assignment), so preserving the plate IS preserving the driver — the
    // wipe showed both columns empty from the one lost row.
    assert.match(
      detailPlanRead,
      /where t\.license_plate = \$\{s\.shipmentFulfillments\.plannedVehiclePlateNumber\}/,
    );
  });
});

describe('SIL-1141 — transactional wiring pins (source-scan)', () => {
  it('the guard loads plannedCarrierType from the same select it filters on', () => {
    assert.match(guardSource(), /plannedCarrierType: s\.shipmentFulfillments\.plannedCarrierType,/);
  });

  it('the refresh cancel keeps its REPLACED bookkeeping for plan-less rows only', () => {
    const guard = guardSource();
    assert.match(guard, /cancellationReason: 'Container của lô hàng đã được cập nhật; cần gán lại nhà xe\.'/);
    assert.match(guard, /cancellationDisposition: 'REPLACED',/);
  });

  it('a plan-carrying row whose container the batch removes dies with the container', () => {
    const guard = guardSource();
    assert.match(guard, /const removedPlanFulfillmentIds = activeFulfillments/);
    assert.match(guard, /!batchContainerIds\.has\(fulfillment\.shipmentContainerId\)/);
    assert.match(guard, /cancellationReason: 'Container được gỡ khỏi lô hàng; kế hoạch xe theo cont kết thúc theo\.'/);
  });

  it('the surviving plan rows are re-projected from decompose authority in place', () => {
    const reconcile = containersService.slice(
      containersService.indexOf('export async function reconcileShipmentContainersInTx'),
      containersService.indexOf('export async function reconcileShipmentContainersWithFulfillmentGuard'),
    );
    assert.match(reconcile, /isNotNull\(s\.shipmentFulfillments\.plannedCarrierType\)/);
    assert.match(reconcile, /const lotSnapshot = await loadSiteSnapshot\(tx, shipment\)/);
    assert.match(reconcile, /mergeContainerSiteSnapshotOverride\(lotSnapshot, override\)/);
    // The refresh writes ONLY snapshot bookkeeping — never the plan columns.
    const refreshBlock = reconcile.slice(
      reconcile.indexOf('const staleRows'),
      reconcile.indexOf('return {\n    items'),
    );
    assert.match(refreshBlock, /siteSnapshot: row\.snapshot,/);
    assert.match(refreshBlock, /sourceShipmentVersion: shipment\.version \+ 1,/);
    assert.doesNotMatch(refreshBlock, /plannedCarrierType/);
    assert.doesNotMatch(refreshBlock, /plannedVehiclePlateNumber/);
    assert.doesNotMatch(refreshBlock, /canceledAt/);
  });

  it('the decompose snapshot loaders are exported for the reconcile reuse', () => {
    assert.match(fulfillmentService, /export async function loadSiteSnapshot\(/);
    assert.match(fulfillmentService, /export async function loadContainerSiteSnapshots\(/);
  });

  it('re-assign afterwards targets the SAME surviving row — the plan save writes the planned columns in place', () => {
    // The atomic plan save (the re-assign path QA used) updates the live row
    // by id + version; with the row no longer canceled/re-created, the
    // editor's fulfillment id survives the edit save and the re-assign lands.
    const planSave = detailPlanService.slice(
      detailPlanService.indexOf('export async function updateDispatchDetailPlanInTx'),
      detailPlanService.indexOf('export async function recomputeLotFullyPlated'),
    );
    assert.match(planSave, /isNull\(s\.shipmentFulfillments\.canceledAt\)/);
    assert.match(planSave, /plannedCarrierType: input\.carrierType,/);
    assert.match(planSave, /plannedVehiclePlateNumber: vehicle\.plannedVehiclePlateNumber,/);
  });
});

describe('SIL-1141 — stableJsonStringify snapshot-compare law', () => {
  it('equal content in different key order compares equal (jsonb round-trip)', () => {
    const stored = {
      pickupWarehouse: { id: 7, name: 'Kho Cảng', strictRules: true },
      deliverySite: { id: 3, name: 'Nhà máy A' },
    };
    const rebuilt = {
      deliverySite: { id: 3, name: 'Nhà máy A' },
      pickupWarehouse: { id: 7, name: 'Kho Cảng', strictRules: true },
    };
    assert.equal(stableJsonStringify(rebuilt) === stableJsonStringify(stored), true);
  });

  it('a genuinely moved factory compares unequal', () => {
    const stored = { deliverySite: { id: 3, name: 'Nhà máy A' }, pickupWarehouse: null };
    const rebuilt = { deliverySite: { id: 9, name: 'Nhà máy B' }, pickupWarehouse: null };
    assert.equal(stableJsonStringify(rebuilt) === stableJsonStringify(stored), false);
  });

  it('nested arrays and scalar nulls keep their positional and value identity', () => {
    assert.equal(stableJsonStringify({ contacts: [{ id: 2 }, { id: 1 }] })
      === stableJsonStringify({ contacts: [{ id: 1 }, { id: 2 }] }), false);
    assert.equal(stableJsonStringify({ a: null }) === stableJsonStringify({}), false);
    assert.equal(stableJsonStringify({ a: undefined }) === stableJsonStringify({}), true);
  });
});
