import { and, desc, eq, sql } from 'drizzle-orm';
import { Role, TxnType } from '@tingting/shared';
import { db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import { LedgerService } from './ledger.service';
import type { Tx } from './trip-shared';
import {
  getClosedPeriodLock,
  resolveDebitNotePeriodAuthority,
} from './period-lock.service';
import {
  resolveCustomerPaymentDueDate,
  type PaymentDatePolicy,
} from './business-calendar.service';
import { lockTripFinancialAuthority } from './trip-financial-authority-lock.service';

export type GovernanceActionKind = 'TRIP_AR_ADJUSTMENT' | 'TRIP_REOPEN';

const FINANCIAL_ROLES = new Set<string>([Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT]);
const REOPEN_ROLES = new Set<string>([Role.ADMIN, Role.MANAGER]);

function requireReason(reason: string): string {
  const normalized = reason.trim();
  if (!normalized) throw new ApiError(400, 'Lý do điều chỉnh là bắt buộc');
  return normalized;
}

function assertRole(kind: GovernanceActionKind, role: string): void {
  const roles = kind === 'TRIP_REOPEN' ? REOPEN_ROLES : FINANCIAL_ROLES;
  if (!roles.has(role)) {
    throw new ApiError(403, 'Bạn không có quyền thực hiện bước phê duyệt này');
  }
}

function assertExpectedActionVersion(actual: number, expected: number): void {
  if (!Number.isInteger(expected) || expected <= 0) {
    throw new ApiError(400, 'expectedVersion không hợp lệ');
  }
  if (actual !== expected) {
    throw new ApiError(409, 'Yêu cầu đã được người khác xử lý. Vui lòng tải lại.');
  }
}

function assertExpectedTripVersion(expected: number): void {
  if (!Number.isInteger(expected) || expected <= 0) {
    throw new ApiError(400, 'expectedVersion không hợp lệ');
  }
}

async function assertTripCanBeReopened(
  tx: Tx,
  tripId: number,
): Promise<void> {
  const [posted] = await tx.select({ id: s.ledger.id }).from(s.ledger)
    .where(and(
      eq(s.ledger.txnType, TxnType.TRIP_REVENUE),
      eq(s.ledger.txnId, tripId),
    ))
    .limit(1);
  if (posted) {
    throw new ApiError(
      409,
      'Chuyến đã hạch toán; chỉ được lập điều chỉnh bổ sung, không thể mở lại',
    );
  }

  const [issued] = await tx.select({ id: s.billingDocuments.id })
    .from(s.billingDocumentLines)
    .innerJoin(
      s.billingDocuments,
      eq(s.billingDocuments.id, s.billingDocumentLines.documentId),
    )
    .where(and(
      eq(s.billingDocumentLines.sourceType, 'TRIP'),
      eq(s.billingDocumentLines.sourceId, tripId),
      sql`coalesce(${s.billingDocuments.debitNoteStatus}::text, 'DRAFT') <> 'DRAFT'`,
    ))
    .limit(1);
  if (issued) {
    throw new ApiError(
      409,
      'Chuyến đã phát hành giấy báo nợ; chỉ được lập điều chỉnh bổ sung',
    );
  }

  const [directPayment] = await tx.select({ id: s.paymentAllocations.id })
    .from(s.paymentAllocations)
    .where(and(
      eq(s.paymentAllocations.targetType, 'TRIP'),
      eq(s.paymentAllocations.targetId, tripId),
    ))
    .limit(1);
  const [documentPayment] = await tx.select({ id: s.paymentAllocations.id })
    .from(s.paymentAllocations)
    .innerJoin(
      s.billingDocumentLines,
      and(
        eq(s.paymentAllocations.targetType, 'BILLING_DOCUMENT'),
        eq(s.paymentAllocations.targetId, s.billingDocumentLines.documentId),
      ),
    )
    .where(and(
      eq(s.billingDocumentLines.sourceType, 'TRIP'),
      eq(s.billingDocumentLines.sourceId, tripId),
    ))
    .limit(1);
  if (directPayment || documentPayment) {
    throw new ApiError(
      409,
      'Chuyến đã thanh toán hoặc phân bổ thanh toán; chỉ được lập điều chỉnh bổ sung',
    );
  }
}

export async function requestTripArAdjustment(input: {
  tripId: number;
  amount: number;
  reason: string;
  signedAgreementRef: string;
  makerId: number;
  makerRole: string;
  expectedTripVersion: number;
}) {
  assertRole('TRIP_AR_ADJUSTMENT', input.makerRole);
  assertExpectedTripVersion(input.expectedTripVersion);
  const reason = requireReason(input.reason);
  const agreementRef = input.signedAgreementRef.trim();
  if (!agreementRef) throw new ApiError(400, 'Tham chiếu thỏa thuận đã ký là bắt buộc');
  if (!Number.isFinite(input.amount) || input.amount === 0) {
    throw new ApiError(400, 'Số tiền điều chỉnh phải khác 0');
  }

  return db.transaction(async (tx) => {
    const [trip] = await tx.select().from(s.trips)
      .where(eq(s.trips.id, input.tripId)).limit(1).for('update');
    if (!trip) throw new ApiError(404, 'Không tìm thấy chuyến đi');
    if (trip.version !== input.expectedTripVersion) {
      throw new ApiError(409, 'Chuyến đi đã được thay đổi. Vui lòng tải lại.');
    }

    const periodRef = await resolveDebitNotePeriodAuthority(
      tx,
      trip.customerId,
      String(trip.departureDate).slice(0, 10),
      String(trip.departureDate).slice(0, 10),
    );
    const originalPeriodLock = await getClosedPeriodLock(tx, periodRef);
    const [action] = await tx.insert(s.governanceActions).values({
      subjectType: 'TRIP',
      subjectId: trip.id,
      actionKind: 'TRIP_AR_ADJUSTMENT',
      reason,
      originalVersion: trip.version,
      originalPeriodLockId: originalPeriodLock?.id ?? null,
      beforeSnapshot: {
        tripStatus: trip.status,
        tripRevenue: trip.revenue,
        customerId: trip.customerId,
      },
      afterSnapshot: {
        tripStatus: trip.status,
        tripRevenue: trip.revenue,
        customerId: trip.customerId,
      },
      deltaSnapshot: {
        customerBalanceDelta: input.amount,
        signedAgreementRef: agreementRef,
      },
      makerId: input.makerId,
    }).returning();
    return action;
  });
}

export async function requestTripReopen(input: {
  tripId: number;
  reason: string;
  makerId: number;
  makerRole: string;
  expectedTripVersion: number;
}) {
  assertRole('TRIP_REOPEN', input.makerRole);
  assertExpectedTripVersion(input.expectedTripVersion);
  const reason = requireReason(input.reason);
  return db.transaction(async (tx) => {
    await lockTripFinancialAuthority(tx, [input.tripId]);
    const [trip] = await tx.select().from(s.trips)
      .where(eq(s.trips.id, input.tripId)).limit(1).for('update');
    if (!trip) throw new ApiError(404, 'Không tìm thấy chuyến đi');
    if (trip.status !== 'LOCKED') {
      throw new ApiError(409, 'Chỉ có thể đề nghị mở lại chuyến đã chốt');
    }
    if (trip.version !== input.expectedTripVersion) {
      throw new ApiError(409, 'Chuyến đi đã được thay đổi. Vui lòng tải lại.');
    }
    await assertTripCanBeReopened(tx, trip.id);

    const [action] = await tx.insert(s.governanceActions).values({
      subjectType: 'TRIP',
      subjectId: trip.id,
      actionKind: 'TRIP_REOPEN',
      reason,
      originalVersion: trip.version,
      beforeSnapshot: { status: 'LOCKED' },
      afterSnapshot: { status: 'COMPLETED' },
      deltaSnapshot: null,
      makerId: input.makerId,
    }).returning();
    return action;
  });
}

export async function checkGovernanceAction(input: {
  actionId: number;
  checkerId: number;
  checkerRole: string;
  expectedVersion: number;
}) {
  return db.transaction(async (tx) => {
    const [action] = await tx.select().from(s.governanceActions)
      .where(eq(s.governanceActions.id, input.actionId)).limit(1).for('update');
    if (!action) throw new ApiError(404, 'Không tìm thấy yêu cầu điều chỉnh');
    assertRole(action.actionKind as GovernanceActionKind, input.checkerRole);
    assertExpectedActionVersion(action.version, input.expectedVersion);
    if (action.status !== 'PENDING_CHECK') {
      throw new ApiError(409, 'Yêu cầu không còn ở bước kiểm tra');
    }
    if (action.makerId === input.checkerId) {
      throw new ApiError(403, 'Người tạo không được tự kiểm tra yêu cầu');
    }

    const [updated] = await tx.update(s.governanceActions).set({
      status: 'PENDING_APPROVAL',
      checkerId: input.checkerId,
      checkedAt: new Date(),
      version: sql`${s.governanceActions.version} + 1`,
    }).where(and(
      eq(s.governanceActions.id, action.id),
      eq(s.governanceActions.status, 'PENDING_CHECK'),
      eq(s.governanceActions.version, input.expectedVersion),
    )).returning();
    if (!updated) {
      throw new ApiError(409, 'Yêu cầu đã được người khác xử lý. Vui lòng tải lại.');
    }
    return updated;
  });
}

export async function approveGovernanceAction(input: {
  actionId: number;
  approverId: number;
  approverRole: string;
  expectedVersion: number;
}) {
  return db.transaction(async (tx) => {
    const [action] = await tx.select().from(s.governanceActions)
      .where(eq(s.governanceActions.id, input.actionId)).limit(1).for('update');
    if (!action) throw new ApiError(404, 'Không tìm thấy yêu cầu điều chỉnh');
    const kind = action.actionKind as GovernanceActionKind;
    assertRole(kind, input.approverRole);
    assertExpectedActionVersion(action.version, input.expectedVersion);
    if (action.status !== 'PENDING_APPROVAL' || action.checkerId == null) {
      throw new ApiError(409, 'Yêu cầu chưa được kiểm tra hoặc đã được xử lý');
    }
    if (action.makerId === input.approverId || action.checkerId === input.approverId) {
      throw new ApiError(403, 'Người phê duyệt phải khác người tạo và người kiểm tra');
    }

    if (kind === 'TRIP_REOPEN') {
      await lockTripFinancialAuthority(tx, [action.subjectId]);
    }
    const [trip] = await tx.select().from(s.trips)
      .where(eq(s.trips.id, action.subjectId)).limit(1).for('update');
    if (!trip) throw new ApiError(404, 'Không tìm thấy chuyến đi gốc');
    if (trip.version !== action.originalVersion) {
      throw new ApiError(409, 'Dữ liệu gốc đã thay đổi; yêu cầu này không thể áp dụng');
    }

    let ledgerEntryId: number | null = null;
    if (kind === 'TRIP_AR_ADJUSTMENT') {
      const delta = action.deltaSnapshot as Record<string, unknown> | null;
      const amount = Number(delta?.customerBalanceDelta);
      const signedAgreementRef = String(delta?.signedAgreementRef ?? '').trim();
      if (!Number.isFinite(amount) || amount === 0 || !signedAgreementRef) {
        throw new ApiError(409, 'Yêu cầu điều chỉnh thiếu dữ liệu áp dụng hợp lệ');
      }

      const [existingAuthority] = await tx.select({
        originalDueDate: s.ledger.originalDueDate,
        processingDueDate: s.ledger.processingDueDate,
        paymentTermDaysApplied: s.ledger.paymentTermDaysApplied,
        paymentDatePolicyApplied: s.ledger.paymentDatePolicyApplied,
      }).from(s.ledger).where(and(
        eq(s.ledger.entityType, 'CUSTOMER'),
        eq(s.ledger.txnType, TxnType.TRIP_REVENUE),
        eq(s.ledger.txnId, trip.id),
      )).orderBy(desc(s.ledger.id)).limit(1);
      const resolvedAuthority = existingAuthority?.originalDueDate
        && existingAuthority.processingDueDate
        ? null
        : await resolveCustomerPaymentDueDate(
            tx,
            trip.customerId,
            String(trip.departureDate).slice(0, 10),
          );
      const posted = await LedgerService.postEntry(tx, {
        txnType: TxnType.ADJUSTMENT,
        txnId: trip.id,
        entityType: 'CUSTOMER',
        entityId: trip.customerId,
        debit: amount > 0 ? amount : 0,
        credit: amount > 0 ? 0 : Math.abs(amount),
        note: `${action.reason} (HĐ: ${signedAgreementRef})`,
        originalDueDate: existingAuthority?.originalDueDate ?? resolvedAuthority?.originalDate,
        processingDueDate:
          existingAuthority?.processingDueDate ?? resolvedAuthority?.processingDate,
        paymentTermDaysApplied:
          existingAuthority?.paymentTermDaysApplied ?? resolvedAuthority?.paymentTermDays,
        paymentDatePolicyApplied: (
          existingAuthority?.paymentDatePolicyApplied as PaymentDatePolicy | null
        ) ?? resolvedAuthority?.policy,
      });
      ledgerEntryId = posted.id;
    } else {
      if (trip.status !== 'LOCKED') {
        throw new ApiError(409, 'Chuyến đi không còn ở trạng thái đã chốt');
      }
      await assertTripCanBeReopened(tx, trip.id);
    }

    const [versionedTrip] = await tx.update(s.trips).set({
      ...(kind === 'TRIP_REOPEN' ? { status: 'COMPLETED' as const } : {}),
      version: sql`${s.trips.version} + 1`,
      updatedAt: new Date(),
    }).where(and(
      eq(s.trips.id, trip.id),
      eq(s.trips.version, action.originalVersion),
      ...(kind === 'TRIP_REOPEN' ? [eq(s.trips.status, 'LOCKED')] : []),
    )).returning({ id: s.trips.id });
    if (!versionedTrip) {
      throw new ApiError(409, 'Dữ liệu gốc đã thay đổi; yêu cầu này không thể áp dụng');
    }

    const now = new Date();
    const [approved] = await tx.update(s.governanceActions).set({
      status: 'APPROVED',
      approverId: input.approverId,
      approvedAt: now,
      appliedAt: now,
      ledgerEntryId,
      version: sql`${s.governanceActions.version} + 1`,
    }).where(and(
      eq(s.governanceActions.id, action.id),
      eq(s.governanceActions.status, 'PENDING_APPROVAL'),
      eq(s.governanceActions.version, input.expectedVersion),
    )).returning();
    if (!approved) {
      throw new ApiError(409, 'Yêu cầu đã được người khác xử lý. Vui lòng tải lại.');
    }
    return approved;
  });
}

export async function listTripGovernanceActions(tripId: number) {
  return db.select().from(s.governanceActions)
    .where(and(
      eq(s.governanceActions.subjectType, 'TRIP'),
      eq(s.governanceActions.subjectId, tripId),
    ))
    .orderBy(desc(s.governanceActions.id));
}
