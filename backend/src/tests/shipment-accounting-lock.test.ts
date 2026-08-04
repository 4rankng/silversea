import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray } from 'drizzle-orm';
import { Role, TripStatus } from '@tingting/shared';

import { client, db } from '../db';
import * as s from '../db/schema';
import type { AuthUser } from '../middleware/auth';
import {
  activateShipmentAccountingLock,
  getShipmentAccountingLockSummary,
} from '../services/shipment-accounting-lock.service';
import { updateShipment } from '../services/shipment.service';
import { transitionTripStatus } from '../services/trip-status-machine.service';
import { postingChecksum } from '../services/billingDocument.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let setupSequence = 0;
const customerIds: number[] = [];
const routeIds: number[] = [];
const shipmentIds: number[] = [];
const tripIds: number[] = [];
const postingIds: number[] = [];
const documentIds: number[] = [];
const expenseIds: number[] = [];
const userIds: number[] = [];

async function setup() {
  const setupSuffix = `${suffix}-${++setupSequence}`;
  const [accountant] = await db.insert(s.users).values({
    username: `lock-accountant-${setupSuffix}`,
    passwordHash: 'test-only',
    role: Role.ACCOUNTANT,
    status: 'ACTIVE',
  }).returning();
  userIds.push(accountant.id);
  const actor: AuthUser = {
    userId: accountant.id,
    username: accountant.username,
    email: null,
    fullName: null,
    role: Role.ACCOUNTANT,
  };
  const [customer] = await db.insert(s.customers).values({ name: `Lock customer ${setupSuffix}` }).returning();
  customerIds.push(customer.id);
  const [route] = await db.insert(s.routes).values({ name: `Lock route ${setupSuffix}` }).returning();
  routeIds.push(route.id);
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id,
    routeId: route.id,
    shipmentCode: `LOCK-${setupSuffix}`.slice(0, 50),
    status: 'COMPLETED',
    closingAt: new Date('2026-07-10T08:00:00.000Z'),
    createdBy: accountant.id,
  }).returning();
  shipmentIds.push(shipment.id);
  const [trip] = await db.insert(s.trips).values({
    tripCode: `LOCK-TRIP-${setupSuffix}`.slice(0, 50),
    customerId: customer.id,
    routeId: route.id,
    shipmentId: shipment.id,
    status: TripStatus.COMPLETED,
    departureDate: '2026-07-10',
  }).returning();
  tripIds.push(trip.id);
  const [posting] = await db.insert(s.tripFinancialPostings).values({
    tripId: trip.id,
    version: 1,
    tripVersion: trip.version,
    reason: 'TRIP_COMPLETED',
    effectiveAt: new Date('2026-07-10T12:00:00.000Z'),
  }).returning();
  postingIds.push(posting.id);
  const [document] = await db.insert(s.billingDocuments).values({
    type: 'DEBIT_NOTE',
    entityType: 'CUSTOMER',
    entityId: customer.id,
    entityName: customer.name,
    rangeFrom: '2026-07-01',
    rangeTo: '2026-07-31',
    totalInclVat: '1000000',
    debitNoteStatus: 'SENT',
    issuedAt: new Date('2026-08-01T02:00:00.000Z'),
  }).returning();
  documentIds.push(document.id);
  await db.insert(s.billingDocumentTripClaims).values({
    documentId: document.id,
    tripId: trip.id,
    financialPostingId: posting.id,
    financialPostingVersion: posting.version,
    postingChecksum: postingChecksum(posting),
    rangeFrom: document.rangeFrom,
    rangeTo: document.rangeTo,
    createdBy: accountant.id,
  });
  return { actor, shipment, trip, document };
}

after(async () => {
  if (shipmentIds.length) {
    await db.delete(s.auditLogs).where(and(
      eq(s.auditLogs.entityType, 'shipment-accounting-lock'),
      inArray(s.auditLogs.entityId, shipmentIds),
    ));
    await db.delete(s.shipmentAccountingLocks).where(inArray(s.shipmentAccountingLocks.shipmentId, shipmentIds));
  }
  if (documentIds.length) {
    await db.delete(s.billingDocumentTripClaims).where(inArray(s.billingDocumentTripClaims.documentId, documentIds));
    await db.delete(s.billingDocuments).where(inArray(s.billingDocuments.id, documentIds));
  }
  if (expenseIds.length) await db.delete(s.tripExpenses).where(inArray(s.tripExpenses.id, expenseIds));
  if (postingIds.length) await db.delete(s.tripFinancialPostings).where(inArray(s.tripFinancialPostings.id, postingIds));
  if (tripIds.length) await db.delete(s.trips).where(inArray(s.trips.id, tripIds));
  if (shipmentIds.length) await db.delete(s.shipments).where(inArray(s.shipments.id, shipmentIds));
  if (routeIds.length) await db.delete(s.routes).where(inArray(s.routes.id, routeIds));
  if (customerIds.length) await db.delete(s.customers).where(inArray(s.customers.id, customerIds));
  if (userIds.length) await db.delete(s.users).where(inArray(s.users.id, userIds));
  await client.end();
});

describe('shipment accounting lock', () => {
  test('ACCOUNTANT locks a fully billed shipment and freezes shipment and trip mutations', async () => {
    const { actor, shipment, trip, document } = await setup();
    const activated = await activateShipmentAccountingLock({
      shipmentId: shipment.id,
      input: {
        expectedVersion: shipment.version,
        billingDocumentId: document.id,
        reason: 'Đã phát hành Debit Note và chốt công nợ tháng 07/2026.',
      },
      actor,
    });
    assert.equal(activated.replayed, false);
    assert.equal(activated.lock.billingDocumentId, document.id);
    const summary = await getShipmentAccountingLockSummary(shipment.id);
    assert.deepEqual(Object.keys(summary ?? {}).sort(), [
      'activatedAt',
      'activatedByName',
      'billingDocumentId',
      'reason',
    ]);
    assert.equal(summary?.billingDocumentId, document.id);

    const [afterLock] = await db.select().from(s.shipments).where(eq(s.shipments.id, shipment.id));
    await assert.rejects(
      updateShipment(shipment.id, { version: afterLock.version, operationalNotes: 'Không được sửa' }),
      (error: unknown) => error instanceof Error && 'statusCode' in error && error.statusCode === 409,
    );
    await assert.rejects(
      transitionTripStatus(trip.id, TripStatus.COMPLETED, actor.userId, Role.ACCOUNTANT),
      (error: unknown) => error instanceof Error && 'statusCode' in error && error.statusCode === 409,
    );
  });

  test('rejects a Debit Note whose trip claim no longer matches the active posting', async () => {
    const { actor, shipment, document } = await setup();
    await db.update(s.billingDocumentTripClaims)
      .set({ postingChecksum: '0'.repeat(64) })
      .where(eq(s.billingDocumentTripClaims.documentId, document.id));
    await assert.rejects(
      activateShipmentAccountingLock({
        shipmentId: shipment.id,
        input: { expectedVersion: shipment.version, billingDocumentId: document.id, reason: 'Khóa công nợ.' },
        actor,
      }),
      /Nguồn hạch toán của Debit Note đã thay đổi/,
    );
  });

  test('rejects when an approved customer-recoverable expense is missing from the Debit Note', async () => {
    const { actor, shipment, trip, document } = await setup();
    const [expense] = await db.insert(s.tripExpenses).values({
      tripId: trip.id,
      expenseType: 'OTHER',
      buyAmount: '100000',
      sellAmount: '100000',
      recoverablePrincipalAmount: '100000',
      serviceFeeAmount: '0',
      approvalStatus: 'APPROVED',
      note: 'Chi phí thu lại khách hàng chưa có trong Debit Note',
    }).returning();
    expenseIds.push(expense.id);
    await assert.rejects(
      activateShipmentAccountingLock({
        shipmentId: shipment.id,
        input: { expectedVersion: shipment.version, billingDocumentId: document.id, reason: 'Khóa công nợ.' },
        actor,
      }),
      /chưa bao phủ đầy đủ chi phí thu lại khách hàng/,
    );
  });
});
