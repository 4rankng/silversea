import { tripExpenseServiceLedgerCondition, tripExpenseServiceReceiptId } from './trip-expense-ledger-source';
/**
 * Advance settlement corrections — accountant expense adjustment, reversal
 * governance, and rejection. Split from advance.service.ts; re-exported
 * through the advance.service facade.
 */
import { db } from '../db';
import { runInTx } from '../lib/tx';
import * as s from '../db/schema';
import { eq, and, desc, inArray, sql } from 'drizzle-orm';
import { NotificationType, TxnType, round2dp } from '@tingting/shared';
import { LedgerService } from './ledger.service';
import { emitNotification } from './notification.service';
import { AdvanceError } from './settlement-validation';
import type { Tx } from './trip-shared';
import { getTripExpenseRequiredFieldError } from './forwarder.service';
import {
  resolveCustomerPaymentDueDate,
  type PaymentDatePolicy,
} from './business-calendar.service';
import { assertCanMakeGovernanceAction } from './governance-policy';
import {
  applyGovernanceActionDirect,
  buildGovernanceAction,
} from './governance-action-core.service';
import type { GovernanceApplyResult, GovernanceActionRow } from './governance-action-core.service';
import {
  assertExpectedVersion,
  enrichSettlementWithRequests,
  enrichWithNames,
} from './advance-shared.service';

export async function adjustSettlementExpense(
  settlementId: number,
  expenseId: number,
  actorId: number,
  patch: {
    expectedVersion?: number;
    expenseType?: string;
    buyAmount?: number;
    sellAmount?: number;
    supplierId?: number | null;
    invoiceNumber?: string | null;
    invoiceDate?: string | null;
    declarationNumber?: string | null;
    containerNumber?: string | null;
    tripContainerId?: number | null;
    note?: string | null;
    adjustmentReason: string;
  },
  options: { transaction?: Tx; emitNotification?: boolean; actorRole?: string } = {},
) {
  const reason = patch.adjustmentReason.trim();
  if (!reason) {
    throw new AdvanceError(400, 'Lý do điều chỉnh là bắt buộc');
  }
  const execute = async (tx: Tx) => {
    const [settlement] = await tx.select().from(s.advanceSettlements)
      .where(eq(s.advanceSettlements.id, settlementId)).for('update');
    if (!settlement) throw new AdvanceError(404, 'Không tìm thấy phiếu hoàn ứng');
    const version = patch.expectedVersion ?? settlement.version;
    assertExpectedVersion(settlement.version, version, 'Phiếu hoàn ứng');
    if (settlement.status !== 'RECORDED') {
      throw new AdvanceError(409, 'Chỉ được điều chỉnh phiếu đã ghi nhận');
    }
    await tx.execute(sql`SELECT pg_advisory_xact_lock(6102, ${expenseId})`);
    const [linked] = await tx.select({
      linkId: s.settlementExpenses.id,
      expenseId: s.tripExpenses.id,
      tripId: s.tripExpenses.tripId,
      expenseType: s.tripExpenses.expenseType,
      buyAmount: s.tripExpenses.buyAmount,
      sellAmount: s.tripExpenses.sellAmount,
      supplierId: s.tripExpenses.supplierId,
      invoiceNumber: s.tripExpenses.invoiceNumber,
      invoiceDate: s.tripExpenses.invoiceDate,
      declarationNumber: s.tripExpenses.declarationNumber,
      containerNumber: s.tripExpenses.containerNumber,
      tripContainerId: s.tripExpenses.tripContainerId,
      note: s.tripExpenses.note,
      adjustedSnapshot: s.settlementExpenses.adjustedSnapshot,
    }).from(s.settlementExpenses)
      .innerJoin(s.tripExpenses, eq(s.tripExpenses.id, s.settlementExpenses.tripExpenseId))
      .where(and(
        eq(s.settlementExpenses.settlementId, settlementId),
        eq(s.settlementExpenses.tripExpenseId, expenseId),
      )).limit(1);
    if (!linked) throw new AdvanceError(404, 'Khoản chi không thuộc phiếu hoàn ứng này');

    const [trip] = await tx.select({ status: s.trips.status }).from(s.trips)
      .where(eq(s.trips.id, linked.tripId)).limit(1);

    const currentSnapshot: Record<string, unknown> = {
      expenseType: linked.expenseType,
      buyAmount: linked.buyAmount,
      sellAmount: linked.sellAmount,
      supplierId: linked.supplierId,
      invoiceNumber: linked.invoiceNumber,
      invoiceDate: linked.invoiceDate,
      declarationNumber: linked.declarationNumber,
      containerNumber: linked.containerNumber,
      tripContainerId: linked.tripContainerId,
      note: linked.note,
      ...linked.adjustedSnapshot as Record<string, unknown>,
    };
    const requiredFieldError = getTripExpenseRequiredFieldError({
      expenseType: String(patch.expenseType ?? currentSnapshot.expenseType),
      declarationNumber: patch.declarationNumber === undefined
        ? currentSnapshot.declarationNumber as string | null
        : patch.declarationNumber,
    });
    if (requiredFieldError) throw new AdvanceError(400, requiredFieldError);

    const {
      adjustmentReason: _adjustmentReason,
      expectedVersion: _expectedVersion,
      ...expensePatch
    } = patch;
    void _adjustmentReason;
    void _expectedVersion;
    const values: Record<string, unknown> = {
      ...currentSnapshot,
      ...expensePatch,
    };
    if (expensePatch.buyAmount !== undefined) values.buyAmount = String(expensePatch.buyAmount);
    if (expensePatch.sellAmount !== undefined) values.sellAmount = String(expensePatch.sellAmount);
    if (expensePatch.buyAmount !== undefined && expensePatch.sellAmount === undefined) {
      const effectiveType = expensePatch.expenseType ?? String(currentSnapshot.expenseType);
      const [typeConfig] = await tx.select({ defaultMarkup: s.forwarderExpenseTypes.defaultMarkup })
        .from(s.forwarderExpenseTypes).where(eq(s.forwarderExpenseTypes.code, effectiveType)).limit(1);
      if (!typeConfig?.defaultMarkup) values.sellAmount = String(expensePatch.buyAmount);
    }
    if (expensePatch.tripContainerId !== undefined) {
      if (expensePatch.tripContainerId == null) {
        values.tripContainerId = null;
        values.containerNumber = null;
      } else {
        const [container] = await tx.select({ tripId: s.tripContainers.tripId, number: s.tripContainers.containerNumber })
          .from(s.tripContainers).where(eq(s.tripContainers.id, expensePatch.tripContainerId)).limit(1);
        if (!container || container.tripId !== linked.tripId) {
          throw new AdvanceError(400, 'Container không thuộc chuyến này');
        }
        values.containerNumber = container.number;
      }
    }
    if (!options.actorRole) {
      throw new AdvanceError(403, 'Thiếu vai trò người tạo điều chỉnh');
    }
    assertCanMakeGovernanceAction('ADVANCE_SETTLEMENT_CORRECTION', options.actorRole);
    const oldBuyAmount = Number(currentSnapshot.buyAmount ?? 0);
    const newBuyAmount = Number(values.buyAmount ?? oldBuyAmount);
    const correctedRefundAmount = round2dp(
      Number(settlement.refundAmount) - (newBuyAmount - oldBuyAmount),
    );
    if (correctedRefundAmount < 0) {
      throw new AdvanceError(
        400,
        'Điều chỉnh làm số hoàn lại âm; cần hoàn tác phiếu và lập phiếu mới',
      );
    }
    const action = buildGovernanceAction({
      subjectType: 'ADVANCE_SETTLEMENT',
      subjectId: settlement.id,
      subjectKey: `advance-settlement:${settlement.id}:expense:${expenseId}`,
      actionKind: 'ADVANCE_SETTLEMENT_CORRECTION',
      reason,
      originalVersion: settlement.version,
      beforeSnapshot: {
        settlementStatus: settlement.status,
        settlementVersion: settlement.version,
        settlementExpenseId: linked.linkId,
        tripExpenseId: linked.expenseId,
        totalExpenseAmount: settlement.totalExpenseAmount,
        expense: currentSnapshot,
      },
      afterSnapshot: {
        expense: values,
        refundAmount: String(correctedRefundAmount),
      },
      deltaSnapshot: {
        oldBuyAmount: String(oldBuyAmount),
        newBuyAmount: String(newBuyAmount),
        oldRefundAmount: settlement.refundAmount,
        newRefundAmount: String(correctedRefundAmount),
        oldSellAmount: String(currentSnapshot.sellAmount ?? 0),
        newSellAmount: String(values.sellAmount ?? 0),
      },
      makerId: actorId,
      makerRole: options.actorRole,
    });
    const { action: applied } = await applyGovernanceActionDirect({
      action,
      actorId,
      actorRole: options.actorRole,
      apply: applyAdvanceSettlementGovernanceAction,
      transaction: tx,
    });
    return {
      item: {
        id: linked.expenseId,
        tripId: linked.tripId,
        ...currentSnapshot,
      },
      governanceAction: applied,
      totalExpenseAmount: settlement.totalExpenseAmount,
      settlementCode: settlement.code,
      forwarderId: settlement.forwarderId,
      adjustmentReason: reason,
    };
  };
  const result = options.transaction
    ? await execute(options.transaction)
    : await db.transaction(execute);
  if (options.emitNotification !== false) {
    emitNotification({
      type: NotificationType.SYSTEM_ANNOUNCEMENT,
      title: 'Kế toán đã điều chỉnh phiếu hoàn ứng',
      message: `Phiếu ${result.settlementCode}: ${result.adjustmentReason}.`,
      relatedEntityType: 'advance_settlements',
      relatedEntityId: settlementId,
      targetUserId: result.forwarderId,
      targetRoles: [],
    });
  }
  return {
    item: result.item,
    totalExpenseAmount: result.totalExpenseAmount,
    governanceAction: 'governanceAction' in result ? result.governanceAction : null,
  };
}

export async function requestAdvanceSettlementReversal(input: {
  settlementId: number;
  expectedVersion: number;
  reason: string;
  makerId: number;
  makerRole: string;
  transaction?: Tx;
}): Promise<GovernanceActionRow> {
  assertCanMakeGovernanceAction('ADVANCE_SETTLEMENT_REVERSAL', input.makerRole);
  const reason = input.reason.trim();
  if (!reason) throw new AdvanceError(400, 'Lý do hoàn tác là bắt buộc');

  const execute = async (tx: Tx) => {
    const [settlement] = await tx.select().from(s.advanceSettlements)
      .where(eq(s.advanceSettlements.id, input.settlementId))
      .limit(1)
      .for('update');
    if (!settlement) throw new AdvanceError(404, 'Không tìm thấy phiếu hoàn ứng');
    assertExpectedVersion(settlement.version, input.expectedVersion, 'Phiếu hoàn ứng');
    if (settlement.status !== 'RECORDED') {
      throw new AdvanceError(409, 'Chỉ phiếu đã ghi nhận mới được hoàn tác');
    }
    return buildGovernanceAction({
      subjectType: 'ADVANCE_SETTLEMENT',
      subjectId: settlement.id,
      subjectKey: `advance-settlement:${settlement.id}:reverse`,
      actionKind: 'ADVANCE_SETTLEMENT_REVERSAL',
      reason,
      originalVersion: settlement.version,
      beforeSnapshot: {
        status: settlement.status,
        version: settlement.version,
        totalExpenseAmount: settlement.totalExpenseAmount,
        refundAmount: settlement.refundAmount,
      },
      afterSnapshot: { status: 'REVERSED' },
      deltaSnapshot: {
        reversalAmount: String(
          round2dp(Number(settlement.totalExpenseAmount) + Number(settlement.refundAmount)),
        ),
      },
      makerId: input.makerId,
      makerRole: input.makerRole,
    });
  };

  return runInTx(input.transaction, execute);
}

async function applyApprovedSettlementCorrection(
  tx: Tx,
  action: GovernanceActionRow,
): Promise<GovernanceApplyResult> {
  const before = action.beforeSnapshot as Record<string, unknown>;
  const after = action.afterSnapshot as Record<string, unknown>;
  const expense = after.expense as Record<string, unknown> | undefined;
  const settlementExpenseId = Number(before.settlementExpenseId);
  const tripExpenseId = Number(before.tripExpenseId);
  if (!expense || !Number.isInteger(settlementExpenseId) || !Number.isInteger(tripExpenseId)) {
    throw new AdvanceError(409, 'Dữ liệu điều chỉnh phiếu hoàn ứng không hợp lệ');
  }

  const [settlement] = await tx.select().from(s.advanceSettlements)
    .where(eq(s.advanceSettlements.id, action.subjectId!))
    .limit(1)
    .for('update');
  if (!settlement) throw new AdvanceError(404, 'Không tìm thấy phiếu hoàn ứng');
  assertExpectedVersion(settlement.version, action.originalVersion!, 'Phiếu hoàn ứng');
  if (settlement.status !== 'RECORDED') {
    throw new AdvanceError(409, 'Phiếu hoàn ứng không còn ở trạng thái đã ghi nhận');
  }

  const [linked] = await tx.select({
    id: s.settlementExpenses.id,
    adjustedBuyAmount: s.settlementExpenses.adjustedBuyAmount,
    adjustedSnapshot: s.settlementExpenses.adjustedSnapshot,
    tripId: s.tripExpenses.tripId,
    sellAmount: s.tripExpenses.sellAmount,
    expenseDate: s.tripExpenses.expenseDate,
    customerId: s.trips.customerId,
    tripCode: s.trips.tripCode,
    tripStatus: s.trips.status,
  }).from(s.settlementExpenses)
    .innerJoin(s.tripExpenses, eq(s.tripExpenses.id, s.settlementExpenses.tripExpenseId))
    .innerJoin(s.trips, eq(s.trips.id, s.tripExpenses.tripId))
    .where(and(
      eq(s.settlementExpenses.id, settlementExpenseId),
      eq(s.settlementExpenses.settlementId, settlement.id),
      eq(s.settlementExpenses.tripExpenseId, tripExpenseId),
    ))
    .limit(1);
  if (!linked) throw new AdvanceError(404, 'Khoản chi không thuộc phiếu hoàn ứng này');

  const oldBuyAmount = Number(linked.adjustedBuyAmount);
  const newBuyAmount = Number(expense.buyAmount ?? oldBuyAmount);
  const oldSnapshot = linked.adjustedSnapshot as Record<string, unknown>;
  const oldSellAmount = Number(oldSnapshot.sellAmount ?? linked.sellAmount);
  const newSellAmount = Number(expense.sellAmount ?? oldSellAmount);
  const newRefundAmount = Number(after.refundAmount);
  if (![newBuyAmount, newSellAmount, newRefundAmount].every(Number.isFinite) || newRefundAmount < 0) {
    throw new AdvanceError(400, 'Số tiền điều chỉnh không hợp lệ');
  }
  const buyDelta = round2dp(newBuyAmount - oldBuyAmount);
  const now = action.approvedAt ?? new Date();
  const [latestAdjustment] = await tx.select({
    sequence: s.settlementExpenseAdjustments.sequence,
  }).from(s.settlementExpenseAdjustments)
    .where(eq(s.settlementExpenseAdjustments.settlementExpenseId, linked.id))
    .orderBy(desc(s.settlementExpenseAdjustments.sequence))
    .limit(1);
  const nextSequence = (latestAdjustment?.sequence ?? 0) + 1;
  await tx.insert(s.settlementExpenseAdjustments).values({
    settlementId: settlement.id,
    settlementExpenseId: linked.id,
    tripExpenseId,
    sequence: nextSequence,
    sourceVersion: nextSequence,
    beforeSnapshot: oldSnapshot,
    afterSnapshot: expense,
    reason: action.reason!,
    adjustedBy: action.makerId,
    adjustedAt: action.createdAt,
    approvedBy: action.approverId,
    approvedAt: now,
  });
  await tx.update(s.settlementExpenses).set({
    adjustmentReason: action.reason,
    adjustedBuyAmount: String(newBuyAmount),
    adjustedSnapshot: expense,
    adjustedBy: action.makerId,
    adjustedAt: action.createdAt,
  }).where(eq(s.settlementExpenses.id, linked.id));

  const newTotalExpenseAmount = round2dp(Number(settlement.totalExpenseAmount) + buyDelta);
  const [updated] = await tx.update(s.advanceSettlements).set({
    totalExpenseAmount: String(newTotalExpenseAmount),
    refundAmount: String(newRefundAmount),
    updatedAt: now,
    version: sql`${s.advanceSettlements.version} + 1`,
  }).where(and(
    eq(s.advanceSettlements.id, settlement.id),
    eq(s.advanceSettlements.status, 'RECORDED'),
    eq(s.advanceSettlements.version, action.originalVersion!),
  )).returning({ id: s.advanceSettlements.id, version: s.advanceSettlements.version });
  if (!updated) throw new AdvanceError(409, 'Phiếu hoàn ứng đã được tác vụ khác cập nhật');

  const originalBalancedTotal = round2dp(
    Number(settlement.totalExpenseAmount) + Number(settlement.refundAmount),
  );
  const correctedBalancedTotal = round2dp(newTotalExpenseAmount + newRefundAmount);
  if (correctedBalancedTotal !== originalBalancedTotal) {
    throw new AdvanceError(409, 'Điều chỉnh làm phiếu hoàn ứng mất cân đối');
  }

  if (
    newSellAmount !== oldSellAmount
    && linked.tripStatus === 'COMPLETED'
  ) {
    const existingRows = await tx.select({
      id: s.ledger.id,
      debit: s.ledger.debit,
      credit: s.ledger.credit,
      originalDueDate: s.ledger.originalDueDate,
      processingDueDate: s.ledger.processingDueDate,
      paymentTermDaysApplied: s.ledger.paymentTermDaysApplied,
      paymentDatePolicyApplied: s.ledger.paymentDatePolicyApplied,
    }).from(s.ledger)
      .where(tripExpenseServiceLedgerCondition(tripExpenseId, linked.customerId));
    const posted = existingRows.reduce(
      (sum, row) => sum + Number(row.debit) - Number(row.credit),
      0,
    );
    const sellDelta = round2dp(newSellAmount - posted);
    if (sellDelta !== 0) {
      const existingAuthority = [...existingRows]
        .sort((left, right) => right.id - left.id)
        .find((row) => row.originalDueDate && row.processingDueDate);
      const resolvedAuthority = existingAuthority
        ? null
        : await resolveCustomerPaymentDueDate(
            tx,
            linked.customerId,
            String(linked.expenseDate).slice(0, 10),
          );
      await LedgerService.postEntry(tx, {
        txnType: existingRows.length === 0 ? TxnType.SERVICE_FEE : TxnType.ADJUSTMENT,
        txnId: tripExpenseId,
        receiptId: tripExpenseServiceReceiptId(tripExpenseId),
        entityType: 'CUSTOMER',
        entityId: linked.customerId,
        debit: sellDelta > 0 ? sellDelta : 0,
        credit: sellDelta < 0 ? Math.abs(sellDelta) : 0,
        note: `Điều chỉnh phí chi hộ chuyến ${linked.tripCode ?? ''}`.trim(),
        originalDueDate: existingAuthority?.originalDueDate ?? resolvedAuthority!.originalDate,
        processingDueDate: existingAuthority?.processingDueDate ?? resolvedAuthority!.processingDate,
        paymentTermDaysApplied:
          existingAuthority?.paymentTermDaysApplied ?? resolvedAuthority!.paymentTermDays,
        paymentDatePolicyApplied:
          (existingAuthority?.paymentDatePolicyApplied as PaymentDatePolicy | null | undefined)
          ?? resolvedAuthority!.policy,
      });
    }
  }

  return {
    applicationResult: {
      settlementId: settlement.id,
      tripExpenseId,
      totalExpenseAmount: String(newTotalExpenseAmount),
      refundAmount: String(newRefundAmount),
      resultingVersion: updated.version,
    },
  };
}

async function applyApprovedSettlementReversal(
  tx: Tx,
  action: GovernanceActionRow,
): Promise<GovernanceApplyResult> {
  const [settlement] = await tx.select().from(s.advanceSettlements)
    .where(eq(s.advanceSettlements.id, action.subjectId!))
    .limit(1)
    .for('update');
  if (!settlement) throw new AdvanceError(404, 'Không tìm thấy phiếu hoàn ứng');
  assertExpectedVersion(settlement.version, action.originalVersion!, 'Phiếu hoàn ứng');
  if (settlement.status !== 'RECORDED') {
    throw new AdvanceError(409, 'Phiếu hoàn ứng không còn ở trạng thái đã ghi nhận');
  }
  const now = action.approvedAt ?? new Date();
  const reversalAmount = round2dp(
    Number(settlement.totalExpenseAmount) + Number(settlement.refundAmount),
  );
  const reversalEntry = await LedgerService.postEntry(tx, {
    txnType: TxnType.ADJUSTMENT,
    txnId: settlement.id,
    entityType: 'FORWARDER',
    entityId: settlement.forwarderId,
    debit: 0,
    credit: reversalAmount,
    note: `Hoàn tác phiếu hoàn ứng ${settlement.code}: ${action.reason}`,
  });
  const [updated] = await tx.update(s.advanceSettlements).set({
    status: 'REVERSED',
    updatedAt: now,
    version: sql`${s.advanceSettlements.version} + 1`,
  }).where(and(
    eq(s.advanceSettlements.id, settlement.id),
    eq(s.advanceSettlements.status, 'RECORDED'),
    eq(s.advanceSettlements.version, action.originalVersion!),
  )).returning({ version: s.advanceSettlements.version });
  if (!updated) throw new AdvanceError(409, 'Phiếu hoàn ứng đã được tác vụ khác cập nhật');
  return {
    ledgerEntryId: reversalEntry.id,
    applicationResult: {
      settlementId: settlement.id,
      status: 'REVERSED',
      reversalAmount: String(reversalAmount),
      resultingVersion: updated.version,
    },
  };
}

export async function applyAdvanceSettlementGovernanceAction(
  tx: Tx,
  action: GovernanceActionRow,
): Promise<GovernanceApplyResult> {
  if (
    action.subjectType !== 'ADVANCE_SETTLEMENT'
    || action.subjectId == null
    || action.approverId == null
  ) {
    throw new AdvanceError(409, 'Yêu cầu không thuộc điều chỉnh phiếu hoàn ứng');
  }
  if (action.actionKind === 'ADVANCE_SETTLEMENT_CORRECTION') {
    return applyApprovedSettlementCorrection(tx, action);
  }
  if (action.actionKind === 'ADVANCE_SETTLEMENT_REVERSAL') {
    return applyApprovedSettlementReversal(tx, action);
  }
  throw new AdvanceError(409, 'Loại điều chỉnh phiếu hoàn ứng không hợp lệ');
}
