import { and, eq, inArray, isNull } from 'drizzle-orm';
import { TxnType } from '@tingting/shared';
import { runInTx } from '../lib/tx';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import { LedgerService } from './ledger.service';
import type { Tx } from './trip-shared';
import {
  assertRecoverableSourcesClaimable,
  buildExpenseSourceVersionToken,
  postingChecksum,
  postDebitNoteDelta,
} from './billing-document.service';
import { transitionDebitNoteStatus } from './debit-note-lifecycle.service';
import { assertCanMakeGovernanceAction } from './governance-policy';
import {
  buildGovernanceAction,
  type GovernanceActionRow,
  type GovernanceApplyResult,
} from './governance-action-core.service';
import type { PaymentDatePolicy } from './business-calendar.service';
import { lockTripFinancialAuthority } from './trip-financial-authority-lock.service';
import {
  assertDebitNotePeriodWritable,
  getClosedPeriodLock,
  resolveDebitNotePeriodAuthority,
} from './period-lock.service';

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

type BillingDocumentLineRow = typeof s.billingDocumentLines.$inferSelect;

type BillingDocumentSourceSnapshot = {
  lineId: number;
  sourceType: 'TRIP' | 'EXPENSE';
  sourceId: number;
  sourceVersion: string | null;
  sourceChangedAt: string | null;
  baseAmount: number;
  financialPostingId: number | null;
  financialPostingVersion: number | null;
  postingChecksum: string | null;
};

function billingDocumentVersion(document: Pick<typeof s.billingDocuments.$inferSelect, 'version'>): number {
  return document.version;
}

function renderDataRecord(line: BillingDocumentLineRow): Record<string, unknown> | null {
  return (line.renderData as Record<string, unknown> | null) ?? null;
}

function renderSourceVersion(line: BillingDocumentLineRow): string | null {
  const raw = renderDataRecord(line)?.sourceVersion;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

function renderSourceChangedAt(line: BillingDocumentLineRow): string | null {
  const raw = renderDataRecord(line)?.sourceChangedAt;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

function tripSourceIds(lines: readonly BillingDocumentLineRow[]): number[] {
  return [...new Set(lines
    .filter((line) => line.sourceType === 'TRIP' && line.sourceId != null)
    .map((line) => line.sourceId as number))]
    .sort((left, right) => left - right);
}

function expenseSourceIds(lines: readonly BillingDocumentLineRow[]): number[] {
  return [...new Set(lines
    .filter((line) => line.sourceType === 'EXPENSE' && line.sourceId != null)
    .map((line) => line.sourceId as number))]
    .sort((left, right) => left - right);
}

async function loadDocumentLines(tx: Tx, documentId: number): Promise<BillingDocumentLineRow[]> {
  return tx.select()
    .from(s.billingDocumentLines)
    .where(eq(s.billingDocumentLines.documentId, documentId));
}

async function loadCurrentTripSource(tx: Tx, tripId: number): Promise<{
  version: string | null;
  baseAmount: number;
} | null> {
  const [trip] = await tx.select({
    id: s.tripsComposite.id,
    revenue: s.tripsComposite.revenue,
    postingId: s.tripFinancialPostings.id,
    postingVersion: s.tripFinancialPostings.version,
    postingTripVersion: s.tripFinancialPostings.tripVersion,
    postingReason: s.tripFinancialPostings.reason,
    postingEffectiveAt: s.tripFinancialPostings.effectiveAt,
  })
    .from(s.tripsComposite)
    .innerJoin(s.tripFinancialPostings, and(
      eq(s.tripFinancialPostings.tripId, s.tripsComposite.id),
      eq(s.tripFinancialPostings.status, 'ACTIVE'),
    ))
    .where(and(eq(s.tripsComposite.id, tripId), isNull(s.tripsComposite.deletedAt)))
    .limit(1);
  if (!trip) return null;
  return {
    version: postingChecksum({
      id: trip.postingId,
      tripId: trip.id,
      version: trip.postingVersion,
      tripVersion: trip.postingTripVersion,
      reason: trip.postingReason,
      effectiveAt: trip.postingEffectiveAt,
    }),
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
    version: ['RECORDED', 'APPROVED'].includes(expense.approvalStatus)
      ? buildExpenseSourceVersionToken(expense)
      : null,
    baseAmount: ['RECORDED', 'APPROVED'].includes(expense.approvalStatus) ? Number(expense.sellAmount ?? 0) : 0,
  };
}

async function buildSourceDiffs(tx: Tx, documentId: number): Promise<SourceDiff[]> {
  const lines = await loadDocumentLines(tx, documentId);
  const diffs: SourceDiff[] = [];

  for (const line of lines) {
    if ((line.sourceType !== 'TRIP' && line.sourceType !== 'EXPENSE') || line.sourceId == null) {
      continue;
    }
    const previousVersion = line.sourceType === 'TRIP'
      ? line.postingChecksum
      : renderSourceVersion(line);
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

async function lockExpenseSources(tx: Tx, lines: readonly BillingDocumentLineRow[]): Promise<void> {
  const expenseIds = expenseSourceIds(lines);
  if (expenseIds.length === 0) return;
  await tx.select({ id: s.tripExpenses.id })
    .from(s.tripExpenses)
    .where(inArray(s.tripExpenses.id, expenseIds))
    .for('update');
}

async function assertNoIssueSourceDrift(tx: Tx, documentId: number): Promise<void> {
  const diffs = await buildSourceDiffs(tx, documentId);
  if (diffs.length > 0) {
    throw new ApiError(
      409,
      'Nguồn của giấy báo nợ đã thay đổi sau khi lập yêu cầu phát hành. Vui lòng cập nhật nháp và gửi lại.',
    );
  }
}

async function captureIssueSourceSnapshots(
  tx: Tx,
  lines: readonly BillingDocumentLineRow[],
): Promise<BillingDocumentSourceSnapshot[]> {
  return lines.flatMap((line) => {
    if ((line.sourceType !== 'TRIP' && line.sourceType !== 'EXPENSE') || line.sourceId == null) {
      return [];
    }
    return [{
      lineId: line.id,
      sourceType: line.sourceType,
      sourceId: line.sourceId,
      sourceVersion: renderSourceVersion(line),
      sourceChangedAt: renderSourceChangedAt(line),
      baseAmount: Number(line.baseAmount ?? 0),
      financialPostingId: line.financialPostingId,
      financialPostingVersion: line.financialPostingVersion,
      postingChecksum: line.postingChecksum,
    }];
  });
}

export async function requestBillingDocumentAdjustment(input: {
  documentId: number;
  reason: string;
  makerId: number;
  makerRole: string;
  transaction?: Tx;
}) {
  assertCanMakeGovernanceAction('DEBIT_NOTE_ADJUSTMENT', input.makerRole);
  const normalizedReason = input.reason.trim();
  if (!normalizedReason) {
    throw new ApiError(400, 'Lý do điều chỉnh là bắt buộc');
  }

  const execute = async (tx: Tx) => {
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

    return buildGovernanceAction({
      subjectType: 'BILLING_DOCUMENT',
      subjectId: document.id,
      actionKind: 'DEBIT_NOTE_ADJUSTMENT',
      reason: normalizedReason,
      originalVersion: billingDocumentVersion(document),
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
    });
  };
  return runInTx(input.transaction, execute);
}

/**
 * 2026-09-11 (maker-checker removal): builds the TRANSIENT governed action for
 * a debit-note issue; the route wraps it in autoApplyGovernanceAction so the
 * issue applies in the same request/transaction. Period-lock and source-drift
 * invariants run at build time exactly as before.
 */
/**
 * §7.2 issue readiness (QuyTrinhO2C.md): goods (presentation lines), price
 * (per-line amounts), original document received (§7.1: actual person + date
 * on each source trip) — each missing condition contributes its own reason so
 * none masks another. Period conditions are collected separately by the
 * caller via the existing period-writable assert.
 */
async function collectIssueReadinessReasons(
  tx: Tx,
  lines: BillingDocumentLineRow[],
): Promise<string[]> {
  const reasons: string[] = [];
  const presentable = lines.filter((line) => !line.excluded);
  if (presentable.length === 0) {
    reasons.push('Bảng kê chưa có dòng trình bày hàng hóa.');
    return reasons;
  }
  for (const line of presentable) {
    if (!(Number(line.grossAmount) > 0)) {
      reasons.push(`Dòng "${line.typeLabel}" (STT ${line.sortOrder}): chưa có giá.`);
    }
  }
  const tripIds = tripSourceIds(presentable);
  if (tripIds.length > 0) {
    const trips = await tx.select({
      id: s.trips.id,
      tripCode: s.trips.tripCode,
      paperAt: s.trips.paperOrderCollectedAt,
      paperBy: s.trips.paperOrderCollectedBy,
    })
      .from(s.trips)
      .where(inArray(s.trips.id, tripIds));
    for (const trip of trips) {
      if (!trip.paperAt || !trip.paperBy) {
        reasons.push(`Chuyến ${trip.tripCode ?? `#${trip.id}`}: chưa nhận chứng từ gốc (cần người nhận và ngày nhận thực tế).`);
      }
    }
  }
  return reasons;
}

export async function requestBillingDocumentIssue(input: {
  documentId: number;
  expectedVersion: number;
  reason: string;
  makerId: number;
  makerRole: string;
  transaction?: Tx;
}) {
  assertCanMakeGovernanceAction('DEBIT_NOTE_ISSUE', input.makerRole);
  const normalizedReason = input.reason.trim();
  if (!normalizedReason) {
    throw new ApiError(400, 'Lý do phát hành là bắt buộc');
  }
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion <= 0) {
    throw new ApiError(400, 'expectedVersion không hợp lệ');
  }

  const execute = async (tx: Tx) => {
    const [document] = await tx.select()
      .from(s.billingDocuments)
      .where(and(eq(s.billingDocuments.id, input.documentId), isNull(s.billingDocuments.deletedAt)))
      .limit(1)
      .for('update');
    if (!document) throw new ApiError(404, 'Không tìm thấy giấy báo nợ');
    if (document.type !== 'DEBIT_NOTE' || document.entityType !== 'CUSTOMER') {
      throw new ApiError(409, 'Chỉ giấy báo nợ khách hàng mới hỗ trợ phát hành qua quản trị');
    }
    if ((document.debitNoteStatus ?? 'DRAFT') !== 'DRAFT') {
      throw new ApiError(409, 'Giấy báo nợ đã rời trạng thái nháp, không thể gửi yêu cầu phát hành mới');
    }

    const currentVersion = billingDocumentVersion(document);
    if (currentVersion !== input.expectedVersion) {
      throw new ApiError(409, 'Giấy báo nợ đã thay đổi. Vui lòng tải lại trước khi gửi yêu cầu phát hành.');
    }

    await LedgerService.lockEntity(tx, 'CUSTOMER', document.entityId);
    const authority = await resolveDebitNotePeriodAuthority(
      tx,
      document.entityId,
      document.rangeFrom,
      document.rangeTo,
    );

    const lines = await loadDocumentLines(tx, document.id);
    await lockTripFinancialAuthority(tx, tripSourceIds(lines));
    await lockExpenseSources(tx, lines);
    await assertNoIssueSourceDrift(tx, document.id);
    await assertRecoverableSourcesClaimable(tx, {
      documentId: document.id,
      customerId: document.entityId,
      rangeFrom: document.rangeFrom,
      rangeTo: document.rangeTo,
      lines: lines as unknown as import('@tingting/shared').BillingDocumentLine[],
      actorUserId: input.makerId,
    });

    // §7.2 readiness gate: collect EVERY missing condition (goods, price,
    // original document received) plus the period-writable assert so no
    // reason masks another, then reject once with the full list.
    const missingReasons = await collectIssueReadinessReasons(tx, lines);
    try {
      await assertDebitNotePeriodWritable(tx, authority);
    } catch (err) {
      if (err instanceof ApiError) {
        missingReasons.push(err.message);
      } else {
        throw err;
      }
    }
    if (missingReasons.length > 0) {
      throw new ApiError(409, 'Bảng kê chưa đủ điều kiện phát hành.', missingReasons.map((message) => ({ message })));
    }

    const originalPeriodLock = await getClosedPeriodLock(tx, authority);
    const lineSnapshots = await captureIssueSourceSnapshots(tx, lines);
    return buildGovernanceAction({
      subjectType: 'BILLING_DOCUMENT',
      subjectId: document.id,
      actionKind: 'DEBIT_NOTE_ISSUE',
      reason: normalizedReason,
      originalVersion: currentVersion,
      originalPeriodLockId: originalPeriodLock?.id ?? null,
      beforeSnapshot: {
        documentId: document.id,
        status: document.debitNoteStatus ?? 'DRAFT',
        totalInclVat: Number(document.totalInclVat ?? 0),
        ledgerAdjustmentAmount: Number(document.ledgerAdjustmentAmount ?? 0),
        rangeFrom: document.rangeFrom,
        rangeTo: document.rangeTo,
      },
      afterSnapshot: {
        targetStatus: 'SENT',
        totalInclVat: Number(document.totalInclVat ?? 0),
        ledgerAdjustmentAmount: Number(document.ledgerAdjustmentAmount ?? 0),
        originalDueDate: document.originalDueDate,
        processingDueDate: document.processingDueDate,
        paymentTermDaysApplied: document.paymentTermDaysApplied,
        paymentDatePolicyApplied: document.paymentDatePolicyApplied,
      },
      deltaSnapshot: {
        lineCount: lines.length,
        sourceSnapshots: lineSnapshots,
      },
      makerId: input.makerId,
      makerRole: input.makerRole,
    });
  };
  return runInTx(input.transaction, execute);
}

export async function applyBillingDocumentGovernanceAction(
  tx: Tx,
  action: GovernanceActionRow,
): Promise<GovernanceApplyResult> {
  if (action.subjectType !== 'BILLING_DOCUMENT' || action.subjectId == null) {
    throw new ApiError(409, 'Yêu cầu điều chỉnh không thuộc giấy báo nợ');
  }

  if (action.actionKind === 'DEBIT_NOTE_ISSUE') {
    const [document] = await tx.select()
      .from(s.billingDocuments)
      .where(and(eq(s.billingDocuments.id, action.subjectId), isNull(s.billingDocuments.deletedAt)))
      .limit(1)
      .for('update');
    if (!document) throw new ApiError(404, 'Không tìm thấy giấy báo nợ');
    if (document.type !== 'DEBIT_NOTE' || document.entityType !== 'CUSTOMER') {
      throw new ApiError(409, 'Chỉ giấy báo nợ khách hàng mới hỗ trợ phát hành qua quản trị');
    }
    if ((document.debitNoteStatus ?? 'DRAFT') !== 'DRAFT') {
      throw new ApiError(409, 'Giấy báo nợ đã rời trạng thái nháp; yêu cầu phát hành không còn hợp lệ');
    }
    if (billingDocumentVersion(document) !== action.originalVersion) {
      throw new ApiError(409, 'Giấy báo nợ đã thay đổi sau khi tạo yêu cầu phát hành. Vui lòng tải lại và gửi lại.');
    }

    await LedgerService.lockEntity(tx, 'CUSTOMER', document.entityId);
    const authority = await resolveDebitNotePeriodAuthority(
      tx,
      document.entityId,
      document.rangeFrom,
      document.rangeTo,
    );
    await assertDebitNotePeriodWritable(tx, authority);

    const lines = await loadDocumentLines(tx, document.id);
    await lockTripFinancialAuthority(tx, tripSourceIds(lines));
    await lockExpenseSources(tx, lines);
    await assertNoIssueSourceDrift(tx, document.id);
    await assertRecoverableSourcesClaimable(tx, {
      documentId: document.id,
      customerId: document.entityId,
      rangeFrom: document.rangeFrom,
      rangeTo: document.rangeTo,
      lines: lines as unknown as import('@tingting/shared').BillingDocumentLine[],
      actorUserId: action.makerId,
    });

    await transitionDebitNoteStatus({
      documentId: document.id,
      targetStatus: 'SENT',
      expectedStatus: 'DRAFT',
      actorUserId: action.approverId ?? action.makerId,
      transaction: tx,
    });
    await postDebitNoteDelta(tx, {
      documentId: document.id,
      customerId: document.entityId,
      delta: Number(document.ledgerAdjustmentAmount ?? 0),
      originalDueDate: document.originalDueDate,
      processingDueDate: document.processingDueDate,
      paymentTermDaysApplied: document.paymentTermDaysApplied,
      paymentDatePolicyApplied: document.paymentDatePolicyApplied as PaymentDatePolicy | null,
    });

    const [issued] = await tx.select({
      debitNoteStatus: s.billingDocuments.debitNoteStatus,
      version: s.billingDocuments.version,
    })
      .from(s.billingDocuments)
      .where(eq(s.billingDocuments.id, document.id))
      .limit(1);

    return {
      applicationResult: {
        documentId: document.id,
        documentStatus: issued?.debitNoteStatus ?? 'SENT',
        resultingVersion: issued?.version ?? action.originalVersion + 1,
        ledgerAdjustmentAmount: Number(document.ledgerAdjustmentAmount ?? 0),
      },
    };
  }

  if (action.actionKind !== 'DEBIT_NOTE_ADJUSTMENT') {
    throw new ApiError(409, 'Loại yêu cầu không thuộc quản trị giấy báo nợ');
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
    note: `Điều chỉnh giấy báo nợ: ${action.reason}`,
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
