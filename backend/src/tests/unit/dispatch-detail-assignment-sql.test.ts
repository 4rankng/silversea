/** FB-014 (card 201026112500) + QA 28/11 UX-05 — the assignment definition
 *  of the detail-plan board, pinned at its owner so the three consumers
 *  cannot drift:
 *
 *    1. the quick-tab assignment predicate (Chưa gán xe / Đã gán nhà xe ·
 *       Chờ biển / Đã gán xe),
 *    2. all three chip-count halves (`assignmentStatusCounts`),
 *    3. the trips left-join that hydrates the row's trip.
 *
 *  FB-014's defect: "assigned" meant only "planned plate string non-empty",
 *  so an external-carrier dispatch pending its plate ("CUS sẽ bổ sung",
 *  CREATED trip + lệnh đã phát) was listed under Chưa gán xe while its own
 *  dispatch cell showed the carrier and the phát-lệnh chip. FB-014 folded
 *  every live trip into ASSIGNED; QA 28/11 UX-05 exposed the reverse lie —
 *  a carrier-only allocation (external carrier set, no plate, no trip yet)
 *  still counted "Chưa gán xe" while the row showed the carrier + the
 *  "Chờ bổ sung biển" chip. The law is now the three-state split:
 *  ASSIGNED = plate set; AWAITING_PLATE = plate empty AND carrier set
 *  (external carrier or live trip); UNASSIGNED = plate empty AND no
 *  carrier. A legacy double-L 'CANCELLED' trip additionally rode the
 *  `<> 'CANCELED'` join.
 *
 *  Pure unit test (owner ruling 2026-10-19): asserts the generated SQL text
 *  and a static source scan of the consumer — no database, no app boot.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PgDialect } from 'drizzle-orm/pg-core';

import {
  DISPATCH_DETAIL_CANCELED_TRIP_STATUSES,
  dispatchDetailAssignedSql,
  dispatchDetailAwaitingPlateSql,
  dispatchDetailCarrierSetSql,
  dispatchDetailLiveTripJoinSql,
  dispatchDetailLiveTripSql,
  dispatchDetailPlateEmptySql,
  dispatchDetailPlateSetSql,
  dispatchDetailUnassignedSql,
} from '../../services/dispatch-detail-plan-assignment-sql';

const dialect = new PgDialect();
const text = (fragment: Parameters<typeof dialect.sqlToQuery>[0]) => dialect.sqlToQuery(fragment).sql;

test('UX05-1: assigned = plate set; awaiting = plate empty AND carrier set; unassigned is its exact complement', () => {
  const assigned = text(dispatchDetailAssignedSql());
  const awaiting = text(dispatchDetailAwaitingPlateSql());
  const unassigned = text(dispatchDetailUnassignedSql());
  const plateSet = text(dispatchDetailPlateSetSql());
  const plateEmpty = text(dispatchDetailPlateEmptySql());
  const carrierSet = text(dispatchDetailCarrierSetSql());
  const liveTrip = text(dispatchDetailLiveTripSql());

  // Đã gán xe = carrier + plate — the plate clause alone.
  assert.equal(assigned, plateSet, 'assigned must be exactly the plate-set clause');
  // Đã gán nhà xe · Chờ biển = plate empty AND carrier allocated; the
  // carrier clause carries the FB-014 live-trip reading.
  assert.ok(awaiting.includes(plateEmpty), 'awaiting must carry the plate-empty clause');
  assert.ok(awaiting.includes(carrierSet), 'awaiting must carry the carrier-set clause');
  assert.ok(carrierSet.includes(liveTrip), 'carrier set must carry the live-trip clause (FB-014)');
  // Chưa gán xe = plate empty AND NOT carrier set.
  assert.ok(unassigned.includes(plateEmpty), 'unassigned must carry the plate-empty clause');
  assert.ok(/not\s/.test(unassigned), 'unassigned must negate the carrier-set clause');
});

test('UX05-2: the three halves partition the row set (sum invariant, card 20261008_3)', () => {
  const assigned = text(dispatchDetailAssignedSql());
  const awaiting = text(dispatchDetailAwaitingPlateSql());
  const unassigned = text(dispatchDetailUnassignedSql());
  // plate set XOR plate empty, and the empty half splits on carrier set:
  // awaiting and unassigned negate each other's carrier clause over the
  // same plate-empty ground, so UNASSIGNED + AWAITING + ASSIGNED = total.
  const plateSet = text(dispatchDetailPlateSetSql());
  const plateEmpty = text(dispatchDetailPlateEmptySql());
  assert.equal(assigned, plateSet);
  assert.ok(awaiting.includes(plateEmpty) && unassigned.includes(plateEmpty));
  assert.ok(awaiting.includes(text(dispatchDetailCarrierSetSql())));
  assert.ok(unassigned.includes(`not ${text(dispatchDetailCarrierSetSql())}`));
});

test('FB014-2: the live-trip clause excludes both canceled spellings and deleted trips', () => {
  const rendered = dialect.sqlToQuery(dispatchDetailLiveTripSql());
  for (const status of DISPATCH_DETAIL_CANCELED_TRIP_STATUSES) {
    assert.ok(
      rendered.params.includes(status),
      `live trip must exclude '${status}' (as a bound param) — got ${JSON.stringify(rendered)}`,
    );
  }
  assert.ok(rendered.sql.includes('deleted_at is null'), 'soft-deleted trips are not live');
  assert.ok(rendered.sql.includes('fulfillment_id'), 'the EXISTS must correlate on the row fulfillment');
  assert.ok(rendered.sql.includes('not in'), 'the canceled statuses ride a not-in list');
});

test('FB014-3: the canceled-status list is shared by the join condition', () => {
  const rendered = dialect.sqlToQuery(dispatchDetailLiveTripJoinSql());
  for (const status of DISPATCH_DETAIL_CANCELED_TRIP_STATUSES) {
    assert.ok(rendered.params.includes(status), `the trip join must exclude '${status}'`);
  }
  assert.ok(rendered.sql.includes('"trips"'), 'the join condition reads the trips status column');
  assert.ok(rendered.sql.includes('not in'), 'the join rides the same not-in list');
});

test('FB014-4: the board read consumes the owner at all count/predicate sites (no drift)', () => {
  // Static source scan — the service module imports the db handle, so the pin
  // reads its source instead of importing it (unit-only ruling 2026-10-19).
  const source = readFileSync(
    path.resolve(import.meta.dirname, '../../services/dispatch-planning-detail-plan-read.service.ts'),
    'utf8',
  );
  const predicateSite = source.includes('? DISPATCH_DETAIL_UNASSIGNED_SQL')
    && source.includes('? DISPATCH_DETAIL_AWAITING_PLATE_SQL')
    && source.includes('? DISPATCH_DETAIL_ASSIGNED_SQL');
  assert.ok(predicateSite, 'assignmentPredicate must use the shared assigned/awaiting/unassigned fragments');
  assert.ok(
    /count\(\*\) filter \(where \$\{DISPATCH_DETAIL_UNASSIGNED_SQL\}\)/.test(source)
      && /count\(\*\) filter \(where \$\{DISPATCH_DETAIL_AWAITING_PLATE_SQL\}\)/.test(source)
      && /count\(\*\) filter \(where \$\{DISPATCH_DETAIL_ASSIGNED_SQL\}\)/.test(source),
    'all three chip-count halves must count with the shared fragments',
  );
  assert.ok(
    source.includes('dispatchDetailLiveTripJoinSql()'),
    'the trips left-join must reuse the shared live-trip condition',
  );
  assert.ok(
    !/plannedVehiclePlateNumber\} is null or \$\{s\.shipmentFulfillments\.plannedVehiclePlateNumber\} = ''/.test(source),
    'the old plate-only unassigned predicate must not survive inline',
  );
});
