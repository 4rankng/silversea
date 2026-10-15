/**
 * FB-090 — vehicle-class lane pricing lookups (LCL foundation).
 *
 * Exercises resolveCustomerVehicleClassPrice (Cước thu khách) and
 * resolveCarrierVehicleClassPrice (Cước trả nhà xe) against the real
 * Postgres DB: ID- and CODE-linked customer rows, effective-date recency,
 * and the supplier-specific → generic carrier cascade.
 *
 * Regression cases FB090-02 / FB090-03 in
 * testplan/2026-10-15-fb090-lcl-vehicle-catalog-pricing.md.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { inArray } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import {
  resolveCustomerVehicleClassPrice,
  resolveCarrierVehicleClassPrice,
} from '../services/pricing.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdSupplierIds: number[] = [];
const createdClassIds: number[] = [];
const createdPricingTableIds: number[] = [];
const createdCarrierPricingIds: number[] = [];

async function mkCustomer() {
  const [c] = await db.insert(s.customers)
    .values({ name: `VehClass customer ${suffix}-${createdCustomerIds.length}` })
    .returning();
  createdCustomerIds.push(c.id);
  return c;
}

async function mkRoute() {
  const [r] = await db.insert(s.routes)
    .values({ name: `VehClass route ${suffix}-${createdRouteIds.length}` })
    .returning();
  createdRouteIds.push(r.id);
  return r;
}

async function mkSupplier() {
  const [sup] = await db.insert(s.suppliers)
    .values({ name: `VehClass nhà xe ${suffix}-${createdSupplierIds.length}` })
    .returning();
  createdSupplierIds.push(sup.id);
  return sup;
}

async function mkVehicleClass(isContainer: boolean, codeSuffix: string) {
  // Codes are unique per run — schema allows [A-Z0-9.] up to 20 chars.
  const stamp = suffix.replace(/[^a-z0-9]/gi, '').slice(-10).toUpperCase();
  const [cls] = await db.insert(s.vehicleSizeClasses)
    .values({
      code: `${isContainer ? 'CT' : 'T'}${stamp}${codeSuffix}`.slice(0, 20),
      name: `VehClass ${isContainer ? 'cont' : 'truck'} ${codeSuffix}`,
      isContainer,
      sortOrder: 900,
    })
    .returning();
  createdClassIds.push(cls.id);
  return cls;
}

after(async () => {
  try {
    if (createdCarrierPricingIds.length > 0) {
      await db.delete(s.carrierRoutePricing).where(inArray(s.carrierRoutePricing.id, createdCarrierPricingIds));
    }
    if (createdPricingTableIds.length > 0) {
      await db.delete(s.pricingTables).where(inArray(s.pricingTables.id, createdPricingTableIds));
    }
    if (createdClassIds.length > 0) {
      await db.delete(s.vehicleSizeClasses).where(inArray(s.vehicleSizeClasses.id, createdClassIds));
    }
    if (createdSupplierIds.length > 0) {
      await db.delete(s.suppliers).where(inArray(s.suppliers.id, createdSupplierIds));
    }
    if (createdRouteIds.length > 0) {
      await db.delete(s.routes).where(inArray(s.routes.id, createdRouteIds));
    }
    if (createdCustomerIds.length > 0) {
      await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
    }
  } finally {
    await client.end();
  }
});

describe('FB090-02 resolveCustomerVehicleClassPrice (cước thu khách)', () => {
  test('resolves an ID-linked vehicle-class row', async () => {
    const customer = await mkCustomer();
    const route = await mkRoute();
    const cls = await mkVehicleClass(false, '5T');
    const [row] = await db.insert(s.pricingTables).values({
      customerId: customer.id,
      routeId: route.id,
      price: '3_500_000'.replace(/_/g, ''),
      effectiveDate: '2026-01-01',
      rateKey: cls.code,
      vehicleSizeClassId: cls.id,
    }).returning();
    createdPricingTableIds.push(row.id);

    const resolved = await resolveCustomerVehicleClassPrice({
      customerId: customer.id,
      routeId: route.id,
      vehicleSizeClassId: cls.id,
      date: '2026-10-01',
    });
    assert.equal(resolved?.price, 3500000);
    assert.equal(resolved?.pricingTableId, row.id);
    assert.equal(resolved?.matchedVia, 'ID');
  });

  test('resolves a legacy CODE-only row (rate_key = class code, no id link)', async () => {
    const customer = await mkCustomer();
    const route = await mkRoute();
    const cls = await mkVehicleClass(false, '8T');
    const [row] = await db.insert(s.pricingTables).values({
      customerId: customer.id,
      routeId: route.id,
      price: '4200000',
      effectiveDate: '2026-02-01',
      rateKey: cls.code,
    }).returning();
    createdPricingTableIds.push(row.id);

    const resolved = await resolveCustomerVehicleClassPrice({
      customerId: customer.id,
      routeId: route.id,
      vehicleSizeClassId: cls.id,
      date: '2026-10-01',
    });
    assert.equal(resolved?.price, 4200000);
    assert.equal(resolved?.matchedVia, 'CODE');
  });

  test('latest effectiveDate ≤ date wins; future rows are ignored', async () => {
    const customer = await mkCustomer();
    const route = await mkRoute();
    const cls = await mkVehicleClass(false, '10T');
    const rows = await db.insert(s.pricingTables).values([
      { customerId: customer.id, routeId: route.id, price: '1000000', effectiveDate: '2026-01-01', rateKey: cls.code, vehicleSizeClassId: cls.id },
      { customerId: customer.id, routeId: route.id, price: '2000000', effectiveDate: '2026-03-01', rateKey: cls.code, vehicleSizeClassId: cls.id },
      // Future-dated repricing must not leak into an October lookup.
      { customerId: customer.id, routeId: route.id, price: '9000000', effectiveDate: '2026-12-01', rateKey: cls.code, vehicleSizeClassId: cls.id },
    ]).returning();
    createdPricingTableIds.push(...rows.map((r) => r.id));

    const resolved = await resolveCustomerVehicleClassPrice({
      customerId: customer.id,
      routeId: route.id,
      vehicleSizeClassId: cls.id,
      date: '2026-10-01',
    });
    assert.equal(resolved?.price, 2000000);
    assert.equal(resolved?.effectiveDate, '2026-03-01');
  });

  test('unpriced lane returns null (MANUAL semantics), never throws', async () => {
    const customer = await mkCustomer();
    const route = await mkRoute();
    const cls = await mkVehicleClass(true, 'C');
    const resolved = await resolveCustomerVehicleClassPrice({
      customerId: customer.id,
      routeId: route.id,
      vehicleSizeClassId: cls.id,
      date: '2026-10-01',
    });
    assert.equal(resolved, null);
  });

  test('lookup by code (no id) resolves the same lane', async () => {
    const customer = await mkCustomer();
    const route = await mkRoute();
    const cls = await mkVehicleClass(false, '15T');
    const [row] = await db.insert(s.pricingTables).values({
      customerId: customer.id,
      routeId: route.id,
      price: '7700000',
      effectiveDate: '2026-01-01',
      rateKey: cls.code,
      vehicleSizeClassId: cls.id,
    }).returning();
    createdPricingTableIds.push(row.id);

    const resolved = await resolveCustomerVehicleClassPrice({
      customerId: customer.id,
      routeId: route.id,
      vehicleSizeClassCode: cls.code,
      date: '2026-10-01',
    });
    assert.equal(resolved?.price, 7700000);
    assert.equal(resolved?.matchedVia, 'ID');
  });
});

describe('FB090-03 resolveCarrierVehicleClassPrice (cước trả nhà xe)', () => {
  test("supplier's own row wins over the generic row", async () => {
    const route = await mkRoute();
    const cls = await mkVehicleClass(false, 'S1');
    const supplier = await mkSupplier();
    const rows = await db.insert(s.carrierRoutePricing).values([
      { routeId: route.id, vehicleSizeClassId: cls.id, supplierId: null, price: '2500000', effectiveDate: '2026-01-01' },
      { routeId: route.id, vehicleSizeClassId: cls.id, supplierId: supplier.id, price: '3100000', effectiveDate: '2026-01-01' },
    ]).returning();
    createdCarrierPricingIds.push(...rows.map((r) => r.id));

    const resolved = await resolveCarrierVehicleClassPrice({
      routeId: route.id,
      vehicleSizeClassId: cls.id,
      supplierId: supplier.id,
      date: '2026-10-01',
    });
    assert.equal(resolved?.price, 3100000);
    assert.equal(resolved?.matched, 'SUPPLIER');
  });

  test('supplier without an own row falls back to the generic price', async () => {
    const route = await mkRoute();
    const cls = await mkVehicleClass(false, 'S2');
    const pricedSupplier = await mkSupplier();
    const otherSupplier = await mkSupplier();
    const rows = await db.insert(s.carrierRoutePricing).values([
      { routeId: route.id, vehicleSizeClassId: cls.id, supplierId: null, price: '2400000', effectiveDate: '2026-01-01' },
      { routeId: route.id, vehicleSizeClassId: cls.id, supplierId: pricedSupplier.id, price: '999999', effectiveDate: '2026-01-01' },
    ]).returning();
    createdCarrierPricingIds.push(...rows.map((r) => r.id));

    const resolved = await resolveCarrierVehicleClassPrice({
      routeId: route.id,
      vehicleSizeClassId: cls.id,
      supplierId: otherSupplier.id,
      date: '2026-10-01',
    });
    assert.equal(resolved?.price, 2400000);
    assert.equal(resolved?.matched, 'GENERIC');
  });

  test('without supplierId only the generic lane answers; none → null', async () => {
    const route = await mkRoute();
    const cls = await mkVehicleClass(false, 'S3');
    const supplier = await mkSupplier();
    const [own] = await db.insert(s.carrierRoutePricing).values({
      routeId: route.id, vehicleSizeClassId: cls.id, supplierId: supplier.id, price: '3333333', effectiveDate: '2026-01-01',
    }).returning();
    createdCarrierPricingIds.push(own.id);

    // A supplier-specific row must never answer a generic lookup.
    const genericOnly = await resolveCarrierVehicleClassPrice({
      routeId: route.id,
      vehicleSizeClassId: cls.id,
      date: '2026-10-01',
    });
    assert.equal(genericOnly, null);

    const [generic] = await db.insert(s.carrierRoutePricing).values({
      routeId: route.id, vehicleSizeClassId: cls.id, supplierId: null, price: '2200000', effectiveDate: '2026-01-01',
    }).returning();
    createdCarrierPricingIds.push(generic.id);
    const resolved = await resolveCarrierVehicleClassPrice({
      routeId: route.id,
      vehicleSizeClassId: cls.id,
      date: '2026-10-01',
    });
    assert.equal(resolved?.price, 2200000);
    assert.equal(resolved?.matched, 'GENERIC');
  });

  test('latest effectiveDate ≤ date wins for the carrier lane', async () => {
    const route = await mkRoute();
    const cls = await mkVehicleClass(false, 'S4');
    const rows = await db.insert(s.carrierRoutePricing).values([
      { routeId: route.id, vehicleSizeClassId: cls.id, supplierId: null, price: '1000000', effectiveDate: '2026-01-01' },
      { routeId: route.id, vehicleSizeClassId: cls.id, supplierId: null, price: '1800000', effectiveDate: '2026-06-01' },
      { routeId: route.id, vehicleSizeClassId: cls.id, supplierId: null, price: '9999999', effectiveDate: '2026-12-01' },
    ]).returning();
    createdCarrierPricingIds.push(...rows.map((r) => r.id));

    const resolved = await resolveCarrierVehicleClassPrice({
      routeId: route.id,
      vehicleSizeClassId: cls.id,
      date: '2026-10-01',
    });
    assert.equal(resolved?.price, 1800000);
    assert.equal(resolved?.effectiveDate, '2026-06-01');
  });
});
