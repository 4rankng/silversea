/**
 * SIL-653 (id 760) — the container number learned AFTER Phát lệnh never
 * reached every surface:
 *
 * - Direction A (Điều vận/CUS → lái xe): the reconcile guard's blanket
 *   issued 409 locked even the container NUMBER (and the CUS "Sửa thông
 *   tin lô" reconcile with it), while the dispatch snapshot had copied a
 *   NULL number into trip_containers once at Phát lệnh — the driver app
 *   stayed on "CHƯA CÓ SỐ CONT" forever. Law now: per-field lock (the
 *   guarded plan set and the price-snapshot measures still 409; number/
 *   seal free) + a write-through mirror from shipment_containers onto the
 *   trip snapshot rows.
 * - Direction B (lái xe → Điều vận/CUS): the driver's "Số cont & seal"
 *   wrote ONLY trip_containers; the lot row stayed null so dispatch and
 *   CUS read "Chưa có số cont" forever. Law now: every trip-side write
 *   path mirrors identity back onto the lot row in the same transaction.
 *
 * Pinned here as source-wiring scans in the unit-only tree (2026-10-19
 * owner ruling: the db-bound bridges cannot boot); the behavioral half
 * runs as a qa/scripts integration probe against the local stack.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeContainerNumber, validateContainerNumber } from '@tingting/shared';

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative: string) => readFileSync(join(here, relative), 'utf8');
const containersService = read('../../services/shipment-containers.service.ts');
const tripContainersService = read('../../services/forwarder-container.service.ts');
const cusWritesService = read('../../services/cus-shipment-workspace-writes.service.ts');

/** Test seam: the source slice between two exported symbols — the same
 *  convention sil644-container-weight-lock.test.ts pins the guard with. */
const sliceBetween = (source: string, start: string, end?: string) => {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `missing anchor: ${start}`);
  if (end == null) return source.slice(from);
  const to = source.indexOf(end, from);
  assert.ok(to > from, `missing end anchor: ${end}`);
  return source.slice(from, to);
};

describe('SIL-653 direction A — issued containers keep structural fields locked, identity free', () => {
  test('the blanket issued throw is gone; the issued set feeds a per-field lock', () => {
    const guard = sliceBetween(containersService, 'export async function reconcileShipmentContainersWithFulfillmentGuard', 'export function parsePlanUpdateSnapshot');
    assert.doesNotMatch(guard, /Không thể thay đổi container sau khi đã phát hành lệnh điều xe\. Hãy hủy hoặc thay thế lệnh/);
    assert.match(guard, /const issuedContainerIds = new Set\(issuedFulfillments/);
  });

  test('the SIL-644 guarded plan set still 409s for issued containers — with its own message', () => {
    const guard = sliceBetween(containersService, 'export async function reconcileShipmentContainersWithFulfillmentGuard', 'export function parsePlanUpdateSnapshot');
    // The guarded-field comparison block is shared by both classes...
    assert.match(guard, /next\.containerTypeId !== undefined/);
    assert.match(guard, /next\.routeId !== undefined/);
    assert.match(guard, /next\.operationalSiteId !== undefined/);
    assert.match(guard, /appointmentChanged/);
    assert.match(guard, /next\.classification !== undefined/);
    // ...and the issued branch names the per-field law verbatim.
    assert.match(guard, /issuedContainerIds\.has\(containerId\)\s*\n\s*\? 'Lệnh điều xe đã được phát — chỉ số container\/seal được cập nhật trực tiếp/);
  });

  test('cargo measures stay locked AFTER issuance (price-snapshot parity with the CUS ledger)', () => {
    const guard = sliceBetween(containersService, 'export async function reconcileShipmentContainersWithFulfillmentGuard', 'export function parsePlanUpdateSnapshot');
    assert.match(guard, /if \(issuedContainerIds\.has\(containerId\)\) \{\s*\n\s*const measuresChanged/);
    assert.match(guard, /trọng tải\/CBM đã chốt theo phương án tính cước/);
  });

  test('removing an issued container stays behind the dispatch flow', () => {
    const guard = sliceBetween(containersService, 'export async function reconcileShipmentContainersWithFulfillmentGuard', 'export function parsePlanUpdateSnapshot');
    assert.match(guard, /Không thể bỏ container đã được điều xe\. Hãy hủy hoặc thay thế phân xe theo quy trình điều vận\./);
  });
});

describe('SIL-653 direction A — lot-side number writes mirror onto the trip snapshot', () => {
  test('the reconcile backfills trip_containers only on an ACTUAL number change', () => {
    const reconcile = sliceBetween(containersService, 'export async function reconcileShipmentContainersInTx', 'export async function reconcileShipmentContainersWithFulfillmentGuard');
    assert.match(reconcile, /if \(nextNumber === \(current\.containerNumber \?\? null\)\) continue;/);
    assert.match(reconcile, /syncTripSnapshotIdentityFromShipmentContainer\(tx, container\.id as number, \{\s*\n\s*containerNumber: nextNumber,/);
  });

  test('the CUS workspace line command rides the same forward bridge', () => {
    assert.match(cusWritesService, /import \{ syncTripSnapshotIdentityFromShipmentContainer \} from '\.\/shipment-containers\.service';/);
    assert.match(cusWritesService, /await syncTripSnapshotIdentityFromShipmentContainer\(tx, container\.id, \{\s*\n\s*containerNumber: nextContainerNumber,/);
  });

  test('the seal is NOT mirrored lot→trip — trip_container_seals evidence stays driver-owned', () => {
    const bridge = sliceBetween(containersService, 'export async function syncTripSnapshotIdentityFromShipmentContainer', 'export async function syncShipmentIdentityFromTripContainers');
    assert.match(bridge, /export async function syncTripSnapshotIdentityFromShipmentContainer\(/);
    assert.doesNotMatch(bridge, /sealNumber/);
  });
});

describe('SIL-653 direction B — driver trip writes mirror onto the lot row', () => {
  test('all four trip-side write paths call the reverse bridge', () => {
    assert.match(tripContainersService, /import \{ syncShipmentIdentityFromTripContainers \} from '\.\/shipment-containers\.service';/);
    // Driver/forwarder add-container POST (SIL-655 id 762 — the create path
    // used to skip the bridge entirely): after the primary seal is derived.
    assert.match(sliceBetween(tripContainersService, 'export async function createTripContainerInClient', 'export async function createTripContainer('), /await syncShipmentIdentityFromTripContainers\(executor, \[inserted\.id\]\);/);
    // Driver "Số cont & seal" PATCH — identity fields or added seals.
    assert.match(
      sliceBetween(tripContainersService, 'export async function updateTripContainerInClient', 'export async function updateTripContainer('),
      /if \(patch\.containerNumber !== undefined \|\| patch\.sealNumber !== undefined \|\| hasSealsToAdd\) \{\s*\n\s*await syncShipmentIdentityFromTripContainers\(executor, \[containerId\]\);/,
    );
    // Seal replace PUT — after the primary seal is re-derived.
    assert.match(sliceBetween(tripContainersService, 'export async function batchUpsertContainerSeals', 'export async function batchUpsertTripContainers('), /await syncShipmentIdentityFromTripContainers\(tx, \[containerId\]\);/);
    // Trip-edit batch PUT — every upserted container, before the version bump.
    assert.match(sliceBetween(tripContainersService, 'export async function batchUpsertTripContainers('), /await syncShipmentIdentityFromTripContainers\(tx, upsertedContainerIds\);/);
  });

  test('the reverse bridge validates ISO 6346 and the in-lot duplicate law before touching the lot', () => {
    const bridge = sliceBetween(containersService, 'export async function syncShipmentIdentityFromTripContainers');
    assert.match(bridge, /const \[ok, message\] = validateContainerNumber\(nextNumber\);/);
    assert.match(bridge, /đã tồn tại trong lô hàng\./);
    // Only snapshot-sourced rows bridge; driver-added containers have no lot row.
    assert.match(bridge, /row\.sourceShipmentContainerId != null/);
    // No shipment.version bump — a driver typing a number must not 409 open
    // office editors; the boards reconcile by refetch.
    assert.doesNotMatch(bridge, /version/);
  });
});

describe('SIL-653 — the bridge reuses the shared ISO 6346 law', () => {
  test('normalize + validate behave the way the bridge compares and gates', () => {
    assert.equal(normalizeContainerNumber('tcku 123456 0'), 'TCKU1234560');
    const [ok, message] = validateContainerNumber('TCKU1234560');
    assert.equal(ok, true, message);
  });
});
