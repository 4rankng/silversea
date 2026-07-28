import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray, sql } from 'drizzle-orm';

import { Role, TripStatus } from '@tingting/shared';
import { db, client } from '../db';
import * as s from '../db/schema';
import { getAppSettings, saveAppSettings } from '../services/app-settings.service';
import {
  approveCreditOverrideRequest,
  checkCreditOverrideRequest,
  checkCreditLimit,
  createCreditOverrideRequest,
  type CreditOverrideView,
} from '../services/credit-limit.service';
import { createTrip } from '../services/trip.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createdUserIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdCargoTypeIds: number[] = [];
const createdContainerTypeIds: number[] = [];
const createdPricingIds: number[] = [];
const createdTripIds: number[] = [];
const createdShipmentIds: number[] = [];
const createdLedgerIds: number[] = [];
const createdCreditOverrideIds: number[] = [];
const createdGovernanceActionIds: number[] = [];
let originalSettings: Awaited<ReturnType<typeof getAppSettings>>;

function trackGovernanceAction(request: CreditOverrideView) {
  assert.notEqual(request.governanceActionId, null);
  createdGovernanceActionIds.push(request.governanceActionId as number);
}

async function mkUser(role: Role) {
  const [user] = await db.insert(s.users).values({
    username: `m53-${role.toLowerCase()}-${suffix}-${createdUserIds.length}`,
    passwordHash: 'test',
    role,
  }).returning();
  createdUserIds.push(user.id);
  return { ...user, role: user.role as Role };
}

async function mkCustomer(creditLimit: string, creditWarningThreshold?: string | null) {
  const [row] = await db.execute<{ id: number }>(sql`
    insert into customers (name, credit_limit, credit_warning_threshold)
    values (${`M53 customer ${suffix}-${createdCustomerIds.length}`}, ${creditLimit}, ${creditWarningThreshold ?? null})
    returning id
  `);
  createdCustomerIds.push(row.id);
  return { id: row.id };
}

async function mkRoute() {
  const [route] = await db.insert(s.routes).values({
    name: `M53 route ${suffix}-${createdRouteIds.length}`,
  }).returning();
  createdRouteIds.push(route.id);
  return route;
}

async function mkCargoType() {
  const [cargoType] = await db.insert(s.cargoTypes).values({
    name: `M53 cargo ${suffix}-${createdCargoTypeIds.length}`,
  }).returning();
  createdCargoTypeIds.push(cargoType.id);
  return cargoType;
}

async function mkContainerType() {
  const [containerType] = await db.insert(s.containerTypes).values({
    code: `M53-${createdContainerTypeIds.length}-${suffix}`.slice(0, 20),
    name: `M53 container ${createdContainerTypeIds.length}`,
  }).returning();
  createdContainerTypeIds.push(containerType.id);
  return containerType;
}

async function mkPricingTable(customerId: number, routeId: number, price: string) {
  const [pricing] = await db.insert(s.pricingTables).values({
    customerId,
    routeId,
    price,
    effectiveDate: '2026-07-27',
  }).returning();
  createdPricingIds.push(pricing.id);
  return pricing;
}

async function mkShipment(customerId: number) {
  const [shipment] = await db.insert(s.shipments).values({
    customerId,
    status: 'DRAFT',
    version: 1,
  }).returning();
  createdShipmentIds.push(shipment.id);
  return shipment;
}

async function mkLedger(customerId: number, debit: number, credit: number = 0) {
  const [entry] = await db.insert(s.ledger).values({
    entityType: 'CUSTOMER',
    entityId: customerId,
    txnType: 'TRIP_REVENUE',
    txnId: 0,
    debit: String(debit),
    credit: String(credit),
    balance: String(debit - credit),
  }).returning();
  createdLedgerIds.push(entry.id);
  return entry;
}

async function mkLiveTrip(customerId: number, routeId: number, cargoTypeId: number, revenue: string, status: TripStatus) {
  const [trip] = await db.insert(s.trips).values({
    tripCode: `M53-TRP-${createdTripIds.length}-${suffix}`.slice(0, 50),
    customerId,
    routeId,
    cargoTypeId,
    containerCount: 1,
    status,
    departureDate: '2026-07-27',
    carrierType: 'OWN',
    revenue,
    revenueEmptyReturn: revenue,
    revenueCombine: '0',
    revenueOriginal: revenue,
  }).returning();
  createdTripIds.push(trip.id);
  return trip;
}

before(async () => {
  originalSettings = await getAppSettings();
});

after(async () => {
  try {
    await saveAppSettings(originalSettings);
    if (createdGovernanceActionIds.length > 0) {
      await db.delete(s.governanceActions).where(inArray(s.governanceActions.id, createdGovernanceActionIds));
    }
    if (createdCreditOverrideIds.length > 0) {
      await db.delete(s.creditOverrideRequests).where(inArray(s.creditOverrideRequests.id, createdCreditOverrideIds));
    }
    if (createdLedgerIds.length > 0) {
      await db.delete(s.ledger).where(inArray(s.ledger.id, createdLedgerIds));
    }
    if (createdTripIds.length > 0) {
      await db.delete(s.tripContainers).where(inArray(s.tripContainers.tripId, createdTripIds));
      await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
    }
    if (createdShipmentIds.length > 0) {
      await db.delete(s.shipments).where(inArray(s.shipments.id, createdShipmentIds));
    }
    if (createdPricingIds.length > 0) {
      await db.delete(s.pricingTables).where(inArray(s.pricingTables.id, createdPricingIds));
    }
    if (createdContainerTypeIds.length > 0) {
      await db.delete(s.containerTypes).where(inArray(s.containerTypes.id, createdContainerTypeIds));
    }
    if (createdCargoTypeIds.length > 0) {
      await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, createdCargoTypeIds));
    }
    if (createdRouteIds.length > 0) {
      await db.delete(s.routes).where(inArray(s.routes.id, createdRouteIds));
    }
    if (createdCustomerIds.length > 0) {
      await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
    }
    if (createdUserIds.length > 0) {
      await db.delete(s.users).where(inArray(s.users.id, createdUserIds));
    }
  } finally {
    await client.end();
  }
});

describe('M5.3/Q01 exposure authority', () => {
  test('includes posted AR, live commitments, reserved shipment approvals, and proposed amount', async () => {
    await saveAppSettings({
      ...originalSettings,
      creditWarningThresholdDefault: 0.8,
      creditTierOneAmountCap: 1_000_000,
    });
    const customer = await mkCustomer('8000000');
    const route = await mkRoute();
    const cargoType = await mkCargoType();
    const shipment = await mkShipment(customer.id);
    const requester = await mkUser(Role.MANAGER);
    const checker = await mkUser(Role.ACCOUNTANT);
    const approver = await mkUser(Role.ADMIN);

    await mkLedger(customer.id, 3_000_000);
    await mkLiveTrip(customer.id, route.id, cargoType.id, '4000000', TripStatus.CREATED);

    const pending = await createCreditOverrideRequest({
      customerId: customer.id,
      proposedAmount: 2_000_000,
      shipmentId: shipment.id,
      reason: 'Giữ chỗ tín dụng cho lô đang chờ điều vận',
    }, { userId: requester.id, role: requester.role });
    createdCreditOverrideIds.push(pending.id);
    trackGovernanceAction(pending);
    const checked = await checkCreditOverrideRequest(pending.id, {
      userId: checker.id,
      role: checker.role,
    }, { expectedVersion: pending.version });
    const approved = await approveCreditOverrideRequest(pending.id, {
      userId: approver.id,
      role: approver.role,
    }, { expectedVersion: checked.version });

    const result = await checkCreditLimit(customer.id, { proposedAmount: 1_000_000 });
    assert.equal(result.outstanding, 3_000_000);
    assert.equal(result.approvedUncollected, 6_000_000);
    assert.equal(result.totalExposure, 10_000_000);
    assert.equal(result.exceedsLimit, true);
    assert.equal(approved.request.status, 'APPROVED');
  });

  test('uses per-customer warning threshold ahead of the global default', async () => {
    await saveAppSettings({
      ...originalSettings,
      creditWarningThresholdDefault: 0.9,
      creditTierOneAmountCap: 1_000_000,
    });
    const customer = await mkCustomer('10000000', '0.60');
    await mkLedger(customer.id, 6_000_000);

    const result = await checkCreditLimit(customer.id);
    assert.equal(result.warningThreshold, 0.6);
    assert.equal(result.exceedsWarning, true);
    assert.equal(result.exceedsLimit, false);
  });
});

describe('M5.3/Q02 overrides + canonical createTrip enforcement', () => {
  test('repeat exceptions escalate to director tier', async () => {
    await saveAppSettings({
      ...originalSettings,
      creditWarningThresholdDefault: 0.8,
      creditTierOneAmountCap: 2_000_000,
    });
    const customer = await mkCustomer('10000000');
    const requester = await mkUser(Role.MANAGER);
    const checker = await mkUser(Role.ACCOUNTANT);
    const admin = await mkUser(Role.ADMIN);
    await mkLedger(customer.id, 10_200_000);

    const first = await createCreditOverrideRequest({
      customerId: customer.id,
      proposedAmount: 300_000,
      expiresAt: '2026-07-29T12:00:00.000Z',
      reason: 'Ngoại lệ đầu tiên',
    }, { userId: requester.id, role: requester.role });
    createdCreditOverrideIds.push(first.id);
    trackGovernanceAction(first);
    const checked = await checkCreditOverrideRequest(
      first.id,
      { userId: checker.id, role: checker.role },
      { expectedVersion: first.version },
    );
    await approveCreditOverrideRequest(
      first.id,
      { userId: admin.id, role: admin.role },
      { expectedVersion: checked.version },
    );

    const second = await createCreditOverrideRequest({
      customerId: customer.id,
      proposedAmount: 200_000,
      expiresAt: '2026-07-30T12:00:00.000Z',
      reason: 'Ngoại lệ lặp lại',
    }, { userId: requester.id, role: requester.role });
    createdCreditOverrideIds.push(second.id);
    trackGovernanceAction(second);
    assert.equal(second.requiredTier, 'DIRECTOR');
    assert.equal(second.repeatException, true);
  });

  test('blocks direct trip creation without approval and allows it with an approved expiry override', async () => {
    await saveAppSettings({
      ...originalSettings,
      creditWarningThresholdDefault: 0.8,
      creditTierOneAmountCap: 2_000_000,
    });
    const requester = await mkUser(Role.MANAGER);
    const checker = await mkUser(Role.ACCOUNTANT);
    const approver = await mkUser(Role.ADMIN);
    const customer = await mkCustomer('4000000');
    const route = await mkRoute();
    const cargoType = await mkCargoType();
    const containerType = await mkContainerType();
    await mkPricingTable(customer.id, route.id, '5000000');

    await assert.rejects(
      () => createTrip({
        customerId: customer.id,
        routeId: route.id,
        cargoTypeId: cargoType.id,
        containerTypeId: containerType.id,
        departureDate: '2026-07-27',
        createdBy: requester.id,
      }),
      (error: unknown) => error instanceof Error && /Cần phê duyệt để tiếp tục/i.test(error.message),
    );

    const pending = await createCreditOverrideRequest({
      customerId: customer.id,
      proposedAmount: 5_000_000,
      expiresAt: '2026-07-29T12:00:00.000Z',
      reason: 'Cho phép phục vụ đơn hàng gấp trong 48 giờ',
    }, { userId: requester.id, role: requester.role });
    createdCreditOverrideIds.push(pending.id);
    trackGovernanceAction(pending);
    const checked = await checkCreditOverrideRequest(pending.id, {
      userId: checker.id,
      role: checker.role,
    }, { expectedVersion: pending.version });
    await approveCreditOverrideRequest(pending.id, {
      userId: approver.id,
      role: approver.role,
    }, { expectedVersion: checked.version });

    const trip = await createTrip({
      customerId: customer.id,
      routeId: route.id,
      cargoTypeId: cargoType.id,
      containerTypeId: containerType.id,
      departureDate: '2026-07-27',
      creditApprovalRequestId: pending.id,
      createdBy: requester.id,
    });
    createdTripIds.push(trip.id);

    const [storedRequest] = await db.select()
      .from(s.creditOverrideRequests)
      .where(eq(s.creditOverrideRequests.id, pending.id))
      .limit(1);

    assert.equal(trip.status, 'CREATED');
    assert.equal(storedRequest?.status, 'APPROVED');
    assert.equal(storedRequest?.consumedAt, null);
  });

  test('consumes shipment-scoped approvals on first successful use', async () => {
    await saveAppSettings({
      ...originalSettings,
      creditWarningThresholdDefault: 0.8,
      creditTierOneAmountCap: 2_000_000,
    });
    const requester = await mkUser(Role.MANAGER);
    const checker = await mkUser(Role.ACCOUNTANT);
    const approver = await mkUser(Role.ADMIN);
    const customer = await mkCustomer('4000000');
    const route = await mkRoute();
    const cargoType = await mkCargoType();
    const containerType = await mkContainerType();
    const shipment = await mkShipment(customer.id);
    await mkPricingTable(customer.id, route.id, '5000000');

    const pending = await createCreditOverrideRequest({
      customerId: customer.id,
      proposedAmount: 5_000_000,
      shipmentId: shipment.id,
      reason: 'Chỉ áp dụng cho lô hàng này',
    }, { userId: requester.id, role: requester.role });
    createdCreditOverrideIds.push(pending.id);
    trackGovernanceAction(pending);
    const checked = await checkCreditOverrideRequest(pending.id, {
      userId: checker.id,
      role: checker.role,
    }, { expectedVersion: pending.version });
    await approveCreditOverrideRequest(pending.id, {
      userId: approver.id,
      role: approver.role,
    }, { expectedVersion: checked.version });

    const trip = await createTrip({
      customerId: customer.id,
      routeId: route.id,
      cargoTypeId: cargoType.id,
      containerTypeId: containerType.id,
      departureDate: '2026-07-27',
      shipmentId: shipment.id,
      creditApprovalRequestId: pending.id,
      createdBy: requester.id,
    });
    createdTripIds.push(trip.id);

    const [storedRequest] = await db.select()
      .from(s.creditOverrideRequests)
      .where(eq(s.creditOverrideRequests.id, pending.id))
      .limit(1);
    assert.equal(storedRequest?.consumedTripId, trip.id);
    assert.ok(storedRequest?.consumedAt instanceof Date);

    await assert.rejects(
      () => createTrip({
        customerId: customer.id,
        routeId: route.id,
        cargoTypeId: cargoType.id,
        containerTypeId: containerType.id,
        departureDate: '2026-07-27',
        shipmentId: shipment.id,
        creditApprovalRequestId: pending.id,
        createdBy: requester.id,
      }),
      (error: unknown) => error instanceof Error && /đã được sử dụng/i.test(error.message),
    );
  });
});
