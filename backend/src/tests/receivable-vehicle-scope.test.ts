// SIL-1087 (K2.79) — the debt list's vehicle axis and the server-side
// "Bỏ xe công ty" recomputation. Two layers:
//   pure  — obligationVehicleScope: 'EXTERNAL' only when EVERY source trip is
//           external on trip_carrier_info.carrier_type; missing/mixed trips
//           default 'OWN' (Xe nhà), so the tick can never leak company money.
//   db    — the snapshot's excludingOwnFleet FIFO block and the aging list's
//           excludeOwnFleet switch: money moves, the customer universe does
//           not (KB §7.10 — the tick never hides a customer).
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { disconnectRedis } from '../lib/redis';
import {
  getCustomerReceivableSnapshots,
  obligationVehicleScope,
} from '../services/customer-receivable-authority.service';
import { getCustomerAgingList } from '../services/aging.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const cleanup: Array<() => Promise<unknown>> = [];
function track(run: () => Promise<unknown>) {
  cleanup.unshift(run);
}

after(async () => {
  for (const run of cleanup) await run();
  await disconnectRedis();
});

describe('SIL-1087 — obligationVehicleScope (wire fact, never a name/plate inference)', () => {
  test('no trips → OWN; all-external trips → EXTERNAL; any own/missing trip → OWN', () => {
    const carrierTypeByTrip = new Map<number, string>([
      [11, 'OWN'],
      [12, 'EXTERNAL'],
    ]);
    assert.equal(obligationVehicleScope([], carrierTypeByTrip), 'OWN');
    assert.equal(obligationVehicleScope([12], carrierTypeByTrip), 'EXTERNAL');
    assert.equal(obligationVehicleScope([11], carrierTypeByTrip), 'OWN');
    assert.equal(obligationVehicleScope([99], carrierTypeByTrip), 'OWN', 'missing sidecar row defaults OWN');
    assert.equal(obligationVehicleScope([11, 12], carrierTypeByTrip), 'OWN', 'mixed document defaults OWN');
    assert.equal(obligationVehicleScope([12, 13], carrierTypeByTrip), 'OWN', 'one unknown trip poisons the external claim');
  });
});

describe('SIL-1087 — snapshot excludingOwnFleet + aging list excludeOwnFleet', () => {
  test('external-only FIFO block; list tick moves money and keeps every customer', async () => {
    // ── seed one customer with two trip obligations: own + external ──
    const [customer] = await db.insert(s.customers).values({
      name: `S87 scope ${suffix}`,
    }).returning({ id: s.customers.id });
    track(() => db.delete(s.customers).where(eq(s.customers.id, customer.id)));
    const [route] = await db.insert(s.routes).values({ name: `S87 route ${suffix}` }).returning({ id: s.routes.id });
    track(() => db.delete(s.routes).where(eq(s.routes.id, route.id)));

    const mkTrip = async (label: string, carrierType: 'OWN' | 'EXTERNAL') => {
      const [trip] = await db.insert(s.trips).values({
        shipmentId: null, customerId: customer.id, routeId: route.id,
        tripCode: `TRP-S87-${label}-${suffix}`,
        departureDate: '2026-08-27', status: 'COMPLETED',
      }).returning({ id: s.trips.id });
      track(() => db.delete(s.trips).where(eq(s.trips.id, trip.id)));
      await db.insert(s.tripCarrierInfo).values({ tripId: trip.id, carrierType });
      track(() => db.delete(s.tripCarrierInfo).where(eq(s.tripCarrierInfo.tripId, trip.id)));
      return trip.id;
    };
    const ownTripId = await mkTrip('OWN', 'OWN');
    const extTripId = await mkTrip('EXT', 'EXTERNAL');

    const mkAr = async (tripId: number, label: string, debit: string, dueDate: string | null) => {
      const [row] = await db.insert(s.ledger).values({
        txnType: 'TRIP_REVENUE', txnId: tripId, entityType: 'CUSTOMER', entityId: customer.id,
        debit, credit: '0', balance: debit, note: `S87 ${label} ${suffix}`,
        originalDueDate: dueDate,
      }).returning({ id: s.ledger.id });
      track(() => db.delete(s.ledger).where(eq(s.ledger.id, row.id)));
    };
    // Own trip: 3,000,000 owed. External trip: 1,200,000 owed, past due.
    await mkAr(ownTripId, 'own-ar', '3000000', null);
    await mkAr(extTripId, 'ext-ar', '1200000', '2026-09-01');

    const snapshots = await getCustomerReceivableSnapshots([customer.id]);
    const snapshot = snapshots.get(customer.id);
    assert.ok(snapshot, 'snapshot exists');
    const scopes = new Map(snapshot.obligations.map((o) => [o.authorityId, o.vehicleScope]));
    assert.equal(scopes.get(ownTripId), 'OWN');
    assert.equal(scopes.get(extTripId), 'EXTERNAL');
    assert.equal(snapshot.totalOutstanding, 4_200_000);
    assert.equal(snapshot.excludingOwnFleet.totalOutstanding, 1_200_000);
    assert.ok(snapshot.excludingOwnFleet.overdueAmount > 0, 'past-due external obligation reads overdue in the scoped block');

    // ── the aging list: tick off = full figures, tick on = external-only,
    //    same customer set either way ──
    const all = await getCustomerAgingList({ search: `S87 scope ${suffix}` });
    const allRow = all.customers.find((row) => row.customerId === customer.id);
    assert.ok(allRow, 'unticked list surfaces the customer');
    assert.equal(allRow.totalOutstanding, 4_200_000);
    assert.deepEqual(allRow.vehicleScopes, ['OWN', 'EXTERNAL']);

    const scoped = await getCustomerAgingList({ search: `S87 scope ${suffix}`, excludeOwnFleet: true });
    const scopedRow = scoped.customers.find((row) => row.customerId === customer.id);
    assert.ok(scopedRow, 'tick never hides a customer — the row stays listed');
    assert.equal(scopedRow.totalOutstanding, 1_200_000);
    // Owner ruling 29/10: the aging BANDS are age bands from the recording
    // date (the AR row was recorded now → 'current'); the contractual
    // past-due facts ride overdueAmount / maxOverdueDays instead.
    assert.equal(scopedRow.aging.current, 1_200_000);
    assert.ok(scopedRow.overdueAmount > 0, 'past-due external obligation reads overdue in the scoped row');
    assert.equal(scopedRow.overdueAmount, snapshot.excludingOwnFleet.overdueAmount);
    assert.deepEqual(scopedRow.vehicleScopes, ['OWN', 'EXTERNAL']);
    assert.equal(scoped.totals.total, scoped.customers.reduce((sum, row) => sum + row.totalOutstanding, 0), 'KPI totals recompute over the scoped rows');
  });
});
