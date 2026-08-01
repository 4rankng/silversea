import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { createAdvanceSettlementSchema, TxnType, updateAdvanceSettlementSchema } from '@tingting/shared';
import { db, client } from '../db';
import * as s from '../db/schema';
import {
  approveAdvanceRequest,
  adjustSettlementExpense,
  approveAdvanceSettlement,
  checkAdvanceSettlement,
  createAdvanceSettlement,
  createAdvanceRequest,
  getAdvanceSettlement,
  getOutstandingAdvanceBalance,
  listAdvanceRequests,
  requestAdvanceSettlementReversal,
  rejectAdvanceSettlement,
  updateAdvanceSettlement,
} from '../services/advance.service';
import { approveGovernanceAction } from '../services/adjustment-governance.service';
import { checkGovernanceAction } from '../services/governance-transition.service';
import { validateSettlementInputs } from '../services/settlement-validation';
import {
  deleteTripExpenseGuarded,
  setTripExpenseCompletion,
  updateForwarderTripExpense,
} from '../services/forwarder.service';

describe('forwarder settlement streamlined workflow', () => {
  const ids = {
    users: [] as number[],
    customers: [] as number[],
    routes: [] as number[],
    cargoTypes: [] as number[],
    shipments: [] as number[],
    trips: [] as number[],
    containers: [] as number[],
    expenses: [] as number[],
    requests: [] as number[],
    settlements: [] as number[],
    actions: [] as number[],
  };

  let forwarderId: number;
  let otherForwarderId: number;
  let accountantId: number;
  let approverId: number;
  let secondApproverId: number;
  let tripId: number;
  let containerId: number;
  let requestId: number;

  test('settlement payload schemas reject duplicate request and expense IDs', () => {
    assert.equal(createAdvanceSettlementSchema.safeParse({
      advanceRequestIds: [1, 1],
      tripExpenseIds: [2, 2],
    }).success, false);
    assert.equal(updateAdvanceSettlementSchema.safeParse({
      advanceRequestIds: [1, 1],
      tripExpenseIds: [2, 2],
      refundAmount: 0,
    }).success, false);
  });

  async function insertExpense(options: {
    approvalStatus?: 'PENDING' | 'APPROVED' | 'REJECTED';
    tripContainerId?: number | null;
    buyAmount?: number;
    sellAmount?: number;
    createdBy?: number | null;
    expenseDate?: string;
  } = {}) {
    const [expense] = await db.insert(s.tripExpenses).values({
      tripId,
      forwarderId,
      createdBy: options.createdBy === undefined ? forwarderId : options.createdBy,
      expenseType: 'LIFTING',
      buyAmount: String(options.buyAmount ?? 100_000),
      sellAmount: String(options.sellAmount ?? 120_000),
      expenseDate: options.expenseDate ?? '2026-07-11',
      settlementMethod: 'FORWARDER_ADVANCE',
      approvalStatus: options.approvalStatus ?? 'PENDING',
      tripContainerId: options.tripContainerId ?? null,
    }).returning();
    ids.expenses.push(expense.id);
    return expense;
  }

  async function markCompleted(tripContainerId: number | null) {
    const scopeWhere = tripContainerId == null
      ? and(eq(s.tripExpenseCompletionScopes.tripId, tripId), isNull(s.tripExpenseCompletionScopes.tripContainerId))
      : eq(s.tripExpenseCompletionScopes.tripContainerId, tripContainerId);
    const [existing] = await db.select({ id: s.tripExpenseCompletionScopes.id })
      .from(s.tripExpenseCompletionScopes).where(scopeWhere).limit(1);
    if (existing) {
      await db.update(s.tripExpenseCompletionScopes).set({
        status: 'COMPLETED', completedBy: forwarderId, completedAt: new Date(),
      }).where(eq(s.tripExpenseCompletionScopes.id, existing.id));
      return;
    }
    await db.insert(s.tripExpenseCompletionScopes).values({
      tripId,
      tripContainerId,
      status: 'COMPLETED',
      completedBy: forwarderId,
      completedAt: new Date(),
    });
  }

  async function insertApprovedRequest(amount = 1_000_000) {
    const [request] = await db.insert(s.advanceRequests).values({
      requesterId: forwarderId,
      amount: String(amount),
      reason: 'Test hoàn ứng riêng',
      status: 'APPROVED',
      approvedBy: accountantId,
      approvedAt: new Date(),
    }).returning();
    ids.requests.push(request.id);
    return request.id;
  }

  before(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const users = await db.insert(s.users).values([
      { username: `fwd-${suffix}`, passwordHash: 'x', fullName: 'Ops test', role: 'DRIVER' },
      { username: `other-${suffix}`, passwordHash: 'x', fullName: 'Ops khác', role: 'DRIVER' },
      { username: `kt-${suffix}`, passwordHash: 'x', fullName: 'Kế toán test', role: 'ACCOUNTANT' },
      { username: `mgr-${suffix}`, passwordHash: 'x', fullName: 'Duyệt test', role: 'MANAGER' },
      { username: `admin-${suffix}`, passwordHash: 'x', fullName: 'Duyệt độc lập', role: 'ADMIN' },
    ]).returning();
    [forwarderId, otherForwarderId, accountantId, approverId, secondApproverId] = users.map(row => row.id);
    ids.users.push(...users.map(row => row.id));

    const [customer] = await db.insert(s.customers).values({ name: `Settlement customer ${suffix}` }).returning();
    const [route] = await db.insert(s.routes).values({ name: `Settlement route ${suffix}` }).returning();
    const [cargoType] = await db.insert(s.cargoTypes).values({ name: `Settlement cargo ${suffix}` }).returning();
    ids.customers.push(customer.id);
    ids.routes.push(route.id);
    ids.cargoTypes.push(cargoType.id);

    const [shipment] = await db.insert(s.shipments).values({
      shipmentCode: `ST-SHIP-${suffix}`.slice(0, 50),
      customerId: customer.id,
      cargoTypeId: cargoType.id,
      status: 'IN_PROGRESS',
    }).returning();
    ids.shipments.push(shipment.id);
    await db.insert(s.userShipmentLinks).values({ userId: forwarderId, shipmentId: shipment.id });

    const [trip] = await db.insert(s.trips).values({
      tripCode: `ST-${suffix}`.slice(0, 50),
      shipmentId: shipment.id,
      customerId: customer.id,
      routeId: route.id,
      cargoTypeId: cargoType.id,
      status: 'IN_TRANSIT',
      departureDate: '2026-07-11',
    }).returning();
    tripId = trip.id;
    ids.trips.push(trip.id);

    const [container] = await db.insert(s.tripContainers).values({
      tripId,
      containerNumber: `CONT-${suffix}`.slice(0, 50),
      createdBy: forwarderId,
    }).returning();
    containerId = container.id;
    ids.containers.push(container.id);

    const [request] = await db.insert(s.advanceRequests).values({
      requesterId: forwarderId,
      amount: '1000000',
      reason: 'Test hoàn ứng',
      status: 'APPROVED',
      approvedBy: accountantId,
      approvedAt: new Date(),
    }).returning();
    requestId = request.id;
    ids.requests.push(request.id);
  });

  after(async () => {
    if (ids.actions.length) {
      await db.delete(s.governanceActions).where(inArray(s.governanceActions.id, ids.actions));
    }
    if (ids.settlements.length) {
      await db.delete(s.ledger).where(and(
        eq(s.ledger.entityType, 'FORWARDER'),
        inArray(s.ledger.txnType, [TxnType.FORWARDER_SETTLEMENT, TxnType.ADJUSTMENT]),
        inArray(s.ledger.txnId, ids.settlements),
      ));
      await db.delete(s.settlementExpenseAdjustments)
        .where(inArray(s.settlementExpenseAdjustments.settlementId, ids.settlements));
      await db.delete(s.settlementExpenses).where(inArray(s.settlementExpenses.settlementId, ids.settlements));
      await db.delete(s.advanceSettlementRequests).where(inArray(s.advanceSettlementRequests.settlementId, ids.settlements));
      await db.delete(s.advanceSettlements).where(inArray(s.advanceSettlements.id, ids.settlements));
    }
    if (ids.expenses.length) {
      await db.delete(s.ledger).where(inArray(s.ledger.txnId, ids.expenses));
      await db.delete(s.tripExpenses).where(inArray(s.tripExpenses.id, ids.expenses));
    }
    if (ids.trips.length) await db.delete(s.tripExpenseCompletionScopes).where(inArray(s.tripExpenseCompletionScopes.tripId, ids.trips));
    if (ids.containers.length) await db.delete(s.tripContainers).where(inArray(s.tripContainers.id, ids.containers));
    if (ids.trips.length) await db.delete(s.trips).where(inArray(s.trips.id, ids.trips));
    if (ids.users.length) await db.delete(s.userShipmentLinks).where(inArray(s.userShipmentLinks.userId, ids.users));
    if (ids.shipments.length) await db.delete(s.shipments).where(inArray(s.shipments.id, ids.shipments));
    if (ids.requests.length) await db.delete(s.advanceRequests).where(inArray(s.advanceRequests.id, ids.requests));
    if (ids.customers.length) await db.delete(s.customers).where(inArray(s.customers.id, ids.customers));
    if (ids.routes.length) await db.delete(s.routes).where(inArray(s.routes.id, ids.routes));
    if (ids.cargoTypes.length) await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, ids.cargoTypes));
    if (ids.users.length) await db.delete(s.users).where(inArray(s.users.id, ids.users));
    await client.end();
  });

  test('PENDING expenses require their exact general or container scope to be COMPLETED', async () => {
    const general = await insertExpense();
    const container = await insertExpense({ tripContainerId: containerId });

    await assert.rejects(
      validateSettlementInputs({ dbOrTx: db, forwarderId, advanceRequestIds: [requestId], tripExpenseIds: [general.id] }),
      /chưa được điều hành xác nhận kê xong/,
    );
    await markCompleted(null);
    await validateSettlementInputs({ dbOrTx: db, forwarderId, advanceRequestIds: [requestId], tripExpenseIds: [general.id] });

    await assert.rejects(
      validateSettlementInputs({ dbOrTx: db, forwarderId, advanceRequestIds: [requestId], tripExpenseIds: [container.id] }),
      /chưa được điều hành xác nhận kê xong/,
    );
    await markCompleted(containerId);
    await validateSettlementInputs({ dbOrTx: db, forwarderId, advanceRequestIds: [requestId], tripExpenseIds: [container.id] });
  });

  test('revoking a shipment assignment removes completed expenses from settlement eligibility', async () => {
    const expense = await insertExpense({ approvalStatus: 'APPROVED' });
    await markCompleted(null);
    const [settlement] = await db.insert(s.advanceSettlements).values({
      code: `SCOPE-${Date.now()}`.slice(0, 20),
      forwarderId,
      totalExpenseAmount: expense.buyAmount,
      status: 'PENDING',
    }).returning();
    ids.settlements.push(settlement.id);

    const beforeRevocation = await getAdvanceSettlement(settlement.id);
    assert.ok(beforeRevocation?.eligibleExpenses.some((item) => item.id === expense.id));

    await db.delete(s.userShipmentLinks).where(and(
      eq(s.userShipmentLinks.userId, forwarderId),
      eq(s.userShipmentLinks.shipmentId, ids.shipments[0]),
    ));

    const afterRevocation = await getAdvanceSettlement(settlement.id);
    assert.ok(!afterRevocation?.eligibleExpenses.some((item) => item.id === expense.id));
    await assert.rejects(
      validateSettlementInputs({
        dbOrTx: db,
        forwarderId,
        advanceRequestIds: [requestId],
        tripExpenseIds: [expense.id],
        requireCurrentAssignment: true,
      }),
      /không còn thuộc lô hàng được giao/,
    );
    await validateSettlementInputs({
      dbOrTx: db,
      forwarderId,
      advanceRequestIds: [requestId],
      tripExpenseIds: [expense.id],
    });

    await db.insert(s.userShipmentLinks).values({
      userId: forwarderId,
      shipmentId: ids.shipments[0],
    });
  });

  test('settlement creation and assignment revocation serialize to one deterministic winner', async () => {
    const expense = await insertExpense({ approvalStatus: 'APPROVED' });
    await markCompleted(null);
    const matchingRequestId = await insertApprovedRequest(Number(expense.buyAmount));
    let releaseCreate!: () => void;
    const holdCreate = new Promise<void>((resolve) => {
      releaseCreate = resolve;
    });
    let createReady!: () => void;
    const createStarted = new Promise<void>((resolve) => {
      createReady = resolve;
    });

    const create = db.transaction(async (tx) => {
      const settlement = await createAdvanceSettlement(forwarderId, {
        advanceRequestIds: [matchingRequestId],
        tripExpenseIds: [expense.id],
        refundAmount: 0,
      }, tx);
      ids.settlements.push(settlement.id);
      createReady();
      await holdCreate;
      return settlement;
    });
    await createStarted;

    let revocationCompleted = false;
    const revoke = db.transaction(async (tx) => {
      await tx.delete(s.userShipmentLinks).where(and(
        eq(s.userShipmentLinks.userId, forwarderId),
        eq(s.userShipmentLinks.shipmentId, ids.shipments[0]),
      ));
      revocationCompleted = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(revocationCompleted, false);

    releaseCreate();
    await create;
    await revoke;
    assert.equal(revocationCompleted, true);
    await db.insert(s.userShipmentLinks).values({
      userId: forwarderId,
      shipmentId: ids.shipments[0],
    });
  });

  test('a rejected settlement link does not prevent the same expense from being resubmitted', async () => {
    const expense = await insertExpense({ approvalStatus: 'APPROVED' });
    await markCompleted(null);
    const [rejected] = await db.insert(s.advanceSettlements).values({
      code: `REJ-${Date.now()}`.slice(0, 20), forwarderId, totalExpenseAmount: expense.buyAmount, status: 'REJECTED',
    }).returning();
    ids.settlements.push(rejected.id);
    await db.insert(s.settlementExpenses).values({
      settlementId: rejected.id,
      tripExpenseId: expense.id,
      originalBuyAmount: expense.buyAmount,
      adjustedBuyAmount: expense.buyAmount,
      submittedSellAmount: expense.sellAmount,
      originalSnapshot: {
        expenseType: expense.expenseType,
        buyAmount: expense.buyAmount,
        sellAmount: expense.sellAmount,
      },
      adjustedSnapshot: {
        expenseType: expense.expenseType,
        buyAmount: expense.buyAmount,
        sellAmount: expense.sellAmount,
      },
    });

    await validateSettlementInputs({
      dbOrTx: db,
      forwarderId,
      advanceRequestIds: [requestId],
      tripExpenseIds: [expense.id],
      checkAlreadyLinked: true,
    });

    await db.update(s.tripExpenses).set({ buyAmount: '999999' }).where(eq(s.tripExpenses.id, expense.id));
    const frozen = await getAdvanceSettlement(rejected.id);
    assert.equal(frozen?.linkedExpenses?.[0]?.buyAmount, expense.buyAmount);
  });

  test('settlement form only lists approved advances that are not already claimed', async () => {
    const availableRequestId = await insertApprovedRequest(310_000);
    const activeRequestId = await insertApprovedRequest(320_000);
    const rejectedRequestId = await insertApprovedRequest(330_000);

    const [activeSettlement, rejectedSettlement] = await db.insert(s.advanceSettlements).values([
      {
        code: `ACT-${Date.now()}`.slice(0, 20),
        forwarderId,
        totalExpenseAmount: '320000',
        status: 'APPROVED',
      },
      {
        code: `REJ-${Date.now()}`.slice(0, 20),
        forwarderId,
        totalExpenseAmount: '330000',
        status: 'REJECTED',
      },
    ]).returning();
    ids.settlements.push(activeSettlement.id, rejectedSettlement.id);
    await db.insert(s.advanceSettlementRequests).values([
      { settlementId: activeSettlement.id, advanceRequestId: activeRequestId },
      { settlementId: rejectedSettlement.id, advanceRequestId: rejectedRequestId },
    ]);

    const eligible = await listAdvanceRequests({
      requesterId: forwarderId,
      status: 'APPROVED',
      excludeLinkedToActiveSettlement: true,
    });
    const eligibleIds = new Set(eligible.map(request => request.id));

    assert.equal(eligibleIds.has(availableRequestId), true);
    assert.equal(eligibleIds.has(activeRequestId), false);
    assert.equal(eligibleIds.has(rejectedRequestId), true);
  });

  test('concurrent settlement creation claims each expense and advance only once', async () => {
    const expense = await insertExpense({ buyAmount: 140_000, sellAmount: 140_000 });
    await markCompleted(null);
    const claimRequestId = await insertApprovedRequest(140_000);
    const attempts = await Promise.allSettled([
      createAdvanceSettlement(forwarderId, { advanceRequestIds: [claimRequestId], tripExpenseIds: [expense.id] }),
      createAdvanceSettlement(forwarderId, { advanceRequestIds: [claimRequestId], tripExpenseIds: [expense.id] }),
    ]);
    const successes = attempts.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof createAdvanceSettlement>>> => result.status === 'fulfilled');
    const failures = attempts.filter(result => result.status === 'rejected');
    assert.equal(successes.length, 1);
    assert.equal(failures.length, 1);
    ids.settlements.push(successes[0].value.id);
  });

  test('requester cannot approve their own advance request', async () => {
    const request = await createAdvanceRequest(forwarderId, {
      amount: 410_000,
      reason: 'Q15 tự duyệt',
    });
    ids.requests.push(request.id);

    await assert.rejects(
      () => approveAdvanceRequest(request.id, forwarderId),
      /Không thể duyệt yêu cầu tạm ứng của chính mình/,
    );
  });

  test('checker must differ from the forwarder', async () => {
    const expense = await insertExpense({ buyAmount: 150_000, sellAmount: 150_000 });
    await markCompleted(null);
    const checkRequestId = await insertApprovedRequest(150_000);
    const settlement = await createAdvanceSettlement(forwarderId, {
      advanceRequestIds: [checkRequestId], tripExpenseIds: [expense.id],
    });
    ids.settlements.push(settlement.id);

    await assert.rejects(
      () => checkAdvanceSettlement(settlement.id, forwarderId),
      /Người lập phiếu không được tự kiểm tra phiếu hoàn ứng của mình/,
    );
  });

  test('approval requires a prior accountant check and a distinct approver', async () => {
    const expense = await insertExpense({ buyAmount: 205_000, sellAmount: 205_000 });
    await markCompleted(null);
    const approvalRequestId = await insertApprovedRequest(205_000);
    const settlement = await createAdvanceSettlement(forwarderId, {
      advanceRequestIds: [approvalRequestId], tripExpenseIds: [expense.id],
    });
    ids.settlements.push(settlement.id);

    await assert.rejects(
      () => approveAdvanceSettlement(settlement.id, approverId),
      /Phiếu hoàn ứng phải được kế toán kiểm tra trước khi duyệt/,
    );

    await checkAdvanceSettlement(settlement.id, accountantId);

    await assert.rejects(
      () => approveAdvanceSettlement(settlement.id, accountantId),
      /Người kiểm tra không được đồng thời phê duyệt phiếu hoàn ứng/,
    );
  });

  test('material update after check invalidates the checker and requires a fresh check', async () => {
    const expense = await insertExpense({ buyAmount: 200_000, sellAmount: 200_000 });
    await markCompleted(null);
    const originalRequestId = await insertApprovedRequest(250_000);
    const replacementRequestId = await insertApprovedRequest(240_000);
    const settlement = await createAdvanceSettlement(forwarderId, {
      advanceRequestIds: [originalRequestId],
      tripExpenseIds: [expense.id],
      refundAmount: 50_000,
    });
    ids.settlements.push(settlement.id);

    await checkAdvanceSettlement(settlement.id, accountantId);
    await updateAdvanceSettlement(settlement.id, {
      advanceRequestIds: [replacementRequestId],
      tripExpenseIds: [expense.id],
      refundAmount: 40_000,
      note: 'Thay đổi nguồn tạm ứng sau kiểm tra',
    });
    const [invalidated] = await db.select().from(s.advanceSettlements)
      .where(eq(s.advanceSettlements.id, settlement.id));
    assert.equal(invalidated.status, 'PENDING');
    assert.equal(invalidated.checkedBy, null);
    assert.equal(invalidated.checkedAt, null);
    await assert.rejects(
      () => approveAdvanceSettlement(settlement.id, approverId),
      /phải được kế toán kiểm tra trước/,
    );

    await checkAdvanceSettlement(settlement.id, approverId);
    await approveAdvanceSettlement(settlement.id, secondApproverId);
  });

  test('correction after check invalidates it and its actor cannot approve the correction', async () => {
    const expense = await insertExpense({
      approvalStatus: 'APPROVED',
      buyAmount: 300_000,
      sellAmount: 300_000,
    });
    await markCompleted(null);
    const correctionRequestId = await insertApprovedRequest(300_000);
    const settlement = await createAdvanceSettlement(forwarderId, {
      advanceRequestIds: [correctionRequestId],
      tripExpenseIds: [expense.id],
    });
    ids.settlements.push(settlement.id);

    await checkAdvanceSettlement(settlement.id, accountantId);
    await adjustSettlementExpense(settlement.id, expense.id, approverId, {
      sellAmount: 310_000,
      adjustmentReason: 'Điều chỉnh phí bán sau kiểm tra',
    });
    const [invalidated] = await db.select().from(s.advanceSettlements)
      .where(eq(s.advanceSettlements.id, settlement.id));
    assert.equal(invalidated.status, 'PENDING');
    assert.equal(invalidated.checkedBy, null);
    assert.equal(invalidated.checkedAt, null);
    await assert.rejects(
      () => approveAdvanceSettlement(settlement.id, secondApproverId),
      /phải được kế toán kiểm tra trước/,
    );

    await assert.rejects(
      () => checkAdvanceSettlement(settlement.id, approverId),
      /người điều chỉnh|tự kiểm tra/i,
    );
    await checkAdvanceSettlement(settlement.id, accountantId);
    await assert.rejects(
      () => approveAdvanceSettlement(settlement.id, approverId),
      /người điều chỉnh|tự phê duyệt/i,
    );
    await approveAdvanceSettlement(settlement.id, secondApproverId);
    const history = await db.select().from(s.settlementExpenseAdjustments)
      .where(eq(s.settlementExpenseAdjustments.settlementId, settlement.id));
    assert.equal(history.length, 1);
    assert.equal(history[0]!.adjustedBy, approverId);
    assert.equal(history[0]!.approvedBy, secondApproverId);
  });

  test('checked settlement can still be rejected without posting ledger entries', async () => {
    const expense = await insertExpense({ buyAmount: 210_000, sellAmount: 210_000 });
    await markCompleted(null);
    const rejectRequestId = await insertApprovedRequest(210_000);
    const settlement = await createAdvanceSettlement(forwarderId, {
      advanceRequestIds: [rejectRequestId], tripExpenseIds: [expense.id],
    });
    ids.settlements.push(settlement.id);

    await checkAdvanceSettlement(settlement.id, accountantId);
    await rejectAdvanceSettlement(settlement.id, approverId);

    const [savedSettlement] = await db.select().from(s.advanceSettlements).where(eq(s.advanceSettlements.id, settlement.id));
    const ledgerRows = await db.select().from(s.ledger).where(and(
      eq(s.ledger.txnType, TxnType.FORWARDER_SETTLEMENT), eq(s.ledger.txnId, settlement.id),
    ));
    assert.equal(savedSettlement.status, 'REJECTED');
    assert.equal(savedSettlement.checkedBy, accountantId);
    assert.equal(savedSettlement.approvedBy, approverId);
    assert.equal(ledgerRows.length, 0);
  });

  test('checked settlement approves once and preserves checker/approver separation', async () => {
    const expense = await insertExpense({ buyAmount: 230_000 });
    await markCompleted(null);
    const approvalRequestId = await insertApprovedRequest(250_000);
    const settlement = await createAdvanceSettlement(forwarderId, {
      advanceRequestIds: [approvalRequestId], tripExpenseIds: [expense.id], refundAmount: 20_000,
    });
    ids.settlements.push(settlement.id);

    await checkAdvanceSettlement(settlement.id, accountantId);
    await approveAdvanceSettlement(settlement.id, approverId);
    const [savedSettlement] = await db.select().from(s.advanceSettlements).where(eq(s.advanceSettlements.id, settlement.id));
    const [savedExpense] = await db.select().from(s.tripExpenses).where(eq(s.tripExpenses.id, expense.id));
    const ledgerRows = await db.select().from(s.ledger).where(and(
      eq(s.ledger.txnType, TxnType.FORWARDER_SETTLEMENT), eq(s.ledger.txnId, settlement.id),
    ));
    assert.equal(savedSettlement.status, 'APPROVED');
    assert.equal(savedSettlement.checkedBy, accountantId);
    assert.equal(savedSettlement.approvedBy, approverId);
    assert.equal(savedExpense.approvalStatus, 'APPROVED');
    assert.equal(ledgerRows.length, 1);
    assert.equal(ledgerRows[0].debit, '250000');

    await assert.rejects(() => approveAdvanceSettlement(settlement.id, approverId), /Cannot approve settlement with status APPROVED/);
    const ledgerRowsAfterRetry = await db.select().from(s.ledger).where(and(
      eq(s.ledger.txnType, TxnType.FORWARDER_SETTLEMENT), eq(s.ledger.txnId, settlement.id),
    ));
    assert.equal(ledgerRowsAfterRetry.length, 1);
    await assert.rejects(
      () => setTripExpenseCompletion(tripId, null, false, forwarderId),
      /Chi phí đã gửi kế toán, không thể mở lại kê khai/,
    );
  });

  test('approved settlement correction and reversal require three actors and have no effect before approval', async () => {
    const expense = await insertExpense({
      approvalStatus: 'APPROVED',
      buyAmount: 300_000,
      sellAmount: 300_000,
    });
    await markCompleted(null);
    const governedRequestId = await insertApprovedRequest(300_000);
    const settlement = await createAdvanceSettlement(forwarderId, {
      advanceRequestIds: [governedRequestId],
      tripExpenseIds: [expense.id],
    });
    ids.settlements.push(settlement.id);
    await checkAdvanceSettlement(settlement.id, accountantId);
    const approved = await approveAdvanceSettlement(settlement.id, approverId);

    const correction = await adjustSettlementExpense(
      settlement.id,
      expense.id,
      secondApproverId,
      {
        expectedVersion: approved.version,
        buyAmount: 280_000,
        sellAmount: 310_000,
        adjustmentReason: 'Điều chỉnh sau duyệt có kiểm soát',
      },
      { actorRole: 'ADMIN' },
    );
    const correctionAction = correction.governanceAction;
    assert.ok(correctionAction);
    ids.actions.push(correctionAction.id);
    const [beforeApprovalLink] = await db.select().from(s.settlementExpenses)
      .where(and(
        eq(s.settlementExpenses.settlementId, settlement.id),
        eq(s.settlementExpenses.tripExpenseId, expense.id),
      ));
    const [beforeApprovalSettlement] = await db.select().from(s.advanceSettlements)
      .where(eq(s.advanceSettlements.id, settlement.id));
    assert.equal(beforeApprovalLink.adjustedBuyAmount, '300000');
    assert.equal(beforeApprovalSettlement.totalExpenseAmount, '300000');
    assert.equal(beforeApprovalSettlement.refundAmount, '0');

    const checkedCorrection = await checkGovernanceAction({
      actionId: correctionAction.id,
      checkerId: accountantId,
      checkerRole: 'ACCOUNTANT',
      expectedVersion: correctionAction.version,
    });
    await assert.rejects(
      () => approveGovernanceAction({
        actionId: correctionAction.id,
        approverId: accountantId,
        approverRole: 'ACCOUNTANT',
        expectedVersion: checkedCorrection.version,
      }),
      /người phê duyệt phải khác|người kiểm tra/i,
    );
    await approveGovernanceAction({
      actionId: correctionAction.id,
      approverId,
      approverRole: 'MANAGER',
      expectedVersion: checkedCorrection.version,
    });
    const [correctedSettlement] = await db.select().from(s.advanceSettlements)
      .where(eq(s.advanceSettlements.id, settlement.id));
    const [correctedLink] = await db.select().from(s.settlementExpenses)
      .where(and(
        eq(s.settlementExpenses.settlementId, settlement.id),
        eq(s.settlementExpenses.tripExpenseId, expense.id),
      ));
    assert.equal(correctedSettlement.totalExpenseAmount, '280000');
    assert.equal(correctedSettlement.refundAmount, '20000');
    assert.equal(correctedLink.adjustedBuyAmount, '280000');

    const reversalAction = await requestAdvanceSettlementReversal({
      settlementId: settlement.id,
      expectedVersion: correctedSettlement.version,
      reason: 'Hoàn tác phiếu đã duyệt sai chứng từ',
      makerId: secondApproverId,
      makerRole: 'ADMIN',
    });
    ids.actions.push(reversalAction.id);
    const outstandingBeforeReversal = await getOutstandingAdvanceBalance(forwarderId);
    const checkedReversal = await checkGovernanceAction({
      actionId: reversalAction.id,
      checkerId: accountantId,
      checkerRole: 'ACCOUNTANT',
      expectedVersion: reversalAction.version,
    });
    assert.equal(await getOutstandingAdvanceBalance(forwarderId), outstandingBeforeReversal);
    await approveGovernanceAction({
      actionId: reversalAction.id,
      approverId,
      approverRole: 'MANAGER',
      expectedVersion: checkedReversal.version,
    });
    const [reversedSettlement] = await db.select().from(s.advanceSettlements)
      .where(eq(s.advanceSettlements.id, settlement.id));
    assert.equal(reversedSettlement.status, 'REVERSED');
    assert.equal(
      await getOutstandingAdvanceBalance(forwarderId),
      outstandingBeforeReversal + 300_000,
    );
    const reversalLedger = await db.select().from(s.ledger).where(and(
      eq(s.ledger.txnType, TxnType.ADJUSTMENT),
      eq(s.ledger.txnId, settlement.id),
      eq(s.ledger.entityType, 'FORWARDER'),
    ));
    assert.equal(reversalLedger.at(-1)?.credit, '300000');
  });

  test('settlement correction creating first service fee freezes due dates from the expense event date', async () => {
    const expense = await insertExpense({
      approvalStatus: 'APPROVED',
      buyAmount: 300_000,
      sellAmount: 0,
      expenseDate: '2026-07-20',
    });
    await markCompleted(null);
    await db.update(s.trips).set({ status: 'COMPLETED' }).where(eq(s.trips.id, tripId));
    const governedRequestId = await insertApprovedRequest(300_000);
    const settlement = await createAdvanceSettlement(forwarderId, {
      advanceRequestIds: [governedRequestId],
      tripExpenseIds: [expense.id],
    });
    ids.settlements.push(settlement.id);

    try {
      await checkAdvanceSettlement(settlement.id, accountantId);
      const approved = await approveAdvanceSettlement(settlement.id, approverId);
      const correction = await adjustSettlementExpense(
        settlement.id,
        expense.id,
        secondApproverId,
        {
          expectedVersion: approved.version,
          buyAmount: 300_000,
          sellAmount: 125_000,
          adjustmentReason: 'Bổ sung phí chi hộ theo ngày chứng từ',
        },
        { actorRole: 'ADMIN' },
      );
      const action = correction.governanceAction;
      assert.ok(action);
      ids.actions.push(action.id);
      const checked = await checkGovernanceAction({
        actionId: action.id,
        checkerId: accountantId,
        checkerRole: 'ACCOUNTANT',
        expectedVersion: action.version,
      });
      await approveGovernanceAction({
        actionId: action.id,
        approverId,
        approverRole: 'MANAGER',
        expectedVersion: checked.version,
      });

      const [fee] = await db.select().from(s.ledger).where(and(
        eq(s.ledger.txnType, TxnType.SERVICE_FEE),
        eq(s.ledger.txnId, expense.id),
      )).limit(1);
      assert.ok(fee);
      assert.equal(fee.originalDueDate, '2026-08-19');
      assert.equal(fee.processingDueDate, '2026-08-19');
      assert.equal(fee.paymentTermDaysApplied, 30);
    } finally {
      await db.update(s.trips).set({ status: 'IN_TRANSIT' }).where(eq(s.trips.id, tripId));
    }
  });

  test('office delete respects settlement links', async () => {
    const activeExpense = await insertExpense({ buyAmount: 110_000, sellAmount: 110_000 });
    await markCompleted(null);
    const activeRequestId = await insertApprovedRequest(110_000);
    const activeSettlement = await createAdvanceSettlement(forwarderId, {
      advanceRequestIds: [activeRequestId], tripExpenseIds: [activeExpense.id],
    });
    ids.settlements.push(activeSettlement.id);
    assert.deepEqual(await deleteTripExpenseGuarded(tripId, activeExpense.id), {
      error: 'Không thể xóa chi phí đã được thanh toán', status: 400,
    });
  });

  test('accountant update replaces links atomically and rejects an unbalanced replacement', async () => {
    const originalExpense = await insertExpense({ buyAmount: 100_000, sellAmount: 100_000 });
    const replacementExpense = await insertExpense({ buyAmount: 160_000, sellAmount: 160_000 });
    await markCompleted(null);
    const originalRequestId = await insertApprovedRequest(100_000);
    const replacementRequestId = await insertApprovedRequest(160_000);
    const settlement = await createAdvanceSettlement(forwarderId, {
      advanceRequestIds: [originalRequestId], tripExpenseIds: [originalExpense.id],
    });
    ids.settlements.push(settlement.id);

    const updated = await updateAdvanceSettlement(settlement.id, {
      advanceRequestIds: [replacementRequestId],
      tripExpenseIds: [replacementExpense.id],
      refundAmount: 0,
      note: 'Kế toán thay bộ chứng từ',
    });
    assert.deepEqual(updated.linkedRequests.map(item => item.id), [replacementRequestId]);
    assert.deepEqual(updated.linkedExpenses.map(item => item.id), [replacementExpense.id]);
    assert.equal(updated.totalExpenseAmount, '160000');
    assert.equal(updated.note, 'Kế toán thay bộ chứng từ');

    await assert.rejects(
      () => updateAdvanceSettlement(settlement.id, {
        advanceRequestIds: [replacementRequestId],
        tripExpenseIds: [originalExpense.id],
        refundAmount: 0,
      }),
      /Phiếu chưa cân đối/,
    );
    const afterRejectedUpdate = await getAdvanceSettlement(settlement.id);
    assert.deepEqual(afterRejectedUpdate?.linkedRequests.map(item => item.id), [replacementRequestId]);
    assert.deepEqual(afterRejectedUpdate?.linkedExpenses.map(item => item.id), [replacementExpense.id]);
    assert.equal(afterRejectedUpdate?.totalExpenseAmount, '160000');
    assert.equal(afterRejectedUpdate?.note, 'Kế toán thay bộ chứng từ');
  });

  test('legacy CHECKED_BY_ACCOUNTANT settlement can be finalized directly by a distinct approver', async () => {
    const expense = await insertExpense({ buyAmount: 180_000, sellAmount: 180_000 });
    await markCompleted(null);
    const legacyRequestId = await insertApprovedRequest(180_000);
    const settlement = await createAdvanceSettlement(forwarderId, {
      advanceRequestIds: [legacyRequestId], tripExpenseIds: [expense.id],
    });
    ids.settlements.push(settlement.id);
    await db.update(s.advanceSettlements).set({
      status: 'CHECKED_BY_ACCOUNTANT',
      checkedBy: accountantId,
      checkedAt: new Date(),
    }).where(eq(s.advanceSettlements.id, settlement.id));

    await approveAdvanceSettlement(settlement.id, approverId);
    const [saved] = await db.select().from(s.advanceSettlements)
      .where(eq(s.advanceSettlements.id, settlement.id));
    const ledgerRows = await db.select().from(s.ledger).where(and(
      eq(s.ledger.txnType, TxnType.FORWARDER_SETTLEMENT),
      eq(s.ledger.txnId, settlement.id),
    ));
    assert.equal(saved.status, 'APPROVED');
    assert.equal(saved.checkedBy, accountantId);
    assert.equal(saved.approvedBy, approverId);
    assert.equal(ledgerRows.length, 1);
    assert.equal(ledgerRows[0].debit, '180000');
  });

  test('late-approved customer service fee freezes its payment-date authority', async () => {
    const expense = await insertExpense({ buyAmount: 125_000, sellAmount: 145_000 });
    await markCompleted(null);
    await db.update(s.trips).set({ status: 'COMPLETED' }).where(eq(s.trips.id, tripId));
    const lateRequestId = await insertApprovedRequest(125_000);
    const settlement = await createAdvanceSettlement(forwarderId, {
      advanceRequestIds: [lateRequestId],
      tripExpenseIds: [expense.id],
    });
    ids.settlements.push(settlement.id);

    try {
      await checkAdvanceSettlement(settlement.id, accountantId);
      await approveAdvanceSettlement(settlement.id, approverId);
      const [feeRow] = await db.select().from(s.ledger).where(and(
        eq(s.ledger.txnType, TxnType.SERVICE_FEE),
        eq(s.ledger.txnId, expense.id),
      )).limit(1);
      assert.ok(feeRow);
      assert.equal(feeRow.originalDueDate, '2026-08-10');
      assert.equal(feeRow.processingDueDate, '2026-08-10');
      assert.equal(feeRow.paymentTermDaysApplied, 30);
      assert.equal(feeRow.paymentDatePolicyApplied, 'NEXT_BUSINESS_DAY');
    } finally {
      await db.update(s.trips).set({ status: 'IN_TRANSIT' }).where(eq(s.trips.id, tripId));
    }
  });

  test('accountant adjustment requires a linked pending settlement and recalculates its total', async () => {
    const expense = await insertExpense({ approvalStatus: 'APPROVED', buyAmount: 300_000 });
    const unrelated = await insertExpense({ approvalStatus: 'APPROVED', buyAmount: 50_000 });
    await markCompleted(null);
    const adjustmentRequestId = await insertApprovedRequest(275_000);
    const settlement = await createAdvanceSettlement(forwarderId, {
      advanceRequestIds: [adjustmentRequestId], tripExpenseIds: [expense.id],
    });
    ids.settlements.push(settlement.id);

    await assert.rejects(
      () => adjustSettlementExpense(settlement.id, unrelated.id, accountantId, { buyAmount: 10_000, adjustmentReason: 'Sai số tiền' }),
      /không thuộc phiếu hoàn ứng này/,
    );
    const adjusted = await adjustSettlementExpense(settlement.id, expense.id, accountantId, {
      buyAmount: 275_000,
      adjustmentReason: 'Đối chiếu lại hóa đơn',
    });
    assert.equal(adjusted.totalExpenseAmount, '275000');
    const [link] = await db.select().from(s.settlementExpenses).where(and(
      eq(s.settlementExpenses.settlementId, settlement.id), eq(s.settlementExpenses.tripExpenseId, expense.id),
    ));
    assert.equal(link.adjustmentReason, 'Đối chiếu lại hóa đơn');
    assert.equal(link.adjustedBy, accountantId);
    assert.equal(link.adjustedBuyAmount, '275000');
    const [originalExpense] = await db.select().from(s.tripExpenses)
      .where(eq(s.tripExpenses.id, expense.id));
    assert.equal(
      originalExpense.buyAmount,
      '300000',
      'approved source expense stays immutable; settlement link carries the adjustment',
    );

    await checkAdvanceSettlement(settlement.id, approverId);
    await approveAdvanceSettlement(settlement.id, secondApproverId);
    const governedCorrection = await adjustSettlementExpense(
      settlement.id,
      expense.id,
      accountantId,
      { buyAmount: 250_000, adjustmentReason: 'Điều chỉnh sau duyệt' },
      { actorRole: 'ACCOUNTANT' },
    );
    const governanceAction = governedCorrection.governanceAction;
    assert.ok(governanceAction);
    assert.equal(governanceAction.status, 'PENDING_CHECK');
    ids.actions.push(governanceAction.id);
  });

  test('fails closed when settlement approval encounters an expense with unknown maker', async () => {
    const legacyExpense = await insertExpense({
      approvalStatus: 'PENDING',
      buyAmount: 90_000,
      sellAmount: 90_000,
      createdBy: null,
    });
    await markCompleted(null);
    const legacyRequestId = await insertApprovedRequest(90_000);
    const settlement = await createAdvanceSettlement(forwarderId, {
      advanceRequestIds: [legacyRequestId],
      tripExpenseIds: [legacyExpense.id],
    });
    ids.settlements.push(settlement.id);
    await checkAdvanceSettlement(settlement.id, accountantId);
    await assert.rejects(
      () => approveAdvanceSettlement(settlement.id, approverId),
      /không xác định được người tạo|đối soát thủ công/,
    );
    const [unchanged] = await db.select().from(s.tripExpenses)
      .where(eq(s.tripExpenses.id, legacyExpense.id));
    assert.equal(unchanged.approvalStatus, 'PENDING');
  });

  test('keeps corrections append-only and exact across ordinary settlement update and approval', async () => {
    const expense = await insertExpense({
      approvalStatus: 'APPROVED',
      buyAmount: 300_000,
      sellAmount: 300_000,
    });
    await markCompleted(null);
    const correctedRequestId = await insertApprovedRequest(275_000);
    const settlement = await createAdvanceSettlement(forwarderId, {
      advanceRequestIds: [correctedRequestId],
      tripExpenseIds: [expense.id],
    });
    ids.settlements.push(settlement.id);
    await adjustSettlementExpense(settlement.id, expense.id, accountantId, {
      buyAmount: 280_000,
      adjustmentReason: 'Điều chỉnh lần một',
    });
    await adjustSettlementExpense(settlement.id, expense.id, accountantId, {
      buyAmount: 275_000,
      adjustmentReason: 'Điều chỉnh lần hai',
    });
    const [beforeUpdate] = await db.select().from(s.settlementExpenses).where(and(
      eq(s.settlementExpenses.settlementId, settlement.id),
      eq(s.settlementExpenses.tripExpenseId, expense.id),
    ));

    await updateAdvanceSettlement(settlement.id, {
      advanceRequestIds: [correctedRequestId],
      tripExpenseIds: [expense.id],
      refundAmount: 0,
      note: 'Giữ nguyên khoản đã điều chỉnh',
    });
    const [afterUpdate] = await db.select().from(s.settlementExpenses).where(and(
      eq(s.settlementExpenses.settlementId, settlement.id),
      eq(s.settlementExpenses.tripExpenseId, expense.id),
    ));
    assert.equal(afterUpdate.id, beforeUpdate.id, 'retained corrected link is updated in place');
    assert.equal(afterUpdate.adjustedBuyAmount, '275000');
    assert.equal(afterUpdate.adjustmentReason, 'Điều chỉnh lần hai');
    assert.equal(
      (afterUpdate.adjustedSnapshot as Record<string, unknown>).buyAmount,
      '275000',
    );
    const history = await db.select().from(s.settlementExpenseAdjustments)
      .where(eq(s.settlementExpenseAdjustments.settlementExpenseId, afterUpdate.id))
      .orderBy(s.settlementExpenseAdjustments.sequence);
    assert.equal(history.length, 2);
    assert.equal(history[0]!.sequence, 1);
    assert.equal(history[0]!.reason, 'Điều chỉnh lần một');
    assert.equal((history[0]!.beforeSnapshot as Record<string, unknown>).buyAmount, '300000');
    assert.equal((history[0]!.afterSnapshot as Record<string, unknown>).buyAmount, '280000');
    assert.equal(history[1]!.sequence, 2);
    assert.equal(history[1]!.reason, 'Điều chỉnh lần hai');
    assert.equal((history[1]!.beforeSnapshot as Record<string, unknown>).buyAmount, '280000');
    assert.equal((history[1]!.afterSnapshot as Record<string, unknown>).buyAmount, '275000');

    await db.update(s.trips).set({ status: 'COMPLETED' }).where(eq(s.trips.id, tripId));
    try {
      await checkAdvanceSettlement(settlement.id, approverId);
      await approveAdvanceSettlement(settlement.id, secondApproverId);
      const approvedHistory = await db.select().from(s.settlementExpenseAdjustments)
        .where(eq(s.settlementExpenseAdjustments.settlementExpenseId, afterUpdate.id));
      assert.ok(approvedHistory.every(row => row.approvedBy === secondApproverId && row.approvedAt));
      const [fee] = await db.select().from(s.ledger).where(and(
        eq(s.ledger.txnType, TxnType.SERVICE_FEE),
        eq(s.ledger.txnId, expense.id),
      )).limit(1);
      assert.equal(fee.debit, '275000');
    } finally {
      await db.update(s.trips).set({ status: 'IN_TRANSIT' }).where(eq(s.trips.id, tripId));
    }
  });

  test('forwarder edit enforces ownership and rejects expenses in an active settlement', async () => {
    const expense = await insertExpense({ approvalStatus: 'APPROVED' });
    await markCompleted(null);
    await assert.rejects(
      () => updateForwarderTripExpense(expense.id, otherForwarderId, { note: 'Không được phép' }),
      /Không có quyền sửa chi phí này/,
    );
    const editGuardRequestId = await insertApprovedRequest();
    const settlement = await createAdvanceSettlement(forwarderId, {
      advanceRequestIds: [editGuardRequestId], tripExpenseIds: [expense.id],
    });
    ids.settlements.push(settlement.id);
    await assert.rejects(
      () => updateForwarderTripExpense(expense.id, forwarderId, { note: 'Đã gửi KT' }),
      /Chi phí đã gửi kế toán, không thể sửa/,
    );
  });

  test('forwarder edit clears nullable fields but preserves required-field invariants', async () => {
    const expense = await insertExpense();
    await db.update(s.tripExpenses).set({
      invoiceNumber: '1664',
      note: 'Thông tin cũ',
    }).where(eq(s.tripExpenses.id, expense.id));

    const amountOnly = await updateForwarderTripExpense(expense.id, forwarderId, {
      buyAmount: '1700000',
    });
    assert.equal(amountOnly?.invoiceNumber, '1664');
    assert.equal(amountOnly?.note, 'Thông tin cũ');

    const updated = await updateForwarderTripExpense(expense.id, forwarderId, {
      buyAmount: '1782000',
      supplierId: null,
      invoiceNumber: null,
      expenseDate: '2026-07-11',
      payeeName: 'Cảng thử nghiệm',
      note: 'Biên nhận thay thế hóa đơn',
      noInvoiceEvidenceTypes: ['RECEIPT'],
    });
    assert.equal(updated?.buyAmount, '1782000');
    assert.equal(updated?.supplierId, null);
    assert.equal(updated?.invoiceNumber, null);
    assert.equal(updated?.note, 'Biên nhận thay thế hóa đơn');

    await assert.rejects(
      () => updateForwarderTripExpense(expense.id, forwarderId, {
        note: null,
        noInvoiceEvidenceTypes: [],
      }),
      /Lý do chi là bắt buộc/,
    );

    await db.update(s.tripExpenses).set({
      expenseType: 'CUSTOMS',
      declarationNumber: 'TK-3509',
    }).where(eq(s.tripExpenses.id, expense.id));
    await assert.rejects(
      () => updateForwarderTripExpense(expense.id, forwarderId, { declarationNumber: null }),
      /Số tờ khai là bắt buộc cho phí hải quan/,
    );
  });
});
