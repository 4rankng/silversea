import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import express from 'express';
import { and, eq, gte, inArray, isNull, like } from 'drizzle-orm';
import { Role, TrailerType } from '@tingting/shared';
import { client, db } from '../db';
import * as s from '../db/schema';
import { disconnectRedis } from '../lib/redis';
import configRoutes from '../routes/config';
import paymentsRoutes from '../routes/financial/payments.routes';
import { globalErrorHandler } from '../middleware/errorHandler';
import { withTestCleanup } from './helpers/db-isolation';

type RowWithUpdatedAt = { id: number; updatedAt: Date; deletedAt?: Date | null };

type ResourceCase<TRow extends RowWithUpdatedAt> = {
  name: string;
  endpoint: string;
  /** Governed resource name registered for this catalog (DB table name). */
  resource: string;
  adminOnly?: boolean;
  createPayload: () => Record<string, unknown>;
  mutatePayload: (row: TRow) => Record<string, unknown>;
  fetchById: (id: number) => Promise<TRow | undefined>;
  expectCreated: (row: TRow) => Promise<void> | void;
  expectUpdated: (row: TRow) => Promise<void> | void;
  expectDeleted: (id: number) => Promise<void>;
};

const cleanup = withTestCleanup();
const actorIds: number[] = [];
const customerIds: number[] = [];
const businessCalendarIds: number[] = [];
const expenseCategoryIds: number[] = [];
const supplierIds: number[] = [];
const routeIds: number[] = [];
const cargoTypeIds: number[] = [];
const portIds: number[] = [];
const containerTypeIds: number[] = [];
const truckIds: number[] = [];
const driverIds: number[] = [];
const penaltyReasonIds: number[] = [];
const forwarderExpenseTypeIds: number[] = [];
const pricingTableIds: number[] = [];
const roadAllowanceIds: number[] = [];
const fuelNormIds: number[] = [];
const weightPricingTierIds: number[] = [];
const liftPricingIds: number[] = [];
const ancillaryRevenueIds: number[] = [];
const managementFeeIds: number[] = [];
const capTableIds: number[] = [];
const truckCapIds: number[] = [];
let actors: Array<{ id: number; role: string }> = [];
let customerId = 0;
let routeId = 0;
let cargoTypeId = 0;
let portId = 0;
let containerTypeId = 0;
let truckId = 0;
let server: http.Server;
let baseUrl = '';
let runStartedAt = new Date();
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const uniqueContainerCode = `Q15-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
const uniqueTruckPlate = `Q15-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
let requestCounter = 0;

async function api(
  method: string,
  path: string,
  options: {
    body?: Record<string, unknown>;
    actorIndex?: number;
    idempotencyKey?: string;
    expectedUpdatedAt?: Date | string;
  } = {},
) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Test-Actor': String(options.actorIndex ?? 0),
  };
  if (method !== 'GET') {
    headers['Idempotency-Key'] = options.idempotencyKey
      ?? `q15-config-${suffix}-${requestCounter++}`;
  }
  if (options.expectedUpdatedAt) {
    headers['If-Unmodified-Since'] = options.expectedUpdatedAt instanceof Date
      ? options.expectedUpdatedAt.toISOString()
      : options.expectedUpdatedAt;
  }
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

/**
 * Asserts the governed write applied directly: the response is the mutated
 * table row, not a queued governance action.
 */
function expectAppliedRow(response: Awaited<ReturnType<typeof api>>, label: string) {
  assert.ok(
    !('actionKind' in response.body),
    `${label}: expected direct row, got governance action ${JSON.stringify(response.body)}`,
  );
}

before(async () => {
  runStartedAt = new Date();
  actors = await db.insert(s.users).values([
    { username: `q15-price-maker-${suffix}`, passwordHash: 'x', role: Role.MANAGER, status: 'ACTIVE' },
    { username: `q15-price-checker-${suffix}`, passwordHash: 'x', role: Role.ACCOUNTANT, status: 'ACTIVE' },
    { username: `q15-price-approver-${suffix}`, passwordHash: 'x', role: Role.ADMIN, status: 'ACTIVE' },
    { username: `q15-price-viewer-${suffix}`, passwordHash: 'x', role: Role.DRIVER, status: 'ACTIVE' },
  ]).returning({ id: s.users.id, role: s.users.role });
  actorIds.push(...actors.map((actor) => actor.id));

  const [customer] = await db.insert(s.customers).values({
    name: `Q15 Pricing Customer ${suffix}`,
    contactPerson: 'Initial Contact',
  }).returning();
  customerIds.push(customer.id);
  customerId = customer.id;
  const [secondaryCustomer] = await db.insert(s.customers).values({
    name: `Q15 Pricing Customer 2 ${suffix}`,
    contactPerson: 'Secondary Contact',
  }).returning();
  customerIds.push(secondaryCustomer.id);

  const [route] = await db.insert(s.routes).values({
    name: `Q15 Pricing Route ${suffix}`,
  }).returning();
  routeIds.push(route.id);
  routeId = route.id;

  const [cargoType] = await db.insert(s.cargoTypes).values({
    name: `Q15 Cargo ${suffix}`,
  }).returning();
  cargoTypeIds.push(cargoType.id);
  cargoTypeId = cargoType.id;

  const [port] = await db.insert(s.ports).values({
    name: `Q15 Port ${suffix}`,
  }).returning();
  portIds.push(port.id);
  portId = port.id;

  const [containerType] = await db.insert(s.containerTypes).values({
    code: uniqueContainerCode,
    name: `Q15 Container ${suffix}`,
  }).returning();
  containerTypeIds.push(containerType.id);
  containerTypeId = containerType.id;

  const [truck] = await db.insert(s.trucks).values({
    licensePlate: uniqueTruckPlate,
  }).returning();
  truckIds.push(truck.id);
  truckId = truck.id;

  const app = express();
  app.use(express.json());
  app.use('/api', (req, _res, next) => {
    const actorIndex = Number(req.header('X-Test-Actor') ?? 0);
    const actor = actors[actorIndex] ?? actors[0]!;
    req.user = {
      userId: actor.id,
      username: `q15-${actor.id}`,
      email: null,
      fullName: null,
      role: actor.role as Role,
    };
    next();
  });
  app.use('/api', configRoutes);
  app.use('/api', paymentsRoutes);
  app.use(globalErrorHandler);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  try {
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  } finally {
    try {
      // Idempotency keys created by our actors must be removed before the
      // users themselves. Cache-invalidation jobs authored through transient
      // governance actions carry the negative synthetic action id in their
      // dedupe key, so sweep only those created during this run.
      if (actorIds.length > 0) {
        await db.delete(s.idempotencyKeys).where(inArray(s.idempotencyKeys.createdBy, actorIds));
        await db.delete(s.durableEffectJobs).where(and(
          like(s.durableEffectJobs.dedupeKey, '%:governance-action:-%'),
          gte(s.durableEffectJobs.createdAt, runStartedAt),
        ));
      }
      // Catalog teardown: same child-first order as before, but each delete is
      // error-isolated and empty-safe, so one failure cannot orphan the rest.
      if (supplierIds.length > 0) {
        await db.update(s.customers)
          .set({ linkedSupplierId: null, updatedAt: new Date() })
          .where(inArray(s.customers.linkedSupplierId, supplierIds));
      }
      await cleanup.deleteAll(s.ancillaryRevenue, ancillaryRevenueIds);
      await cleanup.deleteAll(s.forwarderExpenseTypes, forwarderExpenseTypeIds);
      await cleanup.deleteAll(s.penaltyReasons, penaltyReasonIds);
      await cleanup.deleteAll(s.pricingTables, pricingTableIds);
      await cleanup.deleteAll(s.roadAllowances, roadAllowanceIds);
      await cleanup.deleteAll(s.fuelNorms, fuelNormIds);
      await cleanup.deleteAll(s.weightPricingTiers, weightPricingTierIds);
      await cleanup.deleteAll(s.liftPricing, liftPricingIds);
      await cleanup.deleteAll(s.managementFees, managementFeeIds);
      await cleanup.deleteAll(s.capTableHistory, capTableIds);
      await cleanup.deleteAll(s.truckCapTable, truckCapIds);
      await cleanup.deleteAll(s.expenseCategories, expenseCategoryIds);
      await cleanup.deleteAll(s.drivers, driverIds);
      await cleanup.deleteAll(s.trucks, truckIds);
      await cleanup.deleteAll(s.suppliers, supplierIds);
      await cleanup.deleteAll(s.routes, routeIds);
      await cleanup.deleteAll(s.businessCalendarDays, businessCalendarIds);
      await cleanup.deleteAll(s.cargoTypes, cargoTypeIds);
      await cleanup.deleteAll(s.ports, portIds);
      await cleanup.deleteAll(s.containerTypes, containerTypeIds);
      await cleanup.deleteAll(s.customers, customerIds);
      await cleanup.deleteAll(s.users, actorIds);
    } finally {
      await disconnectRedis();
      await client.end();
    }
  }
});

/**
 * 2026-09-05 + 2026-09-11 (maker-checker removal): governed price-config
 * writes apply directly — the HTTP boundary returns the mutated row, nothing
 * is queued or persisted outside the domain tables.
 */
describe('Q15 governed material config resources', { concurrency: false }, () => {
  // Each case in the table has its own row shape; the loop only relies on the
  // shared lifecycle (create / mutate / fetch / expect*) so we widen the row
  // type to a structural intersection of the base row + an open record. The
  // expectation callbacks still get a fully-typed row per-case.
  const materialCases: Array<ResourceCase<RowWithUpdatedAt & Record<string, unknown>>> = [
    {
      name: 'pricing tables',
      endpoint: '/api/pricing-tables',
      resource: 'pricing_tables',
      createPayload: () => ({ customerId, routeId, price: 1500000 }),
      mutatePayload: () => ({ price: 1750000 }),
      fetchById: async (id) => {
        const [row] = await db.select().from(s.pricingTables).where(eq(s.pricingTables.id, id)).limit(1);
        return row;
      },
      expectCreated: (row) => {
        pricingTableIds.push(row.id);
        assert.equal(Number(row.price), 1500000);
      },
      expectUpdated: (row) => {
        assert.equal(Number(row.price), 1750000);
      },
      expectDeleted: async (id) => {
        const [row] = await db.select().from(s.pricingTables).where(eq(s.pricingTables.id, id)).limit(1);
        assert.ok(row?.deletedAt instanceof Date);
      },
    },
    {
      name: 'road allowances',
      endpoint: '/api/road-allowances',
      resource: 'road_allowances',
      createPayload: () => ({ routeId, trailerType: TrailerType.FT20, baseAmount: 220000 }),
      mutatePayload: () => ({ baseAmount: 260000 }),
      fetchById: async (id) => {
        const [row] = await db.select().from(s.roadAllowances).where(eq(s.roadAllowances.id, id)).limit(1);
        return row;
      },
      expectCreated: (row) => {
        roadAllowanceIds.push(row.id);
        assert.equal(Number(row.baseAmount), 220000);
      },
      expectUpdated: (row) => {
        assert.equal(Number(row.baseAmount), 260000);
      },
      expectDeleted: async (id) => {
        const [row] = await db.select().from(s.roadAllowances).where(eq(s.roadAllowances.id, id)).limit(1);
        assert.ok(row?.deletedAt instanceof Date);
      },
    },
    {
      name: 'fuel norms',
      endpoint: '/api/fuel-norms',
      resource: 'fuel_norms',
      createPayload: () => ({
        routeId,
        truckId: null,
        loadedLitersPer100Km: 30,
        emptyLitersPer100Km: 25,
        supplementLiters: 0,
        flatRateLiters: null,
        effectiveDate: '2099-01-01',
        note: `Q15 fuel ${suffix}`,
      }),
      mutatePayload: () => ({ loadedLitersPer100Km: 31 }),
      fetchById: async (id) => {
        const [row] = await db.select().from(s.fuelNorms).where(eq(s.fuelNorms.id, id)).limit(1);
        return row;
      },
      expectCreated: (row) => {
        fuelNormIds.push(row.id);
        assert.equal(Number(row.loadedLitersPer100Km), 30);
      },
      expectUpdated: (row) => {
        assert.equal(Number(row.loadedLitersPer100Km), 31);
      },
      expectDeleted: async (id) => {
        const [row] = await db.select().from(s.fuelNorms).where(eq(s.fuelNorms.id, id)).limit(1);
        assert.ok(row?.deletedAt instanceof Date);
      },
    },
    {
      name: 'weight pricing tiers',
      endpoint: '/api/weight-pricing-tiers',
      resource: 'weight_pricing_tiers',
      createPayload: () => ({
        routeId,
        cargoTypeId,
        minKg: 0,
        maxKg: 1000,
        pricePerKg: 2200,
        effectiveDate: '2099-02-01',
        note: `Q15 tier ${suffix}`,
      }),
      mutatePayload: () => ({ pricePerKg: 2400 }),
      fetchById: async (id) => {
        const [row] = await db.select().from(s.weightPricingTiers).where(eq(s.weightPricingTiers.id, id)).limit(1);
        return row;
      },
      expectCreated: (row) => {
        weightPricingTierIds.push(row.id);
        assert.equal(Number(row.pricePerKg), 2200);
      },
      expectUpdated: (row) => {
        assert.equal(Number(row.pricePerKg), 2400);
      },
      expectDeleted: async (id) => {
        const [row] = await db.select().from(s.weightPricingTiers).where(eq(s.weightPricingTiers.id, id)).limit(1);
        assert.ok(row?.deletedAt instanceof Date);
      },
    },
    {
      name: 'lift pricing',
      endpoint: '/api/lift-pricing',
      resource: 'lift_pricing',
      createPayload: () => ({
        portId,
        containerTypeId,
        direction: 'LIFT_UP',
        unitPrice: 550000,
        effectiveDate: '2099-03-01',
        note: `Q15 lift ${suffix}`,
      }),
      mutatePayload: () => ({ unitPrice: 580000 }),
      fetchById: async (id) => {
        const [row] = await db.select().from(s.liftPricing).where(eq(s.liftPricing.id, id)).limit(1);
        return row;
      },
      expectCreated: (row) => {
        liftPricingIds.push(row.id);
        assert.equal(Number(row.unitPrice), 550000);
      },
      expectUpdated: (row) => {
        assert.equal(Number(row.unitPrice), 580000);
      },
      expectDeleted: async (id) => {
        const [row] = await db.select().from(s.liftPricing).where(eq(s.liftPricing.id, id)).limit(1);
        assert.ok(row?.deletedAt instanceof Date);
      },
    },
    {
      name: 'ancillary revenue',
      endpoint: '/api/ancillary-revenue',
      resource: 'ancillary_revenue',
      createPayload: () => ({
        customerId,
        shipmentId: null,
        tripId: null,
        type: 'OTHER',
        amount: 120000,
        tax: 0,
        date: '2099-04-01',
        note: `Q15 ancillary ${suffix}`,
      }),
      mutatePayload: () => ({ amount: 150000, note: `Q15 ancillary update ${suffix}` }),
      fetchById: async (id) => {
        const [row] = await db.select().from(s.ancillaryRevenue).where(eq(s.ancillaryRevenue.id, id)).limit(1);
        return row;
      },
      expectCreated: (row) => {
        ancillaryRevenueIds.push(row.id);
        assert.equal(Number(row.amount), 120000);
      },
      expectUpdated: (row) => {
        assert.equal(Number(row.amount), 150000);
      },
      expectDeleted: async (id) => {
        const [row] = await db.select().from(s.ancillaryRevenue).where(eq(s.ancillaryRevenue.id, id)).limit(1);
        assert.ok(row?.deletedAt instanceof Date);
      },
    },
    {
      name: 'management fees',
      endpoint: '/api/management-fees',
      resource: 'management_fees',
      createPayload: () => ({ month: 12, year: 2099, amount: 3000000 }),
      mutatePayload: () => ({ amount: 3500000 }),
      fetchById: async (id) => {
        const [row] = await db.select().from(s.managementFees).where(eq(s.managementFees.id, id)).limit(1);
        return row;
      },
      expectCreated: (row) => {
        managementFeeIds.push(row.id);
        assert.equal(Number(row.amount), 3000000);
      },
      expectUpdated: (row) => {
        assert.equal(Number(row.amount), 3500000);
      },
      expectDeleted: async (id) => {
        const [row] = await db.select().from(s.managementFees).where(eq(s.managementFees.id, id)).limit(1);
        assert.equal(row, undefined);
      },
    },
    {
      name: 'cap table',
      endpoint: '/api/cap-table',
      resource: 'cap_table_history',
      createPayload: () => ({
        partnerName: `Q15 Partner ${suffix}`,
        percentage: 60,
        contributionAmount: 60000000,
        effectiveDate: '2099-05-01',
      }),
      mutatePayload: () => ({ percentage: 55 }),
      fetchById: async (id) => {
        const [row] = await db.select().from(s.capTableHistory).where(eq(s.capTableHistory.id, id)).limit(1);
        return row;
      },
      expectCreated: (row) => {
        capTableIds.push(row.id);
        assert.equal(Number(row.percentage), 60);
      },
      expectUpdated: (row) => {
        assert.equal(Number(row.percentage), 55);
      },
      expectDeleted: async (id) => {
        const [row] = await db.select().from(s.capTableHistory).where(eq(s.capTableHistory.id, id)).limit(1);
        assert.equal(row, undefined);
      },
    },
    {
      name: 'truck cap',
      endpoint: '/api/truck-cap',
      resource: 'truck_cap_table',
      createPayload: () => ({
        truckId,
        partnerName: `Q15 Truck Partner ${suffix}`,
        percentage: 40,
        role: 'INVESTOR',
        effectiveDate: '2099-06-01',
      }),
      mutatePayload: () => ({ percentage: 45 }),
      fetchById: async (id) => {
        const [row] = await db.select().from(s.truckCapTable).where(eq(s.truckCapTable.id, id)).limit(1);
        return row;
      },
      expectCreated: (row) => {
        truckCapIds.push(row.id);
        assert.equal(Number(row.percentage), 40);
      },
      expectUpdated: (row) => {
        assert.equal(Number(row.percentage), 45);
      },
      expectDeleted: async (id) => {
        const [row] = await db.select().from(s.truckCapTable).where(eq(s.truckCapTable.id, id)).limit(1);
        assert.equal(row, undefined);
      },
    },
    {
      name: 'business calendar',
      endpoint: '/api/business-calendar',
      resource: 'business_calendar_days',
      adminOnly: true,
      createPayload: () => ({
        calendarDate: '2099-12-01',
        name: `Q15 Calendar ${suffix}`,
        isWorkingDay: false,
      }),
      mutatePayload: () => ({
        isWorkingDay: true,
        name: `Q15 Calendar Updated ${suffix}`,
      }),
      fetchById: async (id) => {
        const [row] = await db.select().from(s.businessCalendarDays).where(eq(s.businessCalendarDays.id, id)).limit(1);
        return row;
      },
      expectCreated: (row) => {
        businessCalendarIds.push(row.id);
        assert.equal(row.calendarDate, '2099-12-01');
        assert.equal(row.isWorkingDay, false);
      },
      expectUpdated: (row) => {
        assert.equal(row.isWorkingDay, true);
      },
      expectDeleted: async (id) => {
        const [row] = await db.select().from(s.businessCalendarDays).where(eq(s.businessCalendarDays.id, id)).limit(1);
        assert.equal(row, undefined);
      },
    },
    {
      name: 'penalty reasons',
      endpoint: '/api/penalty-reasons',
      resource: 'penalty_reasons',
      createPayload: () => ({
        reasonText: `Q15 Penalty ${suffix}`,
        defaultAmount: 180000,
        severity: 'mid',
      }),
      mutatePayload: () => ({
        defaultAmount: 210000,
      }),
      fetchById: async (id) => {
        const [row] = await db.select().from(s.penaltyReasons).where(eq(s.penaltyReasons.id, id)).limit(1);
        return row;
      },
      expectCreated: (row) => {
        penaltyReasonIds.push(row.id);
        assert.equal(Number(row.defaultAmount), 180000);
      },
      expectUpdated: (row) => {
        assert.equal(Number(row.defaultAmount), 210000);
      },
      expectDeleted: async (id) => {
        const [row] = await db.select().from(s.penaltyReasons).where(eq(s.penaltyReasons.id, id)).limit(1);
        assert.ok(row?.deletedAt instanceof Date);
      },
    },
    {
      name: 'expense categories',
      endpoint: '/api/expense-categories',
      resource: 'expense_categories',
      createPayload: () => ({
        name: `Q15 Expense ${suffix}`,
        isRenewable: true,
        reminderLeadDays: 15,
      }),
      mutatePayload: () => ({
        reminderLeadDays: 30,
      }),
      fetchById: async (id) => {
        const [row] = await db.select().from(s.expenseCategories).where(eq(s.expenseCategories.id, id)).limit(1);
        return row;
      },
      expectCreated: (row) => {
        expenseCategoryIds.push(row.id);
        assert.equal(row.isRenewable, true);
        assert.equal(row.reminderLeadDays, 15);
      },
      expectUpdated: (row) => {
        assert.equal(row.reminderLeadDays, 30);
      },
      expectDeleted: async (id) => {
        const [row] = await db.select().from(s.expenseCategories).where(eq(s.expenseCategories.id, id)).limit(1);
        assert.ok(row?.deletedAt instanceof Date);
      },
    },
    {
      name: 'forwarder expense types',
      endpoint: '/api/forwarder-expense-types',
      resource: 'forwarder_expense_types',
      createPayload: () => ({
        code: `Q15-FWD-${suffix}`.slice(0, 20),
        name: `Q15 Forwarder ${suffix}`,
        requiresInvoice: false,
        substituteEvidenceAllowed: true,
        noInvoicePerItemLimit: 150000,
        noInvoicePerDayLimit: 300000,
      }),
      mutatePayload: () => ({
        noInvoicePerDayLimit: 450000,
      }),
      fetchById: async (id) => {
        const [row] = await db.select().from(s.forwarderExpenseTypes).where(eq(s.forwarderExpenseTypes.id, id)).limit(1);
        return row;
      },
      expectCreated: (row) => {
        forwarderExpenseTypeIds.push(row.id);
        assert.equal(Number(row.noInvoicePerItemLimit), 150000);
        assert.equal(Number(row.noInvoicePerDayLimit), 300000);
        assert.equal(row.noInvoicePolicyVersion, 1);
      },
      expectUpdated: (row) => {
        assert.equal(Number(row.noInvoicePerDayLimit), 450000);
        assert.equal(row.noInvoicePolicyVersion, 2);
      },
      expectDeleted: async (id) => {
        const [row] = await db.select().from(s.forwarderExpenseTypes).where(eq(s.forwarderExpenseTypes.id, id)).limit(1);
        assert.ok(row?.deletedAt instanceof Date);
      },
    },
  ];

  it('applies a new Admin price-config change immediately', async () => {
    const response = await api('POST', '/api/pricing-tables', {
      actorIndex: 2,
      body: {
        customerId,
        routeId,
        price: 1_765_432,
        effectiveDate: '2098-11-01',
      },
      idempotencyKey: `q15-admin-immediate-${suffix}`,
    });

    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.ok(!('actionKind' in response.body), JSON.stringify(response.body));
    const pricingTableId = Number(response.body.id);
    pricingTableIds.push(pricingTableId);

    const [createdRow] = await db.select().from(s.pricingTables)
      .where(eq(s.pricingTables.id, pricingTableId)).limit(1);
    assert.ok(createdRow, 'Admin immediate apply must persist the row');
    assert.equal(Number(createdRow.price), 1_765_432);
  });

  it('serializes duplicate governed requests even with different idempotency keys', async () => {
    const payload = {
      customerId,
      routeId,
      price: 2_345_678,
      effectiveDate: '2098-12-01',
    };
    const [left, right] = await Promise.all([
      api('POST', '/api/pricing-tables', {
        body: payload,
        idempotencyKey: `q15-app-authority-left-${suffix}`,
      }),
      api('POST', '/api/pricing-tables', {
        body: payload,
        idempotencyKey: `q15-app-authority-right-${suffix}`,
      }),
    ]);
    assert.deepEqual([left.status, right.status].sort(), [201, 409]);
    const winner = left.status === 201 ? left : right;
    expectAppliedRow(winner, 'duplicate governed request winner');
    const winnerId = Number(winner.body.id);
    pricingTableIds.push(winnerId);

    // Exactly one apply won: a single persisted pricing row for the duplicate
    // payload (the loser 409'd on the governed canonical-uniqueness check).
    const persistedRows = await db.select({ id: s.pricingTables.id })
      .from(s.pricingTables)
      .where(and(
        eq(s.pricingTables.customerId, customerId),
        eq(s.pricingTables.routeId, routeId),
        eq(s.pricingTables.price, '2345678'),
        eq(s.pricingTables.effectiveDate, '2098-12-01'),
      ));
    assert.equal(persistedRows.length, 1);
  });

  it('applies all financially material generated config resources directly with an APPROVED audit action per write', async () => {
    for (const resource of materialCases) {
      const actorIndex = resource.adminOnly ? 2 : 0;
      const created = await api('POST', resource.endpoint, {
        actorIndex,
        body: resource.createPayload(),
      });
      assert.equal(created.status, 201, `${resource.name}: ${JSON.stringify(created.body)}`);
      assert.ok(!('actionKind' in created.body), `${resource.name}: governed create must apply directly, not queue`);
      const createdId = Number(created.body.id);
      const createdRow = await resource.fetchById(createdId);
      assert.ok(createdRow, `${resource.name}: governed create must persist immediately`);
      await resource.expectCreated(createdRow);

      const updated = await api('PUT', `${resource.endpoint}/${createdId}`, {
        actorIndex,
        body: resource.mutatePayload(createdRow),
        expectedUpdatedAt: createdRow.updatedAt,
      });
      assert.equal(updated.status, 200, `${resource.name}: ${JSON.stringify(updated.body)}`);
      assert.ok(!('actionKind' in updated.body), `${resource.name}: governed update must apply directly, not queue`);
      const updatedRow = await resource.fetchById(createdId);
      assert.ok(updatedRow, `${resource.name}: governed update must keep row visible`);
      await resource.expectUpdated(updatedRow);

      const deleted = await api('DELETE', `${resource.endpoint}/${createdId}`, {
        actorIndex,
        body: {},
        expectedUpdatedAt: updatedRow.updatedAt,
      });
      assert.equal(deleted.status, 200, `${resource.name}: ${JSON.stringify(deleted.body)}`);
      await resource.expectDeleted(createdId);
    }
  });

  it('replays identical governed requests, rejects viewers, and prevents stale writes on the shared config path', async () => {
    const key = `q15-price-replay-${suffix}`;
    const [replayRoute] = await db.insert(s.routes).values({
      name: `Q15 Pricing Replay/drift fixture route ${suffix}`,
    }).returning();
    routeIds.push(replayRoute.id);

    // Idempotent replay of a governed create returns the same applied row;
    // the same key with a drifted payload is rejected.
    const first = await api('POST', '/api/pricing-tables', {
      body: { customerId, routeId: replayRoute.id, price: 2100000 },
      idempotencyKey: key,
    });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    expectAppliedRow(first, 'pricing replay create');
    const firstPricingTableId = Number(first.body.id);
    pricingTableIds.push(firstPricingTableId);

    const replay = await api('POST', '/api/pricing-tables', {
      body: { customerId, routeId: replayRoute.id, price: 2100000 },
      idempotencyKey: key,
    });
    assert.equal(replay.status, 201);
    assert.equal(replay.body.id, first.body.id);
    assert.ok(!('actionKind' in replay.body), `expected row replay: ${JSON.stringify(replay.body)}`);

    const changedPayload = await api('POST', '/api/pricing-tables', {
      body: { customerId, routeId: replayRoute.id, price: 2200000 },
      idempotencyKey: key,
    });
    assert.equal(changedPayload.status, 409);

    // RBAC boundary unchanged: a role without GOVERNANCE_CREATE cannot write
    // governed catalogs at all.
    const viewerDenied = await api('POST', '/api/road-allowances', {
      actorIndex: 3,
      body: { routeId, trailerType: TrailerType.FT20, baseAmount: 123000 },
    });
    assert.equal(viewerDenied.status, 403, `viewer denial body ${JSON.stringify(viewerDenied.body)}`);

    // Stale governed updates are still rejected on the direct path: bump the
    // row behind the client's back, then replay the old expectedUpdatedAt.
    const [replayTarget] = await db.select().from(s.pricingTables)
      .where(eq(s.pricingTables.id, firstPricingTableId)).limit(1);
    assert.ok(replayTarget);
    await db.update(s.pricingTables).set({
      price: '2500000',
      updatedAt: new Date(Date.now() + 5000),
    }).where(eq(s.pricingTables.id, firstPricingTableId));

    const stale = await api('PUT', `/api/pricing-tables/${firstPricingTableId}`, {
      body: { price: 2400000 },
      expectedUpdatedAt: replayTarget.updatedAt,
    });
    assert.equal(stale.status, 409);
    assert.match(String(stale.body.error ?? stale.body.message ?? ''), /đã được người khác cập nhật|đã thay đổi/i);
    const [driftedRow] = await db.select().from(s.pricingTables)
      .where(eq(s.pricingTables.id, firstPricingTableId)).limit(1);
    assert.equal(Number(driftedRow.price), 2500000);
  });

  it('keeps ordinary customer edits direct while debt-authority fields require governance', async () => {
    const [currentCustomer] = await db.select().from(s.customers).where(eq(s.customers.id, customerId)).limit(1);
    assert.ok(currentCustomer);

    const directUpdate = await api('PUT', `/api/customers/${customerId}`, {
      body: { contactPerson: 'Direct Customer Edit' },
      expectedUpdatedAt: currentCustomer.updatedAt,
    });
    assert.equal(directUpdate.status, 200, `direct customer update body ${JSON.stringify(directUpdate.body)}`);
    assert.equal(directUpdate.body.contactPerson, 'Direct Customer Edit');
    assert.equal(directUpdate.body.status, 'ACTIVE');

    const [afterDirect] = await db.select().from(s.customers).where(eq(s.customers.id, customerId)).limit(1);
    assert.equal(afterDirect?.contactPerson, 'Direct Customer Edit');
    assert.equal(afterDirect?.creditLimit, null);

    const governedUpdate = await api('PUT', `/api/customers/${customerId}`, {
      body: {
        creditLimit: 5000000,
        paymentTermDays: 21,
      },
      expectedUpdatedAt: afterDirect!.updatedAt,
    });
    expectAppliedRow(governedUpdate, 'customer governed update');
    assert.equal(governedUpdate.status, 200, JSON.stringify(governedUpdate.body));

    const [afterApproval] = await db.select().from(s.customers).where(eq(s.customers.id, customerId)).limit(1);
    assert.equal(Number(afterApproval?.creditLimit), 5000000);
    assert.equal(afterApproval?.paymentTermDays, 21);
    assert.equal(afterApproval?.contactPerson, 'Direct Customer Edit');
  });

  it('applies route and supplier catalog changes immediately without a governance action', async () => {
    const createdRoute = await api('POST', '/api/routes', {
      body: {
        name: `Q15 Direct Route ${suffix}`,
        distanceKm: 92,
        isMountain: false,
        fixedFuelAllowance: 65000,
        tollsStations: 2,
        driverSalary: 310000,
      },
    });
    assert.equal(createdRoute.status, 201, `direct route create body ${JSON.stringify(createdRoute.body)}`);
    assert.equal(createdRoute.body.status, undefined, `direct route must not create governance action ${JSON.stringify(createdRoute.body)}`);
    const directRouteId = Number(createdRoute.body.id);
    routeIds.push(directRouteId);

    const [routeAfterCreate] = await db.select().from(s.routes).where(eq(s.routes.id, directRouteId)).limit(1);
    assert.equal(Number(routeAfterCreate?.distanceKm), 92);

    const updatedRoute = await api('PUT', `/api/routes/${directRouteId}`, {
      body: { distanceKm: 97 },
      expectedUpdatedAt: routeAfterCreate!.updatedAt,
    });
    assert.equal(updatedRoute.status, 200, `direct route update body ${JSON.stringify(updatedRoute.body)}`);
    assert.equal(updatedRoute.body.status, undefined, `direct route update must not create governance action ${JSON.stringify(updatedRoute.body)}`);

    const [routeAfterUpdate] = await db.select().from(s.routes).where(eq(s.routes.id, directRouteId)).limit(1);
    assert.equal(Number(routeAfterUpdate?.distanceKm), 97);

    const deletedRoute = await api('DELETE', `/api/routes/${directRouteId}`, {
      body: {},
      expectedUpdatedAt: routeAfterUpdate!.updatedAt,
    });
    assert.equal(deletedRoute.status, 200, `direct route delete body ${JSON.stringify(deletedRoute.body)}`);
    assert.equal(deletedRoute.body.ok, true);
    const [routeAfterDelete] = await db.select().from(s.routes).where(eq(s.routes.id, directRouteId)).limit(1);
    assert.ok(routeAfterDelete?.deletedAt instanceof Date);

    const createdSupplier = await api('POST', '/api/suppliers', {
      body: {
        name: `Q15 Direct Supplier ${suffix}`,
        linkedCustomerId: customerId,
        types: ['service'],
        primaryType: 'service',
      },
    });
    assert.equal(createdSupplier.status, 201, `direct supplier create body ${JSON.stringify(createdSupplier.body)}`);
    assert.notEqual(createdSupplier.body.status, 'PENDING_CHECK', `direct supplier must not create governance action ${JSON.stringify(createdSupplier.body)}`);
    const directSupplierId = Number(createdSupplier.body.id);
    supplierIds.push(directSupplierId);

    const [supplierAfterCreate] = await db.select().from(s.suppliers).where(eq(s.suppliers.id, directSupplierId)).limit(1);
    assert.deepEqual(supplierAfterCreate?.types, ['SERVICE']);
    const [customerAfterCreate] = await db.select().from(s.customers).where(eq(s.customers.id, customerId)).limit(1);
    assert.equal(customerAfterCreate?.linkedSupplierId, directSupplierId);

    const updatedSupplier = await api('PUT', `/api/suppliers/${directSupplierId}`, {
      body: { types: ['service', 'fuel'], primaryType: 'fuel' },
      expectedUpdatedAt: supplierAfterCreate!.updatedAt,
    });
    assert.equal(updatedSupplier.status, 200, `direct supplier update body ${JSON.stringify(updatedSupplier.body)}`);
    assert.notEqual(updatedSupplier.body.status, 'PENDING_CHECK', `direct supplier update must not create governance action ${JSON.stringify(updatedSupplier.body)}`);

    const [supplierAfterUpdate] = await db.select().from(s.suppliers).where(eq(s.suppliers.id, directSupplierId)).limit(1);
    assert.deepEqual(supplierAfterUpdate?.types, ['SERVICE', 'FUEL']);
    assert.equal(supplierAfterUpdate?.primaryType, 'FUEL');

    const deletedSupplier = await api('DELETE', `/api/suppliers/${directSupplierId}`, {
      body: {},
      expectedUpdatedAt: supplierAfterUpdate!.updatedAt,
    });
    assert.equal(deletedSupplier.status, 200, `direct supplier delete body ${JSON.stringify(deletedSupplier.body)}`);
    assert.equal(deletedSupplier.body.ok, true);
    const [supplierAfterDelete] = await db.select().from(s.suppliers).where(eq(s.suppliers.id, directSupplierId)).limit(1);
    assert.ok(supplierAfterDelete?.deletedAt instanceof Date);
    const [customerAfterDelete] = await db.select().from(s.customers).where(eq(s.customers.id, customerId)).limit(1);
    assert.equal(customerAfterDelete?.linkedSupplierId, null);
  });
});
