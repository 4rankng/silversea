/** FB-061 (card 141026012010) — the QA-fixture marker signatures, pinned at the
 *  owner so the board read filter and the purge registry cannot drift apart
 *  again (they did once: `QA_TRIPS_SQL` kept the pre-FB-061 shipment list,
 *  so the trips under a `BL-QAKE-*` lot were never purged).
 *
 *  Pure unit test: it asserts on the generated SQL TEXT, so it needs no
 *  database. The behavioural proof that the board actually hides a marked row
 *  (and keeps a real one) lives in
 *  `src/tests/phoi-phieu-fixture-marker-filter.test.ts`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  qaDriverMarkerSql,
  qaExternalCarrierMarkerSql,
  qaFactoryNameMarkerSql,
  qaPartyMarkerSql,
  qaShipmentMarkerSql,
  qaSiteMarkerSql,
  qaTruckMarkerSql,
  qaTripMarkerSql,
} from '../../services/qa-fixture-markers';
import {
  QA_EXTERNAL_CARRIER_SQL,
  QA_SHIPMENT_FIELDS_SQL,
  QA_SHIPMENTS_SQL,
  QA_TRIPS_SQL,
  QA_TRUCK_SQL,
} from '../../seed/qa-fixture-registry';

test('MARK-1: the shipment signature covers every bill/booking family the card quotes', () => {
  const sqlText = qaShipmentMarkerSql();
  for (const token of ["'QA%'", "'BL-QAKE%'", "'E2E-%'"]) {
    assert.ok(sqlText.includes(token), `shipment marker must cover ${token} — got ${sqlText}`);
  }
  for (const column of ['bl_number', 'booking_ref', 'shipment_code']) {
    assert.ok(sqlText.includes(column), `shipment marker must read ${column}`);
  }
});

test('MARK-2: the trips signature covers the FB-061 bill families (the round-16 drift)', () => {
  // The defect this pins: QA_TRIPS_SQL listed only the pre-FB-061 shipment
  // predicates, so `make qapurge` soft-deleted a BL-QAKE/E2E shipment while
  // leaving its trips — and the board's own children — behind.
  for (const token of ["'BL-QAKE%'", "'E2E-%'"]) {
    assert.ok(QA_TRIPS_SQL.includes(token), `QA_TRIPS_SQL must match ${token} — got ${QA_TRIPS_SQL}`);
  }
  assert.ok(QA_TRIPS_SQL.includes("'KHO-SEAM%'"), 'QA_TRIPS_SQL must match the trip factory snapshot');
});

test('MARK-3: the purge registry consumes the owner instead of restating it', () => {
  assert.equal(QA_SHIPMENT_FIELDS_SQL, qaShipmentMarkerSql(), 'shipments soft-delete predicate is generated, not copied');
  assert.equal(QA_EXTERNAL_CARRIER_SQL, qaExternalCarrierMarkerSql());
  assert.equal(QA_TRUCK_SQL, qaTruckMarkerSql());
  assert.ok(QA_SHIPMENTS_SQL.includes(qaShipmentMarkerSql()), 'children surfaces inherit the same shipment signature');
});

test('MARK-4: vehicle/person signatures cover the probe plates and drivers the card quotes', () => {
  assert.ok(qaExternalCarrierMarkerSql().includes("'99T-99999'"));
  assert.ok(qaExternalCarrierMarkerSql().includes("'51K-PROBE%'"));
  assert.ok(qaExternalCarrierMarkerSql().includes("'Test Driver%'"));
  assert.ok(qaTruckMarkerSql().includes("'51K-PROBE%'"));
  assert.ok(qaDriverMarkerSql().includes("'Test Driver%'"));
  // Every QA lane stamps its fixtures `<purpose>-<epoch ms>-<rand>`; a real
  // plate/driver/site never carries a 10..13 digit stamp.
  for (const [label, text] of [
    ['truck', qaTruckMarkerSql()],
    ['driver', qaDriverMarkerSql()],
    ['external carrier', qaExternalCarrierMarkerSql()],
    ['trip factory', qaTripMarkerSql()],
    ['site', qaSiteMarkerSql()],
    ['shipment factory', qaFactoryNameMarkerSql()],
  ] as const) {
    assert.ok(text.includes('-[0-9]{10,13}$'), `${label} must match the run-scoped epoch signature`);
  }
});

test('MARK-5: the party signature is the fixture family, never a bare "NHA XE"', () => {
  const sqlText = qaPartyMarkerSql();
  assert.ok(sqlText.includes("'STG VERIFY%'"), 'the QA staging carrier family is a fixture');
  // The live roster has real carriers such as `CÔNG TY TNHH VẬN TẢI NHA XE
  // BIEN BAC`. A bare `NHA XE` branch would hide real payable rows, so the
  // phrase alone must never appear as a marker token.
  assert.ok(!/'NHA XE/i.test(sqlText), `a bare "NHA XE" marker would hide real carriers — got ${sqlText}`);
});