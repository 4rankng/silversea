/**
 * SIL-161 master-data fixture invariants: the Rate Engine matrices and the
 * derived partner catalogs must stay consistent with the shared shell trip
 * seed — every lift/drop fee quotes its matrix cell, in-house trips charge
 * the standard freight rate when their route appears verbatim, and the
 * factory directory partitions the customer list exactly once.
 */
import { describe, expect, it } from 'vitest';
import {
  DEMO_PORT_RATE_COLUMNS,
  demoFactoryDirectory,
  demoFreightRates,
  demoPortRateMatrix,
  freightRateForTrip,
  portRateCellKey,
} from './master-data';
import { demoCustomers, demoPorts, demoTrips, demoVendors } from './seed';

const portIds = new Set(demoPorts.map((port) => port.id));
const customerIds = new Set(demoCustomers.map((customer) => customer.id));

describe('master-data fixtures — ma trận phí nâng/hạ', () => {
  it('has exactly 8 columns: 20′/40′ × Xuất/Nhập × Nâng/Hạ in a stable order', () => {
    expect(DEMO_PORT_RATE_COLUMNS.map((column) => column.key)).toEqual([
      '20-export-lift',
      '20-export-drop',
      '20-import-lift',
      '20-import-drop',
      '40-export-lift',
      '40-export-drop',
      '40-import-lift',
      '40-import-drop',
    ]);
  });

  it('has one row per fixture port with 8 positive whole-VND cells', () => {
    expect(demoPortRateMatrix.map((row) => row.portId)).toEqual(demoPorts.map((port) => port.id));
    for (const row of demoPortRateMatrix) {
      expect(portIds.has(row.portId)).toBe(true);
      for (const column of DEMO_PORT_RATE_COLUMNS) {
        const value = row.rates[column.key];
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThan(0);
      }
    }
  });

  it('prices every trip lift/drop fee at its port matrix cell', () => {
    for (const trip of demoTrips) {
      for (const fee of trip.fees) {
        if (fee.kind === 'surcharge') continue;
        const row = demoPortRateMatrix.find((entry) => entry.portId === fee.portId);
        expect(row, `missing matrix row for port ${fee.portId}`).toBeDefined();
        const key = portRateCellKey(trip.size, trip.flow, fee.kind);
        expect(row?.rates[key], `${trip.code} fee ${fee.id}`).toBe(fee.amountVnd);
      }
    }
  });
});

describe('master-data fixtures — ma trận giá cước', () => {
  it('references existing customers with unique ids and positive whole-VND rates', () => {
    const ids = demoFreightRates.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const row of demoFreightRates) {
      expect(customerIds.has(row.customerId)).toBe(true);
      expect(row.route.length).toBeGreaterThan(0);
      expect(Number.isInteger(row.rate20Vnd)).toBe(true);
      expect(row.rate20Vnd).toBeGreaterThan(0);
      expect(Number.isInteger(row.rate40Vnd)).toBe(true);
      expect(row.rate40Vnd).toBeGreaterThan(0);
    }
  });

  it('covers every fixture customer with at least one route', () => {
    const covered = new Set(demoFreightRates.map((row) => row.customerId));
    for (const customer of demoCustomers) {
      expect(covered.has(customer.id), `customer ${customer.id} has no freight rate`).toBe(true);
    }
  });

  it('charges in-house trips the standard rate when their route appears verbatim', () => {
    let matched = 0;
    for (const trip of demoTrips) {
      if (trip.source !== 'inhouse') continue;
      const rate = freightRateForTrip(trip);
      if (!rate) continue;
      matched += 1;
      expect(trip.freightVnd).toBe(trip.size === 20 ? rate.rate20Vnd : rate.rate40Vnd);
    }
    // The seed must keep matching a meaningful number of routes — if this
    // drops, route texts or rates drifted apart silently.
    expect(matched).toBeGreaterThanOrEqual(10);
  });
});

describe('master-data fixtures — danh mục đối tác phái sinh', () => {
  it('derives a factory directory that partitions customers exactly once', () => {
    const directory = demoFactoryDirectory();
    const allCodes = directory.flatMap((factory) => factory.customerCodes);
    expect(allCodes).toHaveLength(demoCustomers.length);
    expect(new Set(allCodes).size).toBe(demoCustomers.length);
    for (const factory of directory) {
      expect(factory.area.length).toBeGreaterThan(0);
    }
  });

  it('counts vendor trips only for known vendors', () => {
    const vendorIds = new Set(demoVendors.map((vendor) => vendor.id));
    for (const trip of demoTrips) {
      if (trip.source === 'vendor') {
        expect(vendorIds.has(trip.vendorId ?? '')).toBe(true);
      }
    }
  });
});
