import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { inArray } from 'drizzle-orm';

import { client, db } from '../db';
import * as s from '../db/schema';
import { cacheInvalidatePattern, disconnectRedis } from '../lib/redis';
import { getPnlReport } from '../services/pnl.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ids = {
  customers: [] as number[], routes: [] as number[], cargoTypes: [] as number[], trucks: [] as number[],
  policies: [] as number[], profiles: [] as number[], trips: [] as number[], postings: [] as number[],
};

describe('persisted fleet fixed-cost allocation', () => {
  test('allocates the approved monthly truck cost to a completed active posting and reconciles P&L', async () => {
    const [customer] = await db.insert(s.customers).values({ name: `P&L fleet customer ${suffix}` }).returning({ id: s.customers.id });
    const [route] = await db.insert(s.routes).values({ name: `P&L fleet route ${suffix}` }).returning({ id: s.routes.id });
    const [cargoType] = await db.insert(s.cargoTypes).values({ name: `P&L fleet cargo ${suffix}` }).returning({ id: s.cargoTypes.id });
    const [truck] = await db.insert(s.trucks).values({ licensePlate: `PF-${suffix}`.slice(0, 20), status: 'ACTIVE' }).returning({ id: s.trucks.id });
    ids.customers.push(customer.id); ids.routes.push(route.id); ids.cargoTypes.push(cargoType.id); ids.trucks.push(truck.id);

    const governanceBase = 1_800_000_000 + Math.floor(Math.random() * 50_000_000);
    const [policy] = await db.insert(s.financialReportingPolicyVersions).values({
      effectiveFrom: '2098-06-01',
      depreciationMethod: 'STRAIGHT_LINE',
      allocationBasis: 'COMPLETED_TRIP_REVENUE_SHARE',
      lowMarginThresholdRatio: '0.2000',
      governanceActionId: governanceBase,
      createdBy: governanceBase,
    }).returning({ id: s.financialReportingPolicyVersions.id });
    ids.policies.push(policy.id);
    const [profile] = await db.insert(s.truckFinancialProfileVersions).values({
      truckId: truck.id,
      effectiveFrom: '2098-06-01',
      acquisitionCost: '120000',
      residualValue: '0',
      inServiceDate: '2098-06-01',
      usefulLifeMonths: 12,
      monthlyFixedCost: '4000',
      governanceActionId: governanceBase + 1,
      createdBy: governanceBase,
    }).returning({ id: s.truckFinancialProfileVersions.id });
    ids.profiles.push(profile.id);

    const [trip] = await db.insert(s.trips).values({
      tripCode: `PF-${suffix}`.slice(0, 50), customerId: customer.id, routeId: route.id,
      cargoTypeId: cargoType.id, truckId: truck.id, carrierType: 'OWN', status: 'COMPLETED',
      departureDate: '2098-06-15', completedAt: new Date('2098-06-15T05:00:00.000Z'),
      revenue: '30000', totalCost: '12000', grossProfit: '18000',
    }).returning({ id: s.trips.id, version: s.trips.version });
    ids.trips.push(trip.id);
    const [posting] = await db.insert(s.tripFinancialPostings).values({
      tripId: trip.id, version: 1, tripVersion: trip.version, status: 'ACTIVE',
      reason: 'COMPLETION', effectiveAt: new Date('2098-06-15T05:00:00.000Z'),
    }).returning({ id: s.tripFinancialPostings.id });
    ids.postings.push(posting.id);

    await cacheInvalidatePattern('reports:pnl:*');
    const report = await getPnlReport(6, 2098);
    const detail = report.tripDetails.find((row) => row.id === trip.id);
    const truckRow = report.trucks.find((row) => row.id === truck.id);

    assert.equal(report.financialPolicy.policyVersionId, policy.id);
    assert.equal(report.fleetDepreciationTotal, 10_000);
    assert.equal(report.fleetMonthlyFixedCostTotal, 4_000);
    assert.equal(report.allocatedFleetFixedCostTotal, 14_000);
    assert.equal(report.unallocatedFleetFixedCostTotal, 0);
    assert.equal(report.totalCosts, 26_000);
    assert.equal(report.grossProfit, 4_000);
    assert.equal(detail?.allocatedFleetFixedCost, 14_000);
    assert.equal(detail?.totalCostWithFleetFixedCost, 26_000);
    assert.equal(detail?.netProfitAfterFleetFixedCost, 4_000);
    assert.equal(truckRow?.allocatedFleetFixedCost, 14_000);
    assert.equal(truckRow?.profit, 4_000);
  });
});

after(async () => {
  // Shared test infrastructure owns the process-wide Redis and Postgres
  // clients, so this file cleans only the rows and cache entries it created.
  await cacheInvalidatePattern('reports:pnl:*');
  if (ids.postings.length) await db.delete(s.tripFinancialPostings).where(inArray(s.tripFinancialPostings.id, ids.postings));
  if (ids.trips.length) await db.delete(s.trips).where(inArray(s.trips.id, ids.trips));
  if (ids.profiles.length) await db.delete(s.truckFinancialProfileVersions).where(inArray(s.truckFinancialProfileVersions.id, ids.profiles));
  if (ids.policies.length) await db.delete(s.financialReportingPolicyVersions).where(inArray(s.financialReportingPolicyVersions.id, ids.policies));
  if (ids.trucks.length) await db.delete(s.trucks).where(inArray(s.trucks.id, ids.trucks));
  if (ids.customers.length) await db.delete(s.customers).where(inArray(s.customers.id, ids.customers));
  if (ids.routes.length) await db.delete(s.routes).where(inArray(s.routes.id, ids.routes));
  if (ids.cargoTypes.length) await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, ids.cargoTypes));
  await disconnectRedis();
  await client.end();
});
