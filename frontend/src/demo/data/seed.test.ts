/**
 * Demo fixture integrity (SIL-155, TC-SIL155-03): the seed is the shared
 * substrate of every demo lane after the shell, so its shape is pinned here —
 * counts, uniqueness, referential integrity, fee/timeline sanity. A lane that
 * edits the seed without keeping these invariants fails loudly.
 */
import { describe, expect, it } from 'vitest';
import {
  demoCustomers,
  demoDriverCashFees,
  demoDrivers,
  demoPorts,
  demoTrucks,
  demoTrips,
  demoTripsOnDate,
  demoUncFees,
  demoVendors,
} from './seed';

const portIds = new Set(demoPorts.map((p) => p.id));
const customerIds = new Set(demoCustomers.map((c) => c.id));
const truckIds = new Set(demoTrucks.map((t) => t.id));
const driverIds = new Set(demoDrivers.map((d) => d.id));
const vendorIds = new Set(demoVendors.map((v) => v.id));

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

describe('demo seed — catalog invariants', () => {
  it('has the promised catalog sizes (4 cảng / 8 khách hàng / 6 tài xế / 6 đầu kéo / 20 chuyến)', () => {
    expect(demoPorts).toHaveLength(4);
    expect(demoCustomers).toHaveLength(8);
    expect(demoDrivers).toHaveLength(6);
    expect(demoTrucks).toHaveLength(6);
    expect(demoTrips).toHaveLength(20);
  });

  it('has unique ids, plates, container numbers and trip codes', () => {
    const uniq = (values: readonly string[]) => new Set(values).size === values.length;
    expect(uniq(demoTrips.map((t) => t.id))).toBe(true);
    expect(uniq(demoTrips.map((t) => t.code))).toBe(true);
    expect(uniq(demoTrips.map((t) => t.contNo))).toBe(true);
    expect(uniq(demoTrucks.map((t) => t.plate))).toBe(true);
    expect(uniq(demoTrucks.map((t) => t.trailerPlate))).toBe(true);
    expect(uniq(demoDrivers.map((d) => d.idNumber))).toBe(true);
    // Fee ids are unique across ALL trips (flat namespace).
    expect(uniq(demoTrips.flatMap((t) => t.fees.map((f) => f.id)))).toBe(true);
  });

  it('pairs every truck with an existing default driver', () => {
    for (const truck of demoTrucks) {
      expect(driverIds.has(truck.defaultDriverId)).toBe(true);
    }
  });
});

describe('demo seed — trip invariants', () => {
  it('keeps referential integrity on customer / truck / driver / vendor / ports', () => {
    for (const trip of demoTrips) {
      expect(customerIds.has(trip.customerId)).toBe(true);
      expect(portIds.has(trip.liftPortId)).toBe(true);
      if (trip.dropPortId) expect(portIds.has(trip.dropPortId)).toBe(true);

      if (trip.source === 'inhouse') {
        expect(truckIds.has(trip.truckId ?? '')).toBe(true);
        expect(driverIds.has(trip.driverId ?? '')).toBe(true);
        expect(trip.vendorId).toBeUndefined();
      } else {
        expect(vendorIds.has(trip.vendorId ?? '')).toBe(true);
        expect(trip.truckId).toBeUndefined();
        expect(trip.driverId).toBeUndefined();
      }
    }
  });

  it('gives every trip at least one port lift fee with a positive whole-VND amount', () => {
    for (const trip of demoTrips) {
      const lift = trip.fees.filter((f) => f.kind === 'lift');
      expect(lift.length).toBeGreaterThanOrEqual(1);
      for (const fee of trip.fees) {
        expect(portIds.has(fee.portId)).toBe(true);
        expect(Number.isInteger(fee.amountVnd)).toBe(true);
        expect(fee.amountVnd).toBeGreaterThan(0);
        expect(fee.invoiceTo.length).toBeGreaterThan(0);
      }
    }
  });

  it('carries a UNC status exactly for UNC fees and a reimbursement status exactly for cash fees', () => {
    for (const fee of demoTrips.flatMap((t) => t.fees)) {
      if (fee.method === 'unc') {
        expect(['pending', 'paid']).toContain(fee.uncStatus);
        expect(fee.reimbursed).toBeUndefined();
      } else {
        expect(['pending', 'done']).toContain(fee.reimbursed);
        expect(fee.uncStatus).toBeUndefined();
      }
    }
  });

  it('orders timeline blocks inside 00:00–24:00 without overlap', () => {
    for (const trip of demoTrips) {
      expect(trip.timeline.length).toBeGreaterThanOrEqual(2);
      let previousEnd = -1;
      for (const block of trip.timeline) {
        const start = toMinutes(block.start);
        const end = toMinutes(block.end);
        expect(start).toBeGreaterThanOrEqual(0);
        expect(end).toBeLessThanOrEqual(24 * 60);
        expect(end).toBeGreaterThan(start);
        expect(start).toBeGreaterThanOrEqual(previousEnd);
        previousEnd = end;
      }
    }
  });

  it('spreads trips over yesterday / today / tomorrow with today dominant', () => {
    expect(demoTripsOnDate('2026-10-23')).toHaveLength(2);
    expect(demoTripsOnDate('2026-10-25')).toHaveLength(2);
    expect(demoTripsOnDate('2026-10-24').length).toBeGreaterThanOrEqual(10);
  });

  it('seeds the dispatch warning class: export trips missing container specs', () => {
    const missing = demoTrips.filter((t) => t.flow === 'export' && !t.containerSpec);
    expect(missing.length).toBeGreaterThanOrEqual(2);
  });

  it('seeds a chạy kẹp pair: two 20′ trips sharing booking + truck', () => {
    const byBooking = new Map<string, number>();
    for (const trip of demoTrips.filter((t) => t.size === 20 && t.source === 'inhouse')) {
      const key = `${trip.bookingNo}|${trip.truckId}`;
      byBooking.set(key, (byBooking.get(key) ?? 0) + 1);
    }
    expect([...byBooking.values()].some((count) => count === 2)).toBe(true);
  });

  it('seeds both payment queues for the port-payments lane', () => {
    const unc = demoUncFees();
    const cash = demoDriverCashFees();
    expect(unc.length).toBeGreaterThanOrEqual(10);
    expect(cash.length).toBeGreaterThanOrEqual(5);
    expect(unc.some(({ fee }) => fee.uncStatus === 'pending')).toBe(true);
    expect(unc.some(({ fee }) => fee.uncStatus === 'paid')).toBe(true);
    expect(cash.some(({ fee }) => fee.reimbursed === 'pending')).toBe(true);
    expect(cash.some(({ fee }) => fee.reimbursed === 'done')).toBe(true);
  });

  it('mixes both cargo flows, both sizes and in-house + vendor sources', () => {
    const flows = new Set(demoTrips.map((t) => t.flow));
    const sizes = new Set(demoTrips.map((t) => t.size));
    const sources = new Set(demoTrips.map((t) => t.source));
    expect(flows).toEqual(new Set(['export', 'import']));
    expect(sizes).toEqual(new Set([20, 40]));
    expect(sources).toEqual(new Set(['inhouse', 'vendor']));
  });
});
