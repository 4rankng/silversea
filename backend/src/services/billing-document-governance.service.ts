import { and, eq, isNull } from 'drizzle-orm';
import { TxnType } from '@tingting/shared';
import { db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import { LedgerService } from './ledger.service';
import type { Tx } from './trip-shared';
import {
  buildExpenseSourceVersionToken,
  buildTripSourceVersionToken,
} from './billingDocument.service';
import { assertCanMakeGovernanceAction } from './governance-policy';
import type { GovernanceActionRow, GovernanceApplyResult } from './governance-transition.service';
import type { PaymentDatePolicy } from './business-calendar.service';

type SourceDiff = {
  lineId: number;
  sourceType: 'TRIP' | 'EXPENSE';
  sourceId: number;
  previousVersion: string | null;
  currentVersion: string | null;
  previousBaseAmount: number;
  currentBaseAmount: number;
  adjustmentAmount: number;
  reason: string;
};

async function loadCurrentTripSource(tx: Tx, tripId: number): Promise<{
  version: string | null;
  baseAmount: number;
} | null> {
  const [trip] = await tx.select({
    id: s.trips.id,
    version: s.trips.version,
    revenue: s.trips.revenue,
  })
    .from(s.trips)
    .where(and(eq(s.trips.id, tripId), isNull(s.trips.deletedAt)))
    .limit(1);
  if (!trip) return null;
  return {
    version: buildTripSourceVersionToken(trip.version),
    baseAmount: Number(trip.revenue ?? 0),
  };
}

async function loadCurrentExpenseSource(tx: Tx, expenseId: number): Promise<{
  version: string | null;
  baseAmount: number;
} | null> {
  const [expense] = await tx.select({
    id: s.tripExpenses.id,
    approvalStatus: s.tripExpenses.approvalStatus,
    sellAmount: s.tripExpenses.sellAmount,
    updatedAt: s.tripExpenses.updatedAt,
  })
    .from(s.tripExpenses)
    .where(eq(s.tripExpenses.id, expenseId))
    .limit(1);
  if (!expense) return null;
  return {
    version: expense.approvalStatus === 'APPROVED'
      ? buildExpenseSourceVersionToken(expense)
      : null,
    baseAmount: expense.approvalStatus === 'APPROVED' ? Number(expense.sellAmount ?? 0) : 0,
  };
}

async function buildSourceDiffs(tx: Tx, documentId: number): Promise<SourceDiff[]> {
  const lines = await tx.select()
    .from(s.billingDocumentLines)
    .where(eq(s.billingDocumentLines.documentId, documentId));
  const diffs: SourceDiff[] = [];

  for (const line of lines) {
    if ((line.sourceType !== 'TRIP' && line.sourceType !== 'EXPENSE') || line.sourceId == null) {
      continue;
    }
    const previousVersion = typeof (line.renderData as Record<string, unknown> | null)?.sourceVersion === 'string'
      ? String((line.renderData as Record<string, unknown>).sourceVersion)
      : null;
    const current = line.sourceType === 'TRIP'
      ? await loadCurrentTripSource(tx, line.sourceId)
      : await loadCurrentExpenseSource(tx, line.sourceId);
    const currentVersion = current?.version ?? null;
    const currentBaseAmount = current?.baseAmount ?? 0;
    const previousBaseAmount = Number(line.baseAmount ?? 0);
    const originalEffective = line.excluded
      ? 0
      : line.amountOverride != null
        ? Number(line.amountOverride)
        : previousBaseAmount;
    const currentEffective = line.excluded
      ? 0
      : line.amountOverride != null
        ? Number(line.amountOverride)
        : currentBaseAmount;
    const adjustmentAmount = currentEffective - originalEffective;

    if (previousVersion === currentVersion && adjustmentAmount === 0) {
      continue;
    }

    diffs.push({
      lineId: line.id,
      sourceType: line.sourceType as SourceDiff['sourceType'],
      sourceId: line.sourceId,
      previousVersion,
      currentVersion,
      previousBaseAmount,
      currentBaseAmount,
      adjustmentAmount,
      reason: currentVersion == null
        ? 'Nguồn đã bị xóa hoặc không còn hợp lệ'
        : 'Nguồn đã thay đổi sau khi phát hành giấy báo nợ',
    });
  }

  return diffs;
}

export async function requestBillingDocumentAdjustment(input: {
  documentId: number;
  reason: string;
  makerId: number;
  makerRole: string;
}) {
  assertCanMakeGovernanceAction('DEBIT_NOTE_ADJUSTMENT', input.makerRole);
  const normalizedReason = input.reason.trim();
  if (!normalizedReason) {
    throw new ApiError(400, 'Lý do điều chỉnh là bắt buộc');
  }

  return db.transaction(async (tx) => {
    const [document] = await tx.select()
      .from(s.billingDocuments)
      .where(and(eq(s.billingDocuments.id, input.documentId), isNull(s.billingDocuments.deletedAt)))
      .limit(1)
      .for('update');
    if (!document) throw new ApiError(404, 'Không tìm thấy giấy báo nợ');
    if (document.type !== 'DEBIT_NOTE' || document.entityType !== 'CUSTOMER') {
      throw new ApiError(409, 'Chỉ giấy báo nợ khách hàng mới hỗ trợ điều chỉnh nguồn');
    }
    if ((document.debitNoteStatus ?? 'DRAFT') === 'DRAFT') {
      throw new ApiError(409, 'Giấy báo nợ nháp phải được cập nhật trực tiếp, không tạo điều chỉnh');
    }

    const sourceDiffs = await buildSourceDiffs(tx, document.id);
    const adjustmentAmount = sourceDiffs.reduce((sum, diff) => sum + diff.adjustmentAmount, 0);
    if (sourceDiffs.length === 0 || adjustmentAmount === 0) {
      throw new ApiError(409, 'Không có chênh lệch nguồn cần lập điều chỉnh');
    }

    const [action] = await tx.insert(s.governanceActions).values({
      subjectType: 'BILLING_DOCUMENT',
      subjectId: document.id,
      actionKind: 'DEBIT_NOTE_ADJUSTMENT',
      reason: normalizedReason,
      originalVersion: Math.floor(document.updatedAt.getTime() / 1000),
      beforeSnapshot: {
        originalDocumentId: document.id,
        debitNoteStatus: document.debitNoteStatus ?? 'DRAFT',
        totalInclVat: Number(document.totalInclVat ?? 0),
      },
      afterSnapshot: {
        originalDocumentId: document.id,
        resultingTotalInclVat: Number(document.totalInclVat ?? 0) + adjustmentAmount,
      },
      deltaSnapshot: {
        originalDocumentId: document.id,
        adjustmentAmount,
        sourceDiffs,
      },
      makerId: input.makerId,
      makerRole: input.makerRole,
    }).returning();
    return action;
  });
}

export async function applyBillingDocumentGovernanceAction(
  tx: Tx,
  action: GovernanceActionRow,
): Promise<GovernanceApplyResult> {
  if (action.subjectType !== 'BILLING_DOCUMENT' || action.subjectId == null || action.actionKind !== 'DEBIT_NOTE_ADJUSTMENT') {
    throw new ApiError(409, 'Yêu cầu điều chỉnh không thuộc giấy báo nợ');
  }
  const [document] = await tx.select()
    .from(s.billingDocuments)
    .where(and(eq(s.billingDocuments.id, action.subjectId), isNull(s.billingDocuments.deletedAt)))
    .limit(1)
    .for('update');
  if (!document) throw new ApiError(404, 'Không tìm thấy giấy báo nợ gốc');
  if ((document.debitNoteStatus ?? 'DRAFT') === 'DRAFT') {
    throw new ApiError(409, 'Giấy báo nợ gốc đã quay về nháp; yêu cầu điều chỉnh không còn hợp lệ');
  }

  const delta = action.deltaSnapshot as Record<string, unknown> | null;
  const adjustmentAmount = Number(delta?.adjustmentAmount ?? 0);
  const sourceDiffs = Array.isArray(delta?.sourceDiffs) ? delta?.sourceDiffs : [];
  if (!Number.isFinite(adjustmentAmount) || adjustmentAmount === 0 || sourceDiffs.length === 0) {
    throw new ApiError(409, 'Yêu cầu điều chỉnh thiếu dữ liệu áp dụng hợp lệ');
  }

  const ledgerEntry = await LedgerService.postEntry(tx, {
    txnType: TxnType.ADJUSTMENT,
    txnId: document.id,
    receiptId: `GBN-ADJ:${action.id}`,
    entityType: 'CUSTOMER',
    entityId: document.entityId,
    debit: adjustmentAmount > 0 ? adjustmentAmount : 0,
    credit: adjustmentAmount < 0 ? Math.abs(adjustmentAmount) : 0,
    note: `Điều chỉnh giấy báo nợ #${document.id}: ${action.reason}`,
    originalDueDate: document.originalDueDate,
    processingDueDate: document.processingDueDate,
    paymentTermDaysApplied: document.paymentTermDaysApplied,
    paymentDatePolicyApplied: document.paymentDatePolicyApplied as PaymentDatePolicy | null,
  });

  return {
    ledgerEntryId: ledgerEntry.id,
    applicationResult: {
      originalDocumentId: document.id,
      adjustmentAmount,
      resultingTotalInclVat: Number(document.totalInclVat ?? 0) + adjustmentAmount,
      sourceDiffCount: sourceDiffs.length,
    },
  };
}
