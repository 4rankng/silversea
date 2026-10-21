/** ENV-01 (card #10, doc khách 21/10) — the stgqa QA-fixture catalog, pinned
 *  so the set cannot drift out of the FB-061 QA marker class or the shipment
 *  direction check. Pure unit test: imports the pure catalog module only —
 *  no database, no app boot (owner ruling 2026-10-19).
 *
 *  The four laws pinned here:
 *  1. determinism — buildStgqaFixtureSet() is a pure function, which is what
 *     makes `make stgqa` idempotent and re-seeding after a purge safe;
 *  2. shape — đủ loại FCL/LCL/kẹp with the PRD kẹp definition (two 20');
 *  3. class membership — every scanned identifier matches the LIVE marker
 *     prefix lists (qa-fixture-markers), so prod-mirror views hide the rows
 *     and the purge registry removes them;
 *  4. DB legality — the shipments_document_reference_direction_check
 *     constraint (IMPORT→bookingRef, EXPORT→blNumber, never both) and the
 *     natural keys stay unique within the set.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildStgqaFixtureSet,
  type StgqaShipmentFixture,
} from '../../seed/stgqa-fixtures';
import {
  QA_PARTY_PREFIXES,
  QA_REFERENCE_PREFIXES,
  QA_SITE_PREFIXES,
} from '../../services/qa-fixture-markers';

/** ILIKE-prefix semantics ('QA%' → startsWith, case-insensitive). */
function matchesSomePrefix(value: string | null, prefixes: readonly string[]): boolean {
  if (value === null) return false;
  return prefixes.some((prefix) => {
    assert.ok(prefix.endsWith('%'), `test helper assumes prefix wildcards, got '${prefix}'`);
    return value.toLowerCase().startsWith(prefix.slice(0, -1).toLowerCase());
  });
}

test('STGQA-FIX-1: buildStgqaFixtureSet is deterministic (two builds deep-equal)', () => {
  assert.deepEqual(buildStgqaFixtureSet(), buildStgqaFixtureSet());
});

test('STGQA-FIX-2: shape — 1 BU, 1 KH, 1 nhà xe, 4 lots covering FCL/LCL/kẹp', () => {
  const set = buildStgqaFixtureSet();
  assert.equal(set.shipments.length, 4);
  assert.ok(set.shipments.some((l) => l.cargoMode === 'FCL' && l.tradeDirection === 'IMPORT'));
  assert.ok(set.shipments.some((l) => l.cargoMode === 'FCL' && l.tradeDirection === 'EXPORT'));
  assert.ok(set.shipments.some((l) => l.cargoMode === 'LCL'));
  const kep = set.shipments.filter((l) => l.isCombined);
  assert.equal(kep.length, 1, 'exactly one kẹp lot');
  // PRD LoHangKepKetHop §1.1: kẹp = HAI container 20FT chạy đồng thời.
  assert.equal(kep[0]!.containers.length, 2, 'kẹp lot carries exactly two containers');
  assert.ok(kep[0]!.containers.every((c) => c.containerTypeCode === '20DC'), 'kẹp pair is 20FT');
  // LCL lots carry no container rows (hàng lẻ — shipment-level only).
  assert.ok(
    set.shipments.filter((l) => l.cargoMode === 'LCL').every((l) => l.containers.length === 0),
    'LCL lots have no containers',
  );
});

test('STGQA-FIX-3: every scanned identifier sits in the LIVE QA marker class', () => {
  const set = buildStgqaFixtureSet();
  // Party names (customers/suppliers surface + board party joins).
  assert.ok(matchesSomePrefix(set.customer.name, QA_PARTY_PREFIXES), 'customer name is QA-class');
  // Site names + codes (operational_sites scrub surface, board site aliases).
  assert.ok(matchesSomePrefix(set.warehouse.name, QA_SITE_PREFIXES), 'warehouse name is QA-class');
  assert.ok(matchesSomePrefix(set.warehouse.shortName, QA_SITE_PREFIXES), 'warehouse short name is QA-class');
  assert.ok(matchesSomePrefix(set.warehouse.code, QA_SITE_PREFIXES), 'warehouse code is QA-class');
  // The business_units QA surface predicate is `name ILIKE 'QA%' OR code ILIKE 'QA%'`.
  assert.ok(set.businessUnit.name.startsWith('QA') && set.businessUnit.code.startsWith('QA'), 'BU is QA-class');
  for (const lot of set.shipments as StgqaShipmentFixture[]) {
    // References (shipments soft-delete surface + board read filter).
    assert.ok(
      matchesSomePrefix(lot.shipmentCode, QA_REFERENCE_PREFIXES)
        || matchesSomePrefix(lot.bookingRef, QA_REFERENCE_PREFIXES)
        || matchesSomePrefix(lot.blNumber, QA_REFERENCE_PREFIXES),
      `lot ${lot.shipmentCode} carries a QA-class reference`,
    );
    assert.ok(matchesSomePrefix(lot.bookingRef, QA_REFERENCE_PREFIXES) || lot.bookingRef === null);
    assert.ok(matchesSomePrefix(lot.blNumber, QA_REFERENCE_PREFIXES) || lot.blNumber === null);
    // Factory name (marker-module site prefixes) + notes (the registry's
    // shipments scrub surface pins `operational_notes ILIKE 'QA%'`).
    assert.ok(matchesSomePrefix(lot.factoryName, QA_SITE_PREFIXES), `lot ${lot.shipmentCode} factoryName is QA-class`);
    assert.ok(lot.operationalNotes.startsWith('QA'), `lot ${lot.shipmentCode} operationalNotes is QA-class`);
    // Containers (shipment_containers surface: container_number ILIKE 'QA%').
    assert.ok(lot.containers.every((c) => c.containerNumber.startsWith('QA')), 'container numbers are QA-class');
  }
});

test('STGQA-FIX-4: shipments satisfy the direction check constraint', () => {
  // Repo convention (constraint + prod census 2026-10-21): EXPORT rows carry
  // booking_ref, IMPORT rows carry bl_number, never both.
  for (const lot of buildStgqaFixtureSet().shipments) {
    assert.ok(!(lot.bookingRef !== null && lot.blNumber !== null), `${lot.shipmentCode}: never both refs`);
    if (lot.tradeDirection === 'IMPORT') {
      assert.ok(lot.blNumber !== null && lot.bookingRef === null, `${lot.shipmentCode}: IMPORT → blNumber only`);
    } else {
      assert.ok(lot.bookingRef !== null && lot.blNumber === null, `${lot.shipmentCode}: EXPORT → bookingRef only`);
    }
  }
});

test('STGQA-FIX-5: natural keys are unique within the set (idempotent upsert keys)', () => {
  const set = buildStgqaFixtureSet();
  const codes = set.shipments.map((l) => l.shipmentCode);
  assert.equal(new Set(codes).size, codes.length, 'shipment_code unique');
  const containers = set.shipments.flatMap((l) => l.containers.map((c) => `${l.shipmentCode}:${c.containerNumber}`));
  assert.equal(new Set(containers).size, containers.length, 'container numbers unique per lot');
});

test('STGQA-FIX-6: the fixture catalog writes no user rows — the set has no users', () => {
  const keys = Object.keys(buildStgqaFixtureSet()).sort();
  assert.deepEqual(keys, ['businessUnit', 'customer', 'shipments', 'warehouse'], 'catalog surface is exactly BU + customer + warehouse + shipments — never users');
});
