/**
 * SIL-655 (id 762) — trip_containers mồ côi: 5/8 insert paths did not set
 * `source_shipment_container_id`, so the SIL-653 identity bridge silently
 * no-oped and a number the driver typed never reached the lot (dispatch/CUS
 * kept reading "Chưa có số cont").
 *
 * Law pinned here:
 * - A numbered trip_container on a shipment-linked trip must resolve to
 *   exactly one shipment_containers row of that lot (`source_shipment_container_id`)
 *   — or the write is refused with an explicit 409. Silently storing an
 *   unlinked numbered row is the bug class this ticket closes.
 * - Boundary (documented, invariant vacuous): trips with `trips.shipment_id
 *   IS NULL` have no lot to resolve against — numbers there stay trip-local.
 * - The LCL synthetic row (`__fulfillment_lcl:` marker) can never resolve:
 *   an LCL lot is lawfully container-less (two hard 409s pin that), so any
 *   number written onto it is refused, never silently stored.
 *
 * Unit-only tree (2026-10-19 owner ruling): the decision law is a pure
 * function; the db-bound wiring is pinned as source scans (the same
 * convention sil653-container-number-sync.test.ts uses).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decideTripContainerNumberLink,
  type TripContainerLinkContext,
} from '../../services/trip-container-link.service';

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative: string) => readFileSync(join(here, relative), 'utf8');
const tripCreateService = read('../../services/trip-create.service.ts');
const tripContainersService = read('../../services/forwarder-container.service.ts');
const dispatchService = read('../../services/dispatch-planning-commands.service.ts');
const fulfillmentService = read('../../services/shipment-fulfillment.service.ts');
const intakeService = read('../../services/shipment-intake.service.ts');

/** Test seam: the source slice between two exported symbols — the same
 *  convention sil653-container-number-sync.test.ts pins the bridge with. */
const sliceBetween = (source: string, start: string, end?: string) => {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `missing anchor: ${start}`);
  if (end == null) return source.slice(from);
  const to = source.indexOf(end, from);
  assert.ok(to > from, `missing end anchor: ${end}`);
  return source.slice(from, to);
};

const ctx = (partial: Partial<TripContainerLinkContext>): TripContainerLinkContext => ({
  tripShipmentId: null,
  lotContainers: [],
  tripRows: [],
  ...partial,
});

describe('SIL-655 — decideTripContainerNumberLink (the invariant law)', () => {
  test('SIL655-03: number matching an unlinked lot container → LINK with that id', () => {
    const decision = decideTripContainerNumberLink(ctx({
      tripShipmentId: 5,
      lotContainers: [{ id: 51, containerNumber: 'MSKU1234565' }, { id: 52, containerNumber: 'TCLU1234568' }],
      tripRows: [{ id: 1, sourceShipmentContainerId: null, containerNumber: null }],
    }), 'MSKU1234565', null);
    assert.deepEqual(decision, { kind: 'LINK', sourceShipmentContainerId: 51 });
  });

  test('SIL655-03: number NOT declared on the lot → REJECT_UNDECLARED (không được tạo dòng mồ côi có số)', () => {
    const decision = decideTripContainerNumberLink(ctx({
      tripShipmentId: 5,
      lotContainers: [{ id: 51, containerNumber: 'MSKU1234565' }],
      tripRows: [],
    }), 'CXDU1467500', null);
    assert.deepEqual(decision, { kind: 'REJECT_UNDECLARED' });
  });

  test('SIL655-04: LCL synthetic row + any number → REJECT_UNDECLARED (LCL lot has no containers)', () => {
    // The synthetic row lives on a shipment-linked trip whose lot is LCL:
    // lotContainers is empty because the intake/decomposition laws forbid
    // containers on an LCL lot — so every number is undeclared by law.
    const decision = decideTripContainerNumberLink(ctx({
      tripShipmentId: 9,
      lotContainers: [],
      tripRows: [{ id: 7, sourceShipmentContainerId: null, containerNumber: null }],
    }), 'MSKU1234565', 7);
    assert.deepEqual(decision, { kind: 'REJECT_UNDECLARED' });
  });

  test('SIL655-03: number already linked to another row of THIS trip → REJECT_DUPLICATE_ON_TRIP', () => {
    const decision = decideTripContainerNumberLink(ctx({
      tripShipmentId: 5,
      lotContainers: [{ id: 51, containerNumber: 'MSKU1234565' }],
      tripRows: [{ id: 3, sourceShipmentContainerId: 51, containerNumber: 'MSKU1234565' }],
    }), 'MSKU1234565', null);
    assert.deepEqual(decision, { kind: 'REJECT_DUPLICATE_ON_TRIP' });
  });

  test('duplicate by NUMBER on this trip (unlinked twin row) → REJECT_DUPLICATE_ON_TRIP', () => {
    const decision = decideTripContainerNumberLink(ctx({
      tripShipmentId: 5,
      lotContainers: [{ id: 51, containerNumber: 'MSKU1234565' }],
      tripRows: [{ id: 3, sourceShipmentContainerId: null, containerNumber: 'msku 1234 565' }],
    }), 'MSKU1234565', null);
    assert.deepEqual(decision, { kind: 'REJECT_DUPLICATE_ON_TRIP' });
  });

  test('PATCH re-saving its own row: the self row is excluded from the duplicate law', () => {
    const decision = decideTripContainerNumberLink(ctx({
      tripShipmentId: 5,
      lotContainers: [{ id: 51, containerNumber: 'MSKU1234565' }],
      tripRows: [{ id: 3, sourceShipmentContainerId: 51, containerNumber: 'MSKU1234565' }],
    }), 'MSKU1234565', 3);
    assert.deepEqual(decision, { kind: 'LINK', sourceShipmentContainerId: 51 });
  });

  test('batch twin rows on one lot container: the reserved set → REJECT_DUPLICATE_ON_TRIP', () => {
    const decision = decideTripContainerNumberLink(ctx({
      tripShipmentId: 5,
      lotContainers: [{ id: 51, containerNumber: 'MSKU1234565' }],
      tripRows: [],
    }), 'MSKU1234565', null, new Set([51]));
    assert.deepEqual(decision, { kind: 'REJECT_DUPLICATE_ON_TRIP' });
  });

  test('matching is normalized on both sides (separator/lowercase input)', () => {
    const decision = decideTripContainerNumberLink(ctx({
      tripShipmentId: 5,
      lotContainers: [{ id: 51, containerNumber: 'tcku 123456 0' }],
      tripRows: [],
    }), 'TCKU1234560', null);
    assert.deepEqual(decision, { kind: 'LINK', sourceShipmentContainerId: 51 });
  });

  test('boundary: trip without a lot (trips.shipment_id IS NULL) → NO_SHIPMENT, invariant vacuous', () => {
    const decision = decideTripContainerNumberLink(ctx({
      tripShipmentId: null,
      lotContainers: [],
      tripRows: [],
    }), 'MSKU1234565', null);
    assert.deepEqual(decision, { kind: 'NO_SHIPMENT' });
  });

  test('no number → NUMBERLESS (link not required at insert)', () => {
    assert.deepEqual(decideTripContainerNumberLink(ctx({ tripShipmentId: 5 }), null), { kind: 'NUMBERLESS' });
    assert.deepEqual(decideTripContainerNumberLink(ctx({ tripShipmentId: 5 }), '   '), { kind: 'NUMBERLESS' });
    assert.deepEqual(decideTripContainerNumberLink(ctx({ tripShipmentId: 5 }), undefined), { kind: 'NUMBERLESS' });
  });
});

describe('SIL-655 — forwarder write paths resolve the link and bridge (source wiring)', () => {
  test('SIL655-03: the add-container POST (driver + forwarder) resolves-or-throws BEFORE the insert', () => {
    const slice = sliceBetween(tripContainersService, 'export async function createTripContainerInClient', 'export async function createTripContainer(');
    assert.match(slice, /decideTripContainerNumberLink\(ctx, containerNumber, null\)/);
    assert.match(slice, /assertTripContainerLinkDecision\(decision, containerNumber\)/);
    // LINK fields land on the inserted row.
    assert.match(slice, /\.\.\.\(link \?\? \{\}\),/);
  });

  test('SIL655-03: the add-container POST is a trip-side identity write — it bridges to the lot too', () => {
    const slice = sliceBetween(tripContainersService, 'export async function createTripContainerInClient', 'export async function createTripContainer(');
    assert.match(slice, /await syncShipmentIdentityFromTripContainers\(executor, \[inserted\.id\]\);/);
  });

  test('SIL655-05: PATCH writes a number onto an UNLINKED row only after resolve-or-throw', () => {
    const slice = sliceBetween(tripContainersService, 'export async function updateTripContainerInClient', 'export async function updateTripContainer(');
    // Only unlinked rows are resolved — a linked row keeps SIL-653 semantics
    // (the bridge mirrors its number onto ITS lot row).
    assert.match(slice, /row\.sourceShipmentContainerId == null && patch\.containerNumber/);
    assert.match(slice, /decideTripContainerNumberLink\(ctx, containerNumber, containerId\)/);
    assert.match(slice, /assertTripContainerLinkDecision\(decision, containerNumber\)/);
    // Resolution happens before the mirror call, and its result is written
    // with the number in the same UPDATE.
    assert.ok(
      slice.indexOf('decideTripContainerNumberLink') < slice.indexOf('syncShipmentIdentityFromTripContainers'),
      'resolve-or-throw must run before the bridge',
    );
    assert.match(slice, /\.\.\.\(link \?\? \{\}\)/);
  });

  test('SIL655-03: the trip-edit batch PUT resolves inserts and unlinked updates; linked rows stay SIL-653', () => {
    const slice = sliceBetween(tripContainersService, 'export async function batchUpsertTripContainers(');
    assert.match(slice, /const linkCtx = await loadTripContainerLinkContext\(tx, tripId\);/);
    assert.match(slice, /decideTripContainerNumberLink\(linkCtx, number, isInsert \? null : \(c\.id as number\), reservedLotContainerIds\)/);
    assert.match(slice, /sourceShipmentContainerId: decision\.sourceShipmentContainerId/);
    assert.match(slice, /reservedLotContainerIds\.add\(decision\.sourceShipmentContainerId\)/);
  });
});

describe('SIL-655 — trip-create insert paths (source wiring)', () => {
  test('SIL655-01: copyTrip copies the lot link columns (numbers stay reset)', () => {
    const slice = sliceBetween(tripCreateService, 'export async function copyTrip');
    assert.match(slice, /sourceShipmentId: container\.sourceShipmentId,/);
    assert.match(slice, /sourceShipmentContainerId: container\.sourceShipmentContainerId,/);
    assert.match(slice, /sourceShipmentVersion: container\.sourceShipmentVersion,/);
    // The copy law stays: numbers/seals identify physical execution and reset.
    assert.match(slice, /containerNumber: null,/);
    assert.match(slice, /sealNumber: null,/);
  });

  test('SIL655-02: placeholders are gated on the lot having no containers — no mixed placeholder+snapshot rows', () => {
    const slice = sliceBetween(tripCreateService, 'if (data.containerTypeId != null) {', 'Wave 0');
    // The gate consults the lot before inserting the placeholder rows.
    assert.match(slice, /s\.shipmentContainers/);
    assert.match(slice, /if \(!lotHasContainers\) \{/);
  });
});

describe('SIL-655 — LCL synthetic scope: proven container-less, refused explicitly (requirement B)', () => {
  test('the LCL synthetic row keeps containerNumber null + the explicit __fulfillment_lcl: marker', () => {
    const slice = sliceBetween(dispatchService, 'if (fulfillment.shipmentContainerId == null) {', 'const [container] = await tx.select');
    assert.match(slice, /containerNumber: null,/);
    assert.ok(slice.includes('notes: `__fulfillment_lcl:${fulfillment.id}`,'), 'explicit synthetic marker');
    // No link to forge: an LCL fulfillment has no shipment_container to point at.
    assert.doesNotMatch(slice, /sourceShipmentContainerId/);
  });

  test('an LCL lot is lawfully container-less at BOTH enforcement points (decomposition + intake)', () => {
    assert.match(fulfillmentService, /Lô hàng lẻ không được tạo container giả\./);
    assert.match(fulfillmentService, /shipment\.cargoMode === CARGO_MODE\.LCL && containers\.length > 0/);
    assert.match(intakeService, /Hàng lẻ không được có container giả\./);
    assert.match(intakeService, /if \(containers\.length > 0\) throw new ApiError\(409, 'Hàng lẻ không được có container giả\.'\)/);
  });

  test('FCL law parity: an FCL lot must have containers, and only FCL gains container rows', () => {
    assert.match(fulfillmentService, /Lô hàng FCL phải có ít nhất một container\./);
    assert.match(fulfillmentService, /Chỉ lô hàng FCL mới thêm được dòng container\./);
  });
});
