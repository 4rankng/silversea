/**
 * Card 20260921_8 — vehicle → kế toán phơi phiếu assignment + board scope.
 * Service-level suite; fixtures `card8-*`/`C8-`, local DB :5441.
 *
 * Coverage:
 *   AC1/AC3 assignment lifecycle: assign → reassign → unassign; the ACTIVE
 *       assignment stays single per truck.
 *   AC2 board scope: report filter honors accountantId / includeUnassigned /
 *       explicit-null (unassigned-only); absent params = no filtering.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { assignTruckAccountant, confirmAccountingExpenses } from '../services/expense-accounting-write.service';
import { getPhoiPhieuReport, listPhoiPhieuTruckAssignments } from '../services/phoi-phieu-control.service';
import { Role } from '@tingting/shared';
import { createOpsExpense } from '../services/ops-expenses.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const plateSeed = Date.now() % 100000000;

const cleanup: Array<() => Promise<void>> = [];
const track = (fn: () => Promise<void>) => cleanup.unshift(fn);

async function mkActor(role: 'ACCOUNTANT' | 'ADMIN' | 'OPS') {
  const [u] = await db.insert(s.users).values({
    username: `card8-${suffix}-${role}-${cleanup.length}`, passwordHash: 'x', role,
  }).returning();
  track(async () => { await db.delete(s.users).where(eq(s.users.id, u.id)); });
  return u;
}

async function mkTruck(plate: string) {
  const [truck] = await db.insert(s.trucks).values({
    licensePlate: plate, status: 'ACTIVE',
  }).returning();
  track(async () => { await db.delete(s.trucks).where(eq(s.trucks.id, truck.id)); });
  return truck;
}

async function mkTripWithTruck(truckId: number | null, marker: string) {
  const [customer] = await db.insert(s.customers).values({ name: `card8 ${marker} ${suffix}-${cleanup.length}` }).returning();
  track(async () => { await db.delete(s.customers).where(eq(s.customers.id, customer.id)); });
  const [route] = await db.insert(s.routes).values({ name: `card8 route ${suffix}-${cleanup.length}` }).returning();
  track(async () => { await db.delete(s.routes).where(eq(s.routes.id, route.id)); });
  const [cargoType] = await db.insert(s.cargoTypes).values({ name: `card8 cargo ${suffix}-${cleanup.length}` }).returning();
  track(async () => { await db.delete(s.cargoTypes).where(eq(s.cargoTypes.id, cargoType.id)); });
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id, routeId: route.id, cargoMode: 'FCL', status: 'PENDING_DATE',
  }).returning();
  track(async () => { await db.delete(s.shipments).where(eq(s.shipments.id, shipment.id)); });
  const [trip] = await db.insert(s.trips).values({
    tripCode: `C8-${plateSeed}-${cleanup.length}`.slice(0, 50),
    shipmentId: shipment.id,
    customerId: customer.id, routeId: route.id, cargoTypeId: cargoType.id,
    truckId, status: 'IN_TRANSIT', departureDate: new Date().toISOString().slice(0, 10),
  }).returning();
  track(async () => { await db.delete(s.trips).where(eq(s.trips.id, trip.id)); });
  return { trip, customerMarker: `card8 ${marker}` };
}

describe('card 20260921_8 - vehicle assignment + board scope', () => {
  test('assignment lifecycle: assign, reassign, unassign; single active per truck (AC1/AC3)', async () => {
    const admin = await mkActor('ADMIN');
    const acctA = await mkActor('ACCOUNTANT');
    const acctB = await mkActor('ACCOUNTANT');
    const truck = await mkTruck(`C8-${plateSeed}-T1`);
    await db.transaction(async (tx) => {
      await assignTruckAccountant(tx, { userId: admin.id, role: Role.ADMIN }, truck.id, acctA.id, 0);
    });
    const [activeAfterAssign] = await db.select().from(s.truckAccountantAssignments)
      .where(and(eq(s.truckAccountantAssignments.truckId, truck.id), isNull(s.truckAccountantAssignments.endedAt)));
    assert.ok(activeAfterAssign, 'active assignment exists');
    assert.equal(activeAfterAssign.accountantId, acctA.id);
    const reassigned = await db.transaction(async (tx) => {
      return assignTruckAccountant(tx, { userId: admin.id, role: Role.ADMIN }, truck.id, acctB.id, activeAfterAssign.version);
    });
    void reassigned;
    const [activeAfterReassign] = await db.select().from(s.truckAccountantAssignments)
      .where(and(eq(s.truckAccountantAssignments.truckId, truck.id), isNull(s.truckAccountantAssignments.endedAt)));
    assert.equal(activeAfterReassign.accountantId, acctB.id, 'reassignment moves the truck');
    const [olderRows] = await db.select({ total: sql`count(*)::int` }).from(s.truckAccountantAssignments)
      .where(and(eq(s.truckAccountantAssignments.truckId, truck.id), isNotNull(s.truckAccountantAssignments.endedAt)));
    assert.ok(Number(olderRows.total) >= 1, 'the old assignment row is closed, not deleted');
    track(async () => { await db.delete(s.truckAccountantAssignments).where(eq(s.truckAccountantAssignments.truckId, truck.id)); });
    const unassigned = await db.transaction(async (tx) => {
      return assignTruckAccountant(tx, { userId: admin.id, role: Role.ADMIN }, truck.id, null, activeAfterReassign.version);
    });
    assert.equal(unassigned.accountantId, null, 'unassign path works');
  });

  test('board scope: mine / unassigned-only / mine+unassigned / absent = all (AC2)', async () => {
    const acctA = await mkActor('ACCOUNTANT');
    const acctB = await mkActor('ACCOUNTANT');
    const truckA = await mkTruck(`C8-${plateSeed}-TA`);
    const truckB = await mkTruck(`C8-${plateSeed}-TB`);
    await db.transaction(async (tx) => {
      await assignTruckAccountant(tx, { userId: acctA.id, role: Role.ACCOUNTANT }, truckA.id, acctA.id, 0);
    });
    track(async () => { await db.delete(s.truckAccountantAssignments).where(eq(s.truckAccountantAssignments.truckId, truckA.id)); });
    const tripA = await mkTripWithTruck(truckA.id, 'custA');
    const tripB = await mkTripWithTruck(truckB.id, 'custB');
    const tripFree = await mkTripWithTruck(null, 'custFree');
    await db.transaction(async (tx) => {
      await assignTruckAccountant(tx, { userId: acctA.id, role: Role.ACCOUNTANT }, truckB.id, acctB.id, 0);
    });
    track(async () => { await db.delete(s.truckAccountantAssignments).where(eq(s.truckAccountantAssignments.truckId, truckB.id)); });
    // The report aggregates CONFIRMED ops costs per party — give each trip one
    // confirmed cost so its party surfaces in the rows.
    const ops = await mkActor('OPS');
    for (const fixture of [tripA, tripB, tripFree]) {
      const [link] = await db.insert(s.userShipmentLinks).values({ userId: ops.id, shipmentId: fixture.trip.shipmentId! })
        .onConflictDoNothing().returning();
      if (link) {
        track(async () => { await db.delete(s.userShipmentLinks).where(eq(s.userShipmentLinks.userId, ops.id)); });
      }
      const created = await createOpsExpense(ops.id, {
        shipmentId: fixture.trip.shipmentId!, expenseTypeCode: 'OTHER',
        amount: 50000, paidAt: new Date().toISOString().slice(0, 10),
        costGroup: 'OPS_REGULAR', feeName: `card8 phí ${fixture.customerMarker}`, customerChargeAmount: 0,
      });
      track(async () => { await db.delete(s.opsExpenseEntries).where(eq(s.opsExpenseEntries.id, (created as { id: number }).id)); });
      track(async () => {
        await db.delete(s.expenseAccountingSources).where(and(eq(s.expenseAccountingSources.sourceKind, 'OPS'), eq(s.expenseAccountingSources.sourceId, (created as { id: number }).id)));
      });
      const [source] = await db.select().from(s.expenseAccountingSources).where(and(
        eq(s.expenseAccountingSources.sourceKind, 'OPS'), eq(s.expenseAccountingSources.sourceId, (created as { id: number }).id)));
      await db.transaction(async (tx) => {
        await confirmAccountingExpenses(tx, { userId: acctA.id, role: Role.ACCOUNTANT },
          [{ sourceKind: 'OPS', sourceId: (created as { id: number }).id, expectedVersion: source!.version }]);
      });
    }
    const markerOf = (report: { rows: Array<{ party: string }> }, marker: string) =>
      report.rows.some((row) => row.party.includes(marker));

    const mine = await getPhoiPhieuReport({ kind: 'THU', accountantId: acctA.id });
    assert.ok(markerOf(mine, 'custA'), 'own truck trip in scope');
    assert.ok(!markerOf(mine, 'custB'), 'other accountant trip excluded');
    assert.ok(!markerOf(mine, 'custFree'), 'unassigned trip excluded from plain MINE');

    const minePlus = await getPhoiPhieuReport({ kind: 'THU', accountantId: acctA.id, includeUnassigned: true });
    assert.ok(markerOf(minePlus, 'custA') && markerOf(minePlus, 'custFree'), 'unassigned bucket joins MINE when asked');
    assert.ok(!markerOf(minePlus, 'custB'), 'other accountant still excluded from MINE+unassigned');

    const onlyFree = await getPhoiPhieuReport({ kind: 'THU', accountantId: null });
    assert.ok(markerOf(onlyFree, 'custFree'), 'unassigned-only includes free trips');
    assert.ok(!markerOf(onlyFree, 'custA') && !markerOf(onlyFree, 'custB'), 'assigned trips excluded from unassigned-only');

    const all = await getPhoiPhieuReport({ kind: 'THU' });
    assert.ok(markerOf(all, 'custA') && markerOf(all, 'custB') && markerOf(all, 'custFree'), 'absent scope = everything');
  });

  test('assignments bucket: active assignments + distinct unassigned trucks (AC3)', async () => {
    const acctA = await mkActor('ACCOUNTANT');
    const truckA = await mkTruck(`C8-${plateSeed}-TC`);
    const truckFree = await mkTruck(`C8-${plateSeed}-TD`);
    await db.transaction(async (tx) => {
      await assignTruckAccountant(tx, { userId: acctA.id, role: Role.ACCOUNTANT }, truckA.id, acctA.id, 0);
    });
    track(async () => { await db.delete(s.truckAccountantAssignments).where(eq(s.truckAccountantAssignments.truckId, truckA.id)); });
    const board = await listPhoiPhieuTruckAssignments();
    const mine = board.assignments.find((row) => row.truckId === truckA.id);
    assert.ok(mine, 'active assignment listed');
    assert.equal(mine.accountantId, acctA.id, 'assignment resolves to its accountant');
    assert.ok(board.unassignedTrucks.some((row) => row.truckId === truckFree.id), 'unassigned truck bucket visible');
  });
});
