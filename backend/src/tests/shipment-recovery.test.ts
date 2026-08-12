import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray } from 'drizzle-orm';
import { Role, TripStatus } from '@tingting/shared';

import { client, db } from '../db';
import * as s from '../db/schema';
import type { AuthUser } from '../middleware/auth';
import { recordShipmentRecovery } from '../services/shipment-recovery.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let setupSequence = 0;
const userIds: number[] = [];
const customerIds: number[] = [];
const routeIds: number[] = [];
const shipmentIds: number[] = [];
const shipmentContainerIds: number[] = [];
const tripIds: number[] = [];
const tripContainerIds: number[] = [];
const expenseIds: number[] = [];

function expenseSourceVersion(expense: {
  updatedAt: Date;
  approvalStatus: string;
  sellAmount: string;
}) {
  return `expense:${expense.updatedAt.toISOString()}:${expense.approvalStatus}:${Number(expense.sellAmount)}`;
}

async function setup(options: {
  principal?: string | null;
  withContainer?: boolean;
  role?: Role;
} = {}) {
  const setupSuffix = `${suffix}-${++setupSequence}`;
  const [user] = await db.insert(s.users).values({
    username: `recovery-${setupSuffix}`,
    passwordHash: 'test-only',
    role: options.role ?? Role.OPS,
    status: 'ACTIVE',
  }).returning();
  userIds.push(user.id);
  const actor: AuthUser = {
    userId: user.id,
    username: user.username,
    email: null,
    fullName: `OPS ${setupSuffix}`,
    role: options.role ?? Role.OPS,
  };

  const [customer] = await db.insert(s.customers).values({
    name: `Recovery customer ${setupSuffix}`,
  }).returning();
  customerIds.push(customer.id);
  const [route] = await db.insert(s.routes).values({
    name: `Recovery route ${setupSuffix}`,
  }).returning();
  routeIds.push(route.id);
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id,
    routeId: route.id,
    shipmentCode: `REC-${setupSuffix}`.slice(0, 50),
    status: 'COMPLETED',
    closingAt: new Date('2026-08-01T08:00:00.000Z'),
    createdBy: user.id,
  }).returning();
  shipmentIds.push(shipment.id);

  let shipmentContainerId: number | null = null;
  if (options.withContainer) {
    const [container] = await db.insert(s.shipmentContainers).values({
      shipmentId: shipment.id,
      containerNumber: `CONT-${setupSuffix}`.slice(0, 50),
      createdBy: user.id,
    }).returning();
    shipmentContainerIds.push(container.id);
    shipmentContainerId = container.id;
  }

  const [trip] = await db.insert(s.trips).values({
    tripCode: `REC-TRIP-${setupSuffix}`.slice(0, 50),
    customerId: customer.id,
    routeId: route.id,
    shipmentId: shipment.id,
    status: TripStatus.COMPLETED,
    departureDate: '2026-08-01',
  }).returning();
  tripIds.push(trip.id);

  let tripContainerId: number | null = null;
  if (shipmentContainerId != null) {
    const [tripContainer] = await db.insert(s.tripContainers).values({
      tripId: trip.id,
      sourceShipmentId: shipment.id,
      sourceShipmentContainerId: shipmentContainerId,
      sourceShipmentVersion: shipment.version,
      containerNumber: `CONT-${setupSuffix}`.slice(0, 50),
      createdBy: user.id,
    }).returning();
    tripContainerIds.push(tripContainer.id);
    tripContainerId = tripContainer.id;
  }

  const [expense] = await db.insert(s.tripExpenses).values({
    tripId: trip.id,
    tripContainerId,
    expenseType: 'OTHER',
    buyAmount: '1000',
    sellAmount: '1000',
    recoverablePrincipalAmount: options.principal === undefined ? '1000' : options.principal,
    serviceFeeAmount: '0',
    approvalStatus: 'APPROVED',
    approvedAt: new Date('2026-08-02T08:00:00.000Z'),
    approvedBy: user.id,
  }).returning();
  expenseIds.push(expense.id);

  return {
    actor,
    shipment,
    shipmentContainerId,
    expense,
    sourceVersion: expenseSourceVersion(expense),
  };
}

after(async () => {
  if (expenseIds.length) {
    await db.delete(s.auditLogs).where(and(
      eq(s.auditLogs.entityType, 'shipment-recovery-fact'),
      inArray(s.auditLogs.entityId, shipmentIds),
    ));
    await db.delete(s.shipmentRecoveryFacts).where(inArray(s.shipmentRecoveryFacts.sourceExpenseId, expenseIds));
    await db.delete(s.tripExpenses).where(inArray(s.tripExpenses.id, expenseIds));
  }
  if (shipmentIds.length) {
    await db.delete(s.shipmentAccountingLocks).where(inArray(s.shipmentAccountingLocks.shipmentId, shipmentIds));
  }
  if (tripContainerIds.length) await db.delete(s.tripContainers).where(inArray(s.tripContainers.id, tripContainerIds));
  if (tripIds.length) await db.delete(s.trips).where(inArray(s.trips.id, tripIds));
  if (shipmentContainerIds.length) await db.delete(s.shipmentContainers).where(inArray(s.shipmentContainers.id, shipmentContainerIds));
  if (shipmentIds.length) await db.delete(s.shipments).where(inArray(s.shipments.id, shipmentIds));
  if (routeIds.length) await db.delete(s.routes).where(inArray(s.routes.id, routeIds));
  if (customerIds.length) await db.delete(s.customers).where(inArray(s.customers.id, customerIds));
  if (userIds.length) await db.delete(s.users).where(inArray(s.users.id, userIds));
  await client.end();
});

describe('shipment recovery writer', () => {
  test('creates a container-linked partial recovery and updates it to recovered', async () => {
    const source = await setup({ withContainer: true });
    const partial = await recordShipmentRecovery({
      expenseId: source.expense.id,
      expectedExpenseVersion: source.expense.version,
      expectedSourceVersion: source.sourceVersion,
      expectedRecoveryVersion: 0,
      kind: 'DEPOSIT',
      recoveredAmount: '400',
      status: 'PARTIAL',
      waiverReason: null,
      actor: source.actor,
    });
    assert.equal(partial.kind, 'DEPOSIT');
    assert.equal(partial.status, 'PARTIAL');
    assert.equal(partial.expectedAmount, '1000');
    assert.equal(partial.recoveredAmount, '400');
    assert.equal(partial.outstandingAmount, '600');
    assert.equal(partial.shipmentContainerId, source.shipmentContainerId);
    assert.equal(partial.sourceVersion, source.sourceVersion);
    assert.equal(partial.version, 1);
    const [shipmentAfterPartial] = await db.select({ version: s.shipments.version })
      .from(s.shipments).where(eq(s.shipments.id, source.shipment.id));
    assert.equal(shipmentAfterPartial.version, source.shipment.version + 1);

    const recovered = await recordShipmentRecovery({
      expenseId: source.expense.id,
      expectedExpenseVersion: source.expense.version,
      expectedSourceVersion: source.sourceVersion,
      expectedRecoveryVersion: partial.version,
      kind: 'DEPOSIT',
      recoveredAmount: '1000',
      status: 'RECOVERED',
      waiverReason: null,
      actor: source.actor,
    });
    assert.equal(recovered.id, partial.id);
    assert.equal(recovered.status, 'RECOVERED');
    assert.equal(recovered.outstandingAmount, '0');
    assert.equal(recovered.version, 2);
    assert.equal(recovered.createdBy, source.actor.userId);
    assert.equal(recovered.updatedBy, source.actor.userId);
    const [shipmentAfterRecovered] = await db.select({ version: s.shipments.version })
      .from(s.shipments).where(eq(s.shipments.id, source.shipment.id));
    assert.equal(shipmentAfterRecovered.version, source.shipment.version + 2);
  });

  test('records REPAIR only from the explicit command classification', async () => {
    const source = await setup();
    const fact = await recordShipmentRecovery({
      expenseId: source.expense.id,
      expectedExpenseVersion: source.expense.version,
      expectedSourceVersion: source.sourceVersion,
      expectedRecoveryVersion: 0,
      kind: 'REPAIR',
      recoveredAmount: '0',
      status: 'OPEN',
      waiverReason: null,
      actor: source.actor,
    });
    assert.equal(fact.kind, 'REPAIR');
    assert.equal(fact.expectedAmount, '1000');
  });

  test('requires an explicit classification and recoverable principal', async () => {
    const source = await setup({ principal: null });
    await assert.rejects(
      recordShipmentRecovery({
        expenseId: source.expense.id,
        expectedExpenseVersion: source.expense.version,
        expectedSourceVersion: source.sourceVersion,
        expectedRecoveryVersion: 0,
        kind: 'DEPOSIT',
        recoveredAmount: '0',
        status: 'OPEN',
        waiverReason: null,
        actor: source.actor,
      }),
      /Chưa phân loại riêng số tiền phải thu hồi/,
    );
    const classified = await setup();
    await assert.rejects(
      recordShipmentRecovery({
        expenseId: classified.expense.id,
        expectedExpenseVersion: classified.expense.version,
        expectedSourceVersion: classified.sourceVersion,
        expectedRecoveryVersion: 0,
        kind: undefined as never,
        recoveredAmount: '0',
        status: 'OPEN',
        waiverReason: null,
        actor: classified.actor,
      }),
      /Loại thu hồi không hợp lệ/,
    );
  });

  test('rejects stale expense and recovery versions', async () => {
    const source = await setup();
    await assert.rejects(
      recordShipmentRecovery({
        expenseId: source.expense.id,
        expectedExpenseVersion: source.expense.version + 1,
        expectedSourceVersion: source.sourceVersion,
        expectedRecoveryVersion: 0,
        kind: 'OTHER',
        recoveredAmount: '0',
        status: 'OPEN',
        waiverReason: null,
        actor: source.actor,
      }),
      /Chi phí vừa thay đổi/,
    );
    await assert.rejects(
      recordShipmentRecovery({
        expenseId: source.expense.id,
        expectedExpenseVersion: source.expense.version,
        expectedSourceVersion: `${source.sourceVersion}:stale`,
        expectedRecoveryVersion: 0,
        kind: 'OTHER',
        recoveredAmount: '0',
        status: 'OPEN',
        waiverReason: null,
        actor: source.actor,
      }),
      /Chi phí vừa thay đổi/,
    );
    const created = await recordShipmentRecovery({
      expenseId: source.expense.id,
      expectedExpenseVersion: source.expense.version,
      expectedSourceVersion: source.sourceVersion,
      expectedRecoveryVersion: 0,
      kind: 'OTHER',
      recoveredAmount: '0',
      status: 'OPEN',
      waiverReason: null,
      actor: source.actor,
    });
    await assert.rejects(
      recordShipmentRecovery({
        expenseId: source.expense.id,
        expectedExpenseVersion: source.expense.version,
        expectedSourceVersion: source.sourceVersion,
        expectedRecoveryVersion: created.version + 1,
        kind: 'OTHER',
        recoveredAmount: '500',
        status: 'PARTIAL',
        waiverReason: null,
        actor: source.actor,
      }),
      /Theo dõi thu hồi vừa thay đổi/,
    );
  });

  test('denies actors outside OPS and ADMIN', async () => {
    const source = await setup({ role: Role.CUS });
    await assert.rejects(
      recordShipmentRecovery({
        expenseId: source.expense.id,
        expectedExpenseVersion: source.expense.version,
        expectedSourceVersion: source.sourceVersion,
        expectedRecoveryVersion: 0,
        kind: 'OTHER',
        recoveredAmount: '0',
        status: 'OPEN',
        waiverReason: null,
        actor: source.actor,
      }),
      (error: unknown) => error instanceof Error && 'statusCode' in error && error.statusCode === 403,
    );
  });

  test('blocks recovery mutations while the shipment accounting lock is active', async () => {
    const source = await setup();
    await db.insert(s.shipmentAccountingLocks).values({
      shipmentId: source.shipment.id,
      billingDocumentId: 999_000 + setupSequence,
      billingDocumentVersion: 1,
      billingPeriodSnapshot: {
        rangeFrom: '2026-08-01',
        rangeTo: '2026-08-31',
        issuedAt: '2026-09-01T00:00:00.000Z',
      },
      shipmentVersionAtLock: source.shipment.version,
      reason: 'Test active lock',
      activatedBy: source.actor.userId,
    });
    await assert.rejects(
      recordShipmentRecovery({
        expenseId: source.expense.id,
        expectedExpenseVersion: source.expense.version,
        expectedSourceVersion: source.sourceVersion,
        expectedRecoveryVersion: 0,
        kind: 'OTHER',
        recoveredAmount: '0',
        status: 'OPEN',
        waiverReason: null,
        actor: source.actor,
      }),
      /Lô hàng đã được CUS khóa/,
    );
  });

  test('enforces status amounts and durable waiver semantics', async () => {
    const source = await setup();
    await assert.rejects(
      recordShipmentRecovery({
        expenseId: source.expense.id,
        expectedExpenseVersion: source.expense.version,
        expectedSourceVersion: source.sourceVersion,
        expectedRecoveryVersion: 0,
        kind: 'OTHER',
        recoveredAmount: '1001',
        status: 'RECOVERED',
        waiverReason: null,
        actor: source.actor,
      }),
      /không được vượt quá số phải thu hồi/,
    );
    await assert.rejects(
      recordShipmentRecovery({
        expenseId: source.expense.id,
        expectedExpenseVersion: source.expense.version,
        expectedSourceVersion: source.sourceVersion,
        expectedRecoveryVersion: 0,
        kind: 'OTHER',
        recoveredAmount: '200',
        status: 'WAIVED',
        waiverReason: null,
        actor: source.actor,
      }),
      /phải có lý do miễn thu/,
    );
    const waived = await recordShipmentRecovery({
      expenseId: source.expense.id,
      expectedExpenseVersion: source.expense.version,
      expectedSourceVersion: source.sourceVersion,
      expectedRecoveryVersion: 0,
      kind: 'OTHER',
      recoveredAmount: '200',
      status: 'WAIVED',
      waiverReason: 'Khách hàng được miễn phần còn lại theo phê duyệt.',
      actor: source.actor,
    });
    assert.equal(waived.outstandingAmount, '0');
    assert.equal(waived.waiverReason, 'Khách hàng được miễn phần còn lại theo phê duyệt.');
  });
});
