import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray } from 'drizzle-orm';
import { Role, TripStatus } from '@tingting/shared';

import { client, db } from '../db';
import * as s from '../db/schema';
import type { AuthUser } from '../middleware/auth';
import {
  activateShipmentAccountingLock,
  confirmShipmentFinance,
  getShipmentAccountingLockSummary,
  getShipmentFinanceConfirmationSummary,
  requestShipmentReopen,
  reviewShipmentChargeProposal,
} from '../services/shipment-accounting-lock.service';
import { recordShipmentRecovery } from '../services/shipment-recovery.service';
import { updateShipment } from '../services/shipment.service';
import { transitionTripStatus } from '../services/trip-status-machine.service';
import { postingChecksum } from '../services/billing-document.service';

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
const shipmentContainerIds: number[] = [];
const recoveryFactIds: number[] = [];

function expenseSourceVersion(expense: { updatedAt: Date; approvalStatus: string; sellAmount: string }) {
  return `expense:${expense.updatedAt.toISOString()}:${expense.approvalStatus}:${Number(expense.sellAmount)}`;
}

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
  const [ops] = await db.insert(s.users).values({
    username: `lock-ops-${setupSuffix}`,
    passwordHash: 'test-only',
    role: Role.OPS,
    status: 'ACTIVE',
  }).returning();
  const [admin] = await db.insert(s.users).values({
    username: `lock-admin-${setupSuffix}`,
    passwordHash: 'test-only',
    role: Role.ADMIN,
    status: 'ACTIVE',
  }).returning();
  userIds.push(ops.id, admin.id);
  const opsActor: AuthUser = {
    userId: ops.id,
    username: ops.username,
    email: null,
    fullName: null,
    role: Role.OPS,
  };
  const adminActor: AuthUser = {
    userId: admin.id,
    username: admin.username,
    email: null,
    fullName: null,
    role: Role.ADMIN,
  };
  const [customer] = await db.insert(s.customers).values({ name: `Lock customer ${setupSuffix}` }).returning();
  customerIds.push(customer.id);
  const [cus] = await db.insert(s.users).values({
    username: `lock-cus-${setupSuffix}`,
    passwordHash: 'test-only',
    role: Role.CUS,
    status: 'ACTIVE',
  }).returning();
  userIds.push(cus.id);
  const cusActor: AuthUser = {
    userId: cus.id,
    username: cus.username,
    email: null,
    fullName: null,
    role: Role.CUS,
    customerId: null,
    customerIds: [customer.id],
  };
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
  return { actor, cusActor, opsActor, adminActor, shipment, trip, document };
}

async function insertAdhocBillingLine(args: {
  documentId: number;
  amount: string;
  description?: string;
}) {
  const [line] = await db.insert(s.billingDocumentLines).values({
    documentId: args.documentId,
    sourceType: 'ADHOC',
    sourceId: null,
    lineType: 'ADHOC',
    typeLabel: 'Đề xuất CUS',
    unit: 'lần',
    description: args.description ?? 'Phí thủ công CUS',
    baseAmount: args.amount,
    amountOverride: args.amount,
    excluded: false,
    vatTreatment: 'EXEMPT',
    vatRate: '0',
    vatTreatmentVersion: 'VAT-V1',
    netAmount: args.amount,
    taxAmount: '0',
    grossAmount: args.amount,
    sortOrder: 0,
  }).returning();
  return line;
}

after(async () => {
  if (shipmentIds.length) {
    await db.delete(s.auditLogs).where(and(
      eq(s.auditLogs.entityType, 'shipment-accounting-lock'),
      inArray(s.auditLogs.entityId, shipmentIds),
    ));
    await db.delete(s.auditLogs).where(and(
      eq(s.auditLogs.entityType, 'shipment-charge-proposal-link'),
      inArray(s.auditLogs.entityId, shipmentIds),
    ));
    await db.delete(s.shipmentAccountingLocks).where(inArray(s.shipmentAccountingLocks.shipmentId, shipmentIds));
    await db.delete(s.shipmentFinanceActions).where(inArray(s.shipmentFinanceActions.shipmentId, shipmentIds));
  }
  if (documentIds.length) {
    await db.delete(s.notifications).where(and(
      eq(s.notifications.relatedEntityType, 'billing_documents'),
      inArray(s.notifications.relatedEntityId, documentIds),
    ));
    await db.delete(s.auditLogs).where(and(
      eq(s.auditLogs.entityType, 'billing-document-source-change'),
      inArray(s.auditLogs.entityId, documentIds),
    ));
  }
  if (recoveryFactIds.length) await db.delete(s.shipmentRecoveryFacts).where(inArray(s.shipmentRecoveryFacts.id, recoveryFactIds));
  if (documentIds.length) {
    await db.delete(s.billingDocumentTripClaims).where(inArray(s.billingDocumentTripClaims.documentId, documentIds));
    await db.delete(s.billingDocuments).where(inArray(s.billingDocuments.id, documentIds));
  }
  if (expenseIds.length) await db.delete(s.tripExpenses).where(inArray(s.tripExpenses.id, expenseIds));
  if (postingIds.length) await db.delete(s.tripFinancialPostings).where(inArray(s.tripFinancialPostings.id, postingIds));
  if (tripIds.length) await db.delete(s.trips).where(inArray(s.trips.id, tripIds));
  if (shipmentContainerIds.length) await db.delete(s.shipmentContainers).where(inArray(s.shipmentContainers.id, shipmentContainerIds));
  if (shipmentIds.length) await db.delete(s.shipments).where(inArray(s.shipments.id, shipmentIds));
  if (routeIds.length) await db.delete(s.routes).where(inArray(s.routes.id, routeIds));
  if (customerIds.length) await db.delete(s.customers).where(inArray(s.customers.id, customerIds));
  if (userIds.length) await db.delete(s.users).where(inArray(s.users.id, userIds));
  await client.end();
});

describe('shipment accounting lock', () => {
  test('ACCOUNTANT confirms and CUS locks a fully billed shipment, then shipment and trip mutations are frozen', async () => {
    const { actor, cusActor, shipment, trip, document } = await setup();
    const confirmation = await confirmShipmentFinance({
      shipmentId: shipment.id,
      input: {
        expectedVersion: shipment.version,
        billingDocumentId: document.id,
        reason: 'Kế toán đã đối soát đầy đủ số liệu Debit Note tháng 07/2026.',
      },
      actor,
    });
    assert.equal(confirmation.replayed, false);
    assert.equal(confirmation.confirmation.status, 'CONFIRMED');
    const activated = await activateShipmentAccountingLock({
      shipmentId: shipment.id,
      input: {
        expectedVersion: shipment.version,
        confirmationId: Number(confirmation.confirmation.confirmationId),
        confirmationChecksum: String(confirmation.confirmation.checksum),
        reason: 'Đã phát hành Debit Note và chốt công nợ tháng 07/2026.',
        acknowledged: true,
      },
      actor: cusActor,
    });
    assert.equal(activated.replayed, false);
    assert.equal(activated.lock.billingDocumentId, document.id);
    const summary = await getShipmentAccountingLockSummary(shipment.id);
    assert.deepEqual(Object.keys(summary ?? {}).sort(), [
      'activatedAt',
      'activatedByName',
      'billingDocumentId',
      'id',
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
      confirmShipmentFinance({
        shipmentId: shipment.id,
        input: {
          expectedVersion: shipment.version,
          billingDocumentId: document.id,
          reason: 'Kế toán xác nhận lần đầu.',
        },
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
      confirmShipmentFinance({
        shipmentId: shipment.id,
        input: { expectedVersion: shipment.version, billingDocumentId: document.id, reason: 'Xác nhận công nợ.' },
        actor,
      }),
      /chưa bao phủ đầy đủ chi phí thu lại khách hàng/,
    );
  });

  test('rejects a pending nonzero expense without creating a confirmation action', async () => {
    const { actor, shipment, trip, document } = await setup();
    const [expense] = await db.insert(s.tripExpenses).values({
      tripId: trip.id,
      expenseType: 'OTHER',
      buyAmount: '100000',
      sellAmount: '100000',
      recoverablePrincipalAmount: '100000',
      serviceFeeAmount: '0',
      approvalStatus: 'PENDING',
      note: 'Chi phí đang chờ duyệt phải chặn xác nhận',
    }).returning();
    expenseIds.push(expense.id);

    await assert.rejects(
      confirmShipmentFinance({
        shipmentId: shipment.id,
        input: { expectedVersion: shipment.version, billingDocumentId: document.id, reason: 'Không được tạo.' },
        actor,
      }),
      /phải được phê duyệt trước khi xác nhận tài chính/,
    );
    const actions = await db.select({ id: s.shipmentFinanceActions.id }).from(s.shipmentFinanceActions).where(and(
      eq(s.shipmentFinanceActions.shipmentId, shipment.id),
      eq(s.shipmentFinanceActions.actionKind, 'SHIPMENT_COST_CONFIRMATION'),
    ));
    assert.equal(actions.length, 0);
  });

  test('rejects an unbilled nonzero manual proposal without creating a confirmation action', async () => {
    const { actor, shipment, document } = await setup();
    const [container] = await db.insert(s.shipmentContainers).values({
      shipmentId: shipment.id,
      containerNumber: `UNBILLED-CONT-${shipment.id}`,
      createdBy: actor.userId,
    }).returning();
    shipmentContainerIds.push(container.id);
    await db.update(s.shipmentContainers)
      .set({ outboundIncidentalAmount: '250000' })
      .where(eq(s.shipmentContainers.id, container.id))
      .returning({ id: s.shipmentContainers.id, version: s.shipmentContainers.chargeProposalVersion });

    await assert.rejects(
      confirmShipmentFinance({
        shipmentId: shipment.id,
        input: { expectedVersion: shipment.version, billingDocumentId: document.id, reason: 'Không được tạo.' },
        actor,
      }),
      /đề xuất phí thủ công chưa có liên kết nguồn có thẩm quyền trong Debit Note/,
    );
    const actions = await db.select({ id: s.shipmentFinanceActions.id }).from(s.shipmentFinanceActions).where(and(
      eq(s.shipmentFinanceActions.shipmentId, shipment.id),
      eq(s.shipmentFinanceActions.actionKind, 'SHIPMENT_COST_CONFIRMATION'),
    ));
    assert.equal(actions.length, 0);
  });

  test('links a nonzero manual proposal to an exact current Debit Note line, then confirmation and CUS lock succeed', async () => {
    const { actor, cusActor, shipment, document } = await setup();
    const [container] = await db.insert(s.shipmentContainers).values({
      shipmentId: shipment.id,
      containerNumber: `LINKED-CONT-${shipment.id}`,
      createdBy: actor.userId,
    }).returning();
    shipmentContainerIds.push(container.id);
    const [proposal] = await db.update(s.shipmentContainers)
      .set({ outboundIncidentalAmount: '250000' })
      .where(eq(s.shipmentContainers.id, container.id))
      .returning({ id: s.shipmentContainers.id, version: s.shipmentContainers.chargeProposalVersion });
    const line = await insertAdhocBillingLine({
      documentId: document.id,
      amount: '250000',
      description: 'CUS đề xuất phí nâng hạ',
    });

    const reviewed = await reviewShipmentChargeProposal({
      shipmentId: shipment.id,
      input: {
        decision: 'ACCEPT_LINK',
        expectedShipmentVersion: shipment.version,
        proposalFactId: proposal.id,
        proposalField: 'OUTBOUND_INCIDENTAL',
        proposalVersion: proposal.version,
        billingDocumentId: document.id,
        billingDocumentLineId: line.id,
        reason: 'Đã đối chiếu và chọn đúng dòng Debit Note thủ công.',
      },
      actor,
    });
    assert.equal(reviewed.replayed, false);
    assert.equal(reviewed.review.billingDocumentLineId, line.id);

    const [reviewedShipment] = await db.select().from(s.shipments).where(eq(s.shipments.id, shipment.id));
    const confirmation = await confirmShipmentFinance({
      shipmentId: shipment.id,
      input: {
        expectedVersion: reviewedShipment.version,
        billingDocumentId: document.id,
        reason: 'Đã bao phủ đầy đủ cả đề xuất thủ công.',
      },
      actor,
    });
    assert.equal(confirmation.confirmation.status, 'CONFIRMED');

    const locked = await activateShipmentAccountingLock({
      shipmentId: shipment.id,
      input: {
        expectedVersion: reviewedShipment.version,
        confirmationId: Number(confirmation.confirmation.confirmationId),
        confirmationChecksum: String(confirmation.confirmation.checksum),
        reason: 'CUS khóa lô sau khi Debit Note đã bao phủ đề xuất thủ công.',
        acknowledged: true,
      },
      actor: cusActor,
    });
    assert.equal(locked.replayed, false);
    assert.equal(locked.lock.billingDocumentId, document.id);
  });

  test('rejects confirmation when a previously linked manual proposal changed after the Debit Note link was recorded', async () => {
    const { actor, shipment, document } = await setup();
    const [container] = await db.insert(s.shipmentContainers).values({
      shipmentId: shipment.id,
      containerNumber: `STALE-CONT-${shipment.id}`,
      createdBy: actor.userId,
    }).returning();
    shipmentContainerIds.push(container.id);
    const [proposal] = await db.update(s.shipmentContainers)
      .set({ outboundIncidentalAmount: '250000' })
      .where(eq(s.shipmentContainers.id, container.id))
      .returning({ id: s.shipmentContainers.id, version: s.shipmentContainers.chargeProposalVersion });
    const line = await insertAdhocBillingLine({
      documentId: document.id,
      amount: '250000',
      description: 'CUS đề xuất phí nâng hạ',
    });

    const reviewed = await reviewShipmentChargeProposal({
      shipmentId: shipment.id,
      input: {
        decision: 'ACCEPT_LINK',
        expectedShipmentVersion: shipment.version,
        proposalFactId: proposal.id,
        proposalField: 'OUTBOUND_INCIDENTAL',
        proposalVersion: proposal.version,
        billingDocumentId: document.id,
        billingDocumentLineId: line.id,
        reason: 'Liên kết lần đầu.',
      },
      actor,
    });
    assert.equal(reviewed.replayed, false);

    const [shipmentAfterReview] = await db.select().from(s.shipments).where(eq(s.shipments.id, shipment.id));
    await db.update(s.shipmentContainers).set({
      outboundIncidentalAmount: '260000',
      chargeProposalVersion: 2,
    }).where(eq(s.shipmentContainers.id, proposal.id));

    await assert.rejects(
      confirmShipmentFinance({
        shipmentId: shipment.id,
        input: {
          expectedVersion: shipmentAfterReview.version,
          billingDocumentId: document.id,
          reason: 'Không được xác nhận khi nguồn đề xuất đã đổi.',
        },
        actor,
      }),
      /liên kết Debit Note của đề xuất phí thủ công không còn hiện hành/i,
    );
  });

  test('reject decision blocks confirmation until the current manual proposal is linked again', async () => {
    const { actor, shipment, document } = await setup();
    const [container] = await db.insert(s.shipmentContainers).values({
      shipmentId: shipment.id,
      containerNumber: `REJECT-CONT-${shipment.id}`,
      createdBy: actor.userId,
    }).returning();
    shipmentContainerIds.push(container.id);
    const [proposal] = await db.update(s.shipmentContainers)
      .set({ outboundIncidentalAmount: '250000' })
      .where(eq(s.shipmentContainers.id, container.id))
      .returning({ id: s.shipmentContainers.id, version: s.shipmentContainers.chargeProposalVersion });

    const reviewed = await reviewShipmentChargeProposal({
      shipmentId: shipment.id,
      input: {
        decision: 'REJECT',
        expectedShipmentVersion: shipment.version,
        proposalFactId: proposal.id,
        proposalField: 'OUTBOUND_INCIDENTAL',
        proposalVersion: proposal.version,
        reason: 'Dòng Debit Note hiện tại chưa đúng nguồn, tạm từ chối.',
      },
      actor,
    });
    assert.equal(reviewed.replayed, false);

    const [shipmentAfterReview] = await db.select().from(s.shipments).where(eq(s.shipments.id, shipment.id));
    await assert.rejects(
      confirmShipmentFinance({
        shipmentId: shipment.id,
        input: {
          expectedVersion: shipmentAfterReview.version,
          billingDocumentId: document.id,
          reason: 'Không được xác nhận khi đề xuất đang bị từ chối.',
        },
        actor,
      }),
      /đã bị từ chối liên kết Debit Note/i,
    );
  });

  test('snapshots recovery and zero-valued manual proposal identities, then recovery mutation makes confirmation stale', async () => {
    const { actor, opsActor, shipment, trip, document } = await setup();
    const [container] = await db.insert(s.shipmentContainers).values({
      shipmentId: shipment.id,
      containerNumber: `LOCK-CONT-${shipment.id}`,
      createdBy: actor.userId,
    }).returning();
    shipmentContainerIds.push(container.id);
    const [proposal] = await db.update(s.shipmentContainers)
      .set({ outboundIncidentalAmount: '0' })
      .where(eq(s.shipmentContainers.id, container.id))
      .returning({ id: s.shipmentContainers.id, version: s.shipmentContainers.chargeProposalVersion });
    const [expense] = await db.insert(s.tripExpenses).values({
      tripId: trip.id,
      expenseType: 'OTHER',
      buyAmount: '1000',
      sellAmount: '1000',
      recoverablePrincipalAmount: '1000',
      serviceFeeAmount: '0',
      approvalStatus: 'APPROVED',
    }).returning();
    expenseIds.push(expense.id);
    const sourceVersion = expenseSourceVersion(expense);
    await db.insert(s.billingDocumentRecoverableClaims).values({
      documentId: document.id,
      expenseId: expense.id,
      expenseVersion: expense.version,
      sourceVersion,
      evidenceSnapshot: { sourceVersion },
      createdBy: actor.userId,
    });
    const openFact = await recordShipmentRecovery({
      expenseId: expense.id,
      expectedExpenseVersion: expense.version,
      expectedSourceVersion: sourceVersion,
      expectedRecoveryVersion: 0,
      kind: 'DEPOSIT',
      recoveredAmount: '0',
      status: 'OPEN',
      actor: opsActor,
    });
    recoveryFactIds.push(openFact.id);
    const [currentShipment] = await db.select().from(s.shipments).where(eq(s.shipments.id, shipment.id));
    const confirmation = await confirmShipmentFinance({
      shipmentId: shipment.id,
      input: { expectedVersion: currentShipment.version, billingDocumentId: document.id, reason: 'Đối soát nguồn.' },
      actor,
    });
    const [action] = await db.select().from(s.shipmentFinanceActions)
      .where(eq(s.shipmentFinanceActions.id, Number(confirmation.confirmation.confirmationId)));
    const after = action.afterSnapshot as Record<string, unknown>;
    assert.deepEqual(after.recoveryFacts, [{
      id: openFact.id,
      sourceExpenseId: expense.id,
      version: 1,
      sourceVersion,
      kind: 'DEPOSIT',
      status: 'OPEN',
      expectedAmount: '1000',
      recoveredAmount: '0',
      outstandingAmount: '1000',
    }]);
    assert.deepEqual(after.chargeProposals, [{
      id: proposal.id,
      shipmentContainerId: container.id,
      version: 1,
      outboundTransportAmount: null,
      outboundHandlingAmount: null,
      outboundIncidentalAmount: '0',
      inboundTransportAmount: null,
      inboundHandlingAmount: null,
    }]);

    await recordShipmentRecovery({
      expenseId: expense.id,
      expectedExpenseVersion: expense.version,
      expectedSourceVersion: sourceVersion,
      expectedRecoveryVersion: openFact.version,
      kind: 'DEPOSIT',
      recoveredAmount: '400',
      status: 'PARTIAL',
      actor: opsActor,
    });
    assert.equal((await getShipmentFinanceConfirmationSummary(shipment.id)).status, 'STALE');
  });

  test('direct reopen (approval flow removed 2026-09-10) invalidates confirmation and marks Debit Note reconciliation atomically', async () => {
    const { actor, cusActor, shipment, document } = await setup();
    const confirmation = await confirmShipmentFinance({
      shipmentId: shipment.id,
      input: { expectedVersion: shipment.version, billingDocumentId: document.id, reason: 'Kế toán xác nhận.' },
      actor,
    });
    await activateShipmentAccountingLock({
      shipmentId: shipment.id,
      input: {
        expectedVersion: shipment.version,
        confirmationId: Number(confirmation.confirmation.confirmationId),
        confirmationChecksum: String(confirmation.confirmation.checksum),
        reason: 'CUS khóa lô.',
        acknowledged: true,
      },
      actor: cusActor,
    });
    const [lockedShipment] = await db.select().from(s.shipments).where(eq(s.shipments.id, shipment.id));
    const lock = await getShipmentAccountingLockSummary(shipment.id);
    const requested = await requestShipmentReopen({
      shipmentId: shipment.id,
      input: {
        expectedShipmentVersion: lockedShipment.version,
        activeLockId: lock!.id,
        reason: 'Cần điều chỉnh nguồn sau khóa.',
      },
      actor: cusActor,
    });
    // The phê duyệt step is gone: the CUS request reopens immediately.
    assert.equal(requested.reopened, true);
    const [updatedDocument] = await db.select().from(s.billingDocuments).where(eq(s.billingDocuments.id, document.id));
    const [sourceChangeAudit] = await db.select().from(s.auditLogs).where(and(
      eq(s.auditLogs.entityType, 'billing-document-source-change'),
      eq(s.auditLogs.entityId, document.id),
    ));
    assert.equal(updatedDocument.authorityState, 'ADJUSTMENT_REQUIRED');
    assert.ok(updatedDocument.authorityWarningAt);
    assert.match(updatedDocument.authorityWarningReason ?? '', /cần đối soát lại/i);
    assert.ok(sourceChangeAudit);
    assert.equal(requested.invalidatedConfirmationId, confirmation.confirmation.confirmationId);
    assert.equal((await getShipmentFinanceConfirmationSummary(shipment.id)).status, 'STALE');
    assert.equal(await getShipmentAccountingLockSummary(shipment.id), null);
  });
});
