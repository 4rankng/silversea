import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { NotificationType, Role, TripStatus, TxnType } from '@tingting/shared';
import { db } from '../db';
import { runInTx } from '../lib/tx';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import {
  lockTripCloseAggregate,
  requireTripCloseReadiness,
} from './trip-close-readiness.service';
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
import { tripCompositeSelect } from './trip-composite.service';
import { assertCanMakeGovernanceAction } from './governance-policy';
// Import from the approval CORE (leaf), never the transition hub — the hub
// aggregates this service via financial.service, and importing it back would
// close a services-graph import cycle.
import {
  approveGovernanceActionWithAdapter,
  assertActiveApprovalApplication,
  checkGovernanceAction,
  type GovernanceActionRow,
} from './governance-action-core.service';
import { applyBillingDocumentGovernanceAction } from './billing-document-governance.service';
import { applyPriceConfigGovernanceAction } from './price-config-governance.service';
import { applyDebtOffsetGovernanceAction } from './debtOffset.service';
import {
  applyAdvanceRequestGovernanceAction,
  applyAdvanceSettlementGovernanceAction,
} from './advance.service';
import { applyCompanyExpenseGovernanceAction } from './expense.service';
import { applyFuelInvoiceGovernanceAction } from './fuel-invoice.service';
import { applyCreditOverrideGovernanceAction } from './credit-limit.service';
import { applyTripExpenseGovernanceAction } from './approval.service';
import { transitionTripStatus } from './trip-status-machine.service';
import {
  updateTripFigures,
  type TripFigureUpdateInput,
} from './trip-mutations.service';
import { removeTripWorkDays, syncTripWorkDays } from './attendance.service';
import { persistNotificationInTx } from './notification.service';
import {
  createFinancialPosting,
  getActiveFinancialPosting,
  getFinancialPostingForGovernanceAction,
} from './financial-posting.service';
import { captureProfitabilityAttributionSnapshot } from './profitability.service';

export { checkGovernanceAction } from './governance-action-core.service';

function requireReason(reason: string): string {
  const normalized = reason.trim();
  if (!normalized) throw new ApiError(400, 'Lý do điều chỉnh là bắt buộc');
  return normalized;
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
  // O2C C2: under the old LOCKED model, this blocked on any TRIP_REVENUE
  // ledger row (LOCKED carried no postings). Under the single-terminal model,
  // completion ALWAYS posts TRIP_REVENUE — so the old block made reopen
  // unreachable. Now we allow reopen: the canonical completion postings get
  // reversed inside the reopen transaction. We still block on downstream
  // constraints (debit notes, payment allocations) that can't be cleanly
  // reversed.

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
  transaction?: Tx;
}) {
  assertCanMakeGovernanceAction('TRIP_AR_ADJUSTMENT', input.makerRole);
  assertExpectedTripVersion(input.expectedTripVersion);
  const reason = requireReason(input.reason);
  const agreementRef = input.signedAgreementRef.trim();
  if (!agreementRef) throw new ApiError(400, 'Tham chiếu thỏa thuận đã ký là bắt buộc');
  if (!Number.isFinite(input.amount) || input.amount === 0) {
    throw new ApiError(400, 'Số tiền điều chỉnh phải khác 0');
  }

  const execute = async (tx: Tx) => {
    const [trip] = await tx.select(tripCompositeSelect())
        .from(s.trips)
        .leftJoin(s.tripFinancialState, eq(s.tripFinancialState.tripId, s.trips.id))
        .leftJoin(s.tripCarrierInfo, eq(s.tripCarrierInfo.tripId, s.trips.id))
        .where(eq(s.trips.id, input.tripId)).limit(1)
        .for('update', { of: [s.trips] });
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
      makerRole: input.makerRole,
    }).returning();
    return action;
  };
  return runInTx(input.transaction, execute);
}

export async function requestTripReopen(input: {
  tripId: number;
  reason: string;
  makerId: number;
  makerRole: string;
  expectedTripVersion: number;
  transaction?: Tx;
}) {
  assertCanMakeGovernanceAction('TRIP_REOPEN', input.makerRole);
  assertExpectedTripVersion(input.expectedTripVersion);
  const reason = requireReason(input.reason);
  const execute = async (tx: Tx) => {
    await lockTripFinancialAuthority(tx, [input.tripId]);
    const [trip] = await tx.select(tripCompositeSelect())
        .from(s.trips)
        .leftJoin(s.tripFinancialState, eq(s.tripFinancialState.tripId, s.trips.id))
        .leftJoin(s.tripCarrierInfo, eq(s.tripCarrierInfo.tripId, s.trips.id))
        .where(eq(s.trips.id, input.tripId)).limit(1)
        .for('update', { of: [s.trips] });
    if (!trip) throw new ApiError(404, 'Không tìm thấy chuyến đi');
    if (trip.status !== 'COMPLETED') {
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
      beforeSnapshot: { status: 'COMPLETED' },
      afterSnapshot: { status: 'IN_TRANSIT' },
      deltaSnapshot: null,
      makerId: input.makerId,
      makerRole: input.makerRole,
    }).returning();
    return action;
  };
  return runInTx(input.transaction, execute);
}

async function assertNoPendingTripGovernanceAction(
  tx: Tx,
  tripId: number,
  actionKind: 'TRIP_FINANCIAL_CHANGE' | 'TRIP_FINANCIAL_CLOSE',
  originalVersion: number,
): Promise<void> {
  const [pending] = await tx.select({ id: s.governanceActions.id })
    .from(s.governanceActions)
    .where(and(
      eq(s.governanceActions.subjectType, 'TRIP'),
      eq(s.governanceActions.subjectId, tripId),
      eq(s.governanceActions.actionKind, actionKind),
      eq(s.governanceActions.originalVersion, originalVersion),
      inArray(s.governanceActions.status, [
        'PENDING_CHECK',
        'PENDING_APPROVAL',
        'RETURNED_FOR_EVIDENCE',
      ]),
    ))
    .limit(1);
  if (pending) {
    throw new ApiError(409, 'Chuyến đi đã có yêu cầu tài chính đang chờ xử lý');
  }
}

export async function requestTripFinancialClose(input: {
  tripId: number;
  reason: string;
  makerId: number;
  makerRole: string;
  expectedTripVersion: number;
  transaction?: Tx;
}) {
  assertCanMakeGovernanceAction('TRIP_FINANCIAL_CLOSE', input.makerRole);
  assertExpectedTripVersion(input.expectedTripVersion);
  const reason = requireReason(input.reason);

  const execute = async (tx: Tx) => {
    const trip = await lockTripCloseAggregate(tx, input.tripId);
    if (trip.version !== input.expectedTripVersion) {
      throw new ApiError(409, 'Chuyến đi đã được thay đổi. Vui lòng tải lại.');
    }
    if (trip.status !== TripStatus.IN_TRANSIT) {
      throw new ApiError(409, 'Chỉ có thể đề nghị hoàn thành chuyến đi đang chạy');
    }
    // O2C M4: fail-fast on missing photos at request time, not at approval
    // time (so maker/checker/approver don't waste cycles on a trip that will
    // 422 on the photo gate). The governed close bypasses confirmZeroRevenue
    // (governance reviewed it) but NOT the photo gate (physical evidence).
    const photos = await tx.select({ type: s.tripPhotos.type })
      .from(s.tripPhotos).where(eq(s.tripPhotos.tripId, trip.id));
    if (photos.length === 0) {
      throw new ApiError(
        422,
        'Chưa có ảnh bằng chứng. Vui lòng tải lên ít nhất 1 ảnh trước khi đề nghị hoàn thành.',
      );
    }
    const closeEvidence = await requireTripCloseReadiness(tx, trip.id);
    await assertNoPendingTripGovernanceAction(
      tx,
      trip.id,
      'TRIP_FINANCIAL_CLOSE',
      trip.version,
    );

    const [action] = await tx.insert(s.governanceActions).values({
      subjectType: 'TRIP',
      subjectId: trip.id,
      subjectKey: trip.tripCode,
      actionKind: 'TRIP_FINANCIAL_CLOSE',
      reason,
      originalVersion: trip.version,
      beforeSnapshot: {
        status: trip.status,
        revenue: trip.revenue,
        totalCost: trip.totalCost,
        grossProfit: trip.grossProfit,
      },
      afterSnapshot: { status: TripStatus.COMPLETED, ...closeEvidence },
      deltaSnapshot: null,
      makerId: input.makerId,
      makerRole: input.makerRole,
    }).returning();
    return action;
  };
  return runInTx(input.transaction, execute);
}

export async function requestTripFinancialChange(input: {
  tripId: number;
  reason: string;
  figures: TripFigureUpdateInput;
  makerId: number;
  makerRole: string;
  expectedTripVersion: number;
  transaction?: Tx;
}) {
  assertCanMakeGovernanceAction('TRIP_FINANCIAL_CHANGE', input.makerRole);
  assertExpectedTripVersion(input.expectedTripVersion);
  const reason = requireReason(input.reason);

  const execute = async (tx: Tx) => {
    await lockTripFinancialAuthority(tx, [input.tripId]);
    const [trip] = await tx.select(tripCompositeSelect())
        .from(s.trips)
        .leftJoin(s.tripFinancialState, eq(s.tripFinancialState.tripId, s.trips.id))
        .leftJoin(s.tripCarrierInfo, eq(s.tripCarrierInfo.tripId, s.trips.id))
        .where(eq(s.trips.id, input.tripId)).limit(1)
        .for('update', { of: [s.trips] });
    if (!trip) throw new ApiError(404, 'Không tìm thấy chuyến đi');
    if (trip.version !== input.expectedTripVersion) {
      throw new ApiError(409, 'Chuyến đi đã được thay đổi. Vui lòng tải lại.');
    }
    if (trip.status !== TripStatus.COMPLETED) {
      throw new ApiError(409, 'Chỉ tạo yêu cầu tài chính cho chuyến đã hoàn thành');
    }
    await assertNoPendingTripGovernanceAction(
      tx,
      trip.id,
      'TRIP_FINANCIAL_CHANGE',
      trip.version,
    );

    const [action] = await tx.insert(s.governanceActions).values({
      subjectType: 'TRIP',
      subjectId: trip.id,
      subjectKey: trip.tripCode,
      actionKind: 'TRIP_FINANCIAL_CHANGE',
      reason,
      originalVersion: trip.version,
      beforeSnapshot: {
        customerId: trip.customerId,
        revenue: trip.revenue,
        totalFuelCost: trip.totalFuelCost,
        totalRoadAllowance: trip.totalRoadAllowance,
        totalCost: trip.totalCost,
        driverSalary: trip.driverSalary,
        customerCommission: trip.customerCommission,
        grossProfit: trip.grossProfit,
      },
      afterSnapshot: { figures: input.figures },
      deltaSnapshot: null,
      makerId: input.makerId,
      makerRole: input.makerRole,
    }).returning();
    return action;
  };
  return runInTx(input.transaction, execute);
}

export async function requestCompletedTripCancellation(input: {
  tripId: number;
  reason: string;
  makerId: number;
  makerRole: string;
  expectedTripVersion: number;
  transaction?: Tx;
}) {
  assertCanMakeGovernanceAction('TRIP_FINANCIAL_CHANGE', input.makerRole);
  if (input.makerRole !== Role.ADMIN && input.makerRole !== Role.MANAGER) {
    throw new ApiError(403, 'Chỉ Quản lý hoặc Quản trị viên mới có quyền đề nghị hủy chuyến đi');
  }
  assertExpectedTripVersion(input.expectedTripVersion);
  const reason = requireReason(input.reason);

  const execute = async (tx: Tx) => {
    await lockTripFinancialAuthority(tx, [input.tripId]);
    const [trip] = await tx.select(tripCompositeSelect())
        .from(s.trips)
        .leftJoin(s.tripFinancialState, eq(s.tripFinancialState.tripId, s.trips.id))
        .leftJoin(s.tripCarrierInfo, eq(s.tripCarrierInfo.tripId, s.trips.id))
        .where(eq(s.trips.id, input.tripId)).limit(1)
        .for('update', { of: [s.trips] });
    if (!trip) throw new ApiError(404, 'Không tìm thấy chuyến đi');
    if (trip.version !== input.expectedTripVersion) {
      throw new ApiError(409, 'Chuyến đi đã được thay đổi. Vui lòng tải lại.');
    }
    if (trip.status !== TripStatus.COMPLETED) {
      throw new ApiError(409, 'Chỉ tạo yêu cầu hủy tài chính cho chuyến đã hoàn thành');
    }
    await assertNoPendingTripGovernanceAction(
      tx,
      trip.id,
      'TRIP_FINANCIAL_CHANGE',
      trip.version,
    );

    const [action] = await tx.insert(s.governanceActions).values({
      subjectType: 'TRIP',
      subjectId: trip.id,
      subjectKey: trip.tripCode,
      actionKind: 'TRIP_FINANCIAL_CHANGE',
      reason,
      originalVersion: trip.version,
      beforeSnapshot: {
        status: trip.status,
        fuelLitersOverride: trip.fuelLitersOverride,
        fuelSupplementLiters: trip.fuelSupplementLiters,
        tollsDiscount: trip.tollsDiscount,
        tollsAddition: trip.tollsAddition,
        tollsStations: trip.tollsStations,
        hasReturnCargo: trip.hasReturnCargo,
        fuelPriceApplied: trip.fuelPriceApplied,
        fuelActualUnitPrice: trip.fuelActualUnitPrice,
        roadAllowanceBaseApplied: trip.roadAllowanceBaseApplied,
        fuelLoadedNormApplied: trip.fuelLoadedNormApplied,
        fuelEmptyNormApplied: trip.fuelEmptyNormApplied,
        fuelFixedAllowanceApplied: trip.fuelFixedAllowanceApplied,
        fuelSupplementNormApplied: trip.fuelSupplementNormApplied,
        tollPerStationApplied: trip.tollPerStationApplied,
        returnCargoBonusApplied: trip.returnCargoBonusApplied,
        fuelLiters: trip.fuelLiters,
        revenue: trip.revenue,
        totalFuelCost: trip.totalFuelCost,
        totalRoadAllowance: trip.totalRoadAllowance,
        tollCost: trip.tollCost,
        roadAllowanceOverride: trip.roadAllowanceOverride,
        totalCost: trip.totalCost,
        driverSalary: trip.driverSalary,
        revenueEmptyReturn: trip.revenueEmptyReturn,
        revenueCombine: trip.revenueCombine,
        twoPointDeliveryBonus: trip.twoPointDeliveryBonus,
        vehicleShiftAllowance: trip.vehicleShiftAllowance,
        grossProfit: trip.grossProfit,
        revenueOriginal: trip.revenueOriginal,
        customerCommission: trip.customerCommission,
        tripWageDays: trip.tripWageDays,
        vatRate: trip.vatRate,
        externalFreightCost: trip.externalFreightCost,
      },
      afterSnapshot: {
        operation: 'CANCEL_COMPLETED',
        status: TripStatus.CANCELED,
      },
      deltaSnapshot: null,
      makerId: input.makerId,
      makerRole: input.makerRole,
    }).returning();
    return action;
  };
  return runInTx(input.transaction, execute);
}

export async function approveGovernanceAction(input: {
  actionId: number;
  approverId: number;
  approverRole: string;
  expectedVersion: number;
  transaction?: Tx;
}) {
  const approved = await approveGovernanceActionWithAdapter({
    ...input,
    apply: applyGovernanceAction,
    authorizeBeforeApply: (action) => (
      action.subjectType === 'TRIP'
      && (
        action.actionKind === 'TRIP_FINANCIAL_CLOSE'
        || action.actionKind === 'TRIP_FINANCIAL_CHANGE'
      )
    ),
  });
  if (approved.subjectType === 'PRICE_CONFIG' && approved.subjectId == null && approved.subjectKey) {
    return approved;
  }
  if (approved.subjectId == null) {
    throw new ApiError(409, 'Yêu cầu điều chỉnh không có đối tượng hợp lệ');
  }
  return { ...approved, subjectId: approved.subjectId };
}

async function applyGovernanceAction(
  tx: Tx,
  action: GovernanceActionRow,
) {
  if (action.subjectType === 'BILLING_DOCUMENT') {
    return applyBillingDocumentGovernanceAction(tx, action);
  }
  if (action.subjectType === 'PRICE_CONFIG') {
    return applyPriceConfigGovernanceAction(tx, action);
  }
  if (action.subjectType === 'DEBT_OFFSET') {
    return applyDebtOffsetGovernanceAction(tx, action);
  }
  if (action.subjectType === 'ADVANCE_REQUEST') {
    return applyAdvanceRequestGovernanceAction(tx, action);
  }
  if (action.subjectType === 'ADVANCE_SETTLEMENT') {
    return applyAdvanceSettlementGovernanceAction(tx, action);
  }
  if (action.subjectType === 'COMPANY_EXPENSE') {
    return applyCompanyExpenseGovernanceAction(tx, action);
  }
  if (action.subjectType === 'FUEL_INVOICE') {
    return applyFuelInvoiceGovernanceAction(tx, action);
  }
  if (action.subjectType === 'CREDIT_OVERRIDE') {
    return applyCreditOverrideGovernanceAction(tx, action);
  }
  if (action.subjectType === 'TRIP_EXPENSE') {
    return applyTripExpenseGovernanceAction(tx, action);
  }
  return applyTripGovernanceAction(tx, action);
}

async function applyTripGovernanceAction(
  tx: Tx,
  action: GovernanceActionRow,
) {
  assertActiveApprovalApplication(tx, action.id);
  if (action.subjectType !== 'TRIP' || action.subjectId == null) {
    throw new ApiError(409, 'Yêu cầu điều chỉnh không có chuyến đi hợp lệ');
  }
  if (
    action.actionKind !== 'TRIP_AR_ADJUSTMENT'
    && action.actionKind !== 'TRIP_REOPEN'
    && action.actionKind !== 'TRIP_FINANCIAL_CHANGE'
    && action.actionKind !== 'TRIP_FINANCIAL_CLOSE'
  ) {
    throw new ApiError(409, 'Loại yêu cầu không thuộc quản trị chuyến đi');
  }
  const kind = action.actionKind;

  if (kind === 'TRIP_REOPEN' || kind === 'TRIP_FINANCIAL_CHANGE') {
    await lockTripFinancialAuthority(tx, [action.subjectId]);
  }
  const trip = kind === 'TRIP_FINANCIAL_CLOSE'
    ? await lockTripCloseAggregate(tx, action.subjectId)
    : (await tx.select(tripCompositeSelect())
        .from(s.trips)
        .leftJoin(s.tripFinancialState, eq(s.tripFinancialState.tripId, s.trips.id))
        .leftJoin(s.tripCarrierInfo, eq(s.tripCarrierInfo.tripId, s.trips.id))
        .where(eq(s.trips.id, action.subjectId)).limit(1)
        .for('update', { of: [s.trips] }))[0];
  if (!trip) throw new ApiError(404, 'Không tìm thấy chuyến đi gốc');
  if (trip.version !== action.originalVersion) {
    throw new ApiError(409, 'Dữ liệu gốc đã thay đổi; yêu cầu này không thể áp dụng');
  }

  let ledgerEntryId: number | null = null;
  if (kind === 'TRIP_FINANCIAL_CLOSE') {
    // O2C: the photo/zero-revenue gates now fire on IN_TRANSIT → COMPLETED.
    // A governed close has already been reviewed by a distinct maker, checker,
    // and approver — that governance authorizes the zero-revenue soft guard
    // (a financial figure the governance reviewed). The photo-evidence gate
    // is NOT bypassed: physical evidence is independent of the governance review.
    const completed = await transitionTripStatus(
      trip.id,
      TripStatus.COMPLETED,
      action.approverId!,
      action.approverRole!,
      true,
      false,
      {
        expectedVersion: action.originalVersion,
        transaction: tx,
        governanceActionId: action.id,
        strictApSnapshot: true,
      },
    );
    if (completed.driverId && completed.departureDate) {
      await syncTripWorkDays(
        completed.driverId,
        completed.id,
        String(completed.departureDate),
        null,
        action.approverId,
        tx,
      );
    }
    await persistNotificationInTx(tx, {
      type: NotificationType.TRIP_COMPLETED,
      title: 'Chuyến hoàn thành',
      message: `Chuyến ${completed.tripCode} đã hoàn thành`,
      relatedEntityType: 'trips',
      relatedEntityId: completed.id,
      targetDriverId: completed.driverId ?? undefined,
    });
    const financialPosting = await getActiveFinancialPosting(tx, completed.id)
      ?? await createFinancialPosting(tx, {
        tripId: completed.id,
        tripVersion: completed.version,
        reason: 'COMPLETION',
        governanceActionId: action.id,
        effectiveAt: completed.completedAt ?? new Date(),
      });
    await captureProfitabilityAttributionSnapshot(tx, completed.id, financialPosting.id);
    return {
      ledgerEntryId: null,
      applicationResult: {
        subjectType: 'TRIP',
        subjectId: trip.id,
        resultingVersion: completed.version,
        status: completed.status,
        completedAt: completed.completedAt,
        financialPostingVersionId: financialPosting.id,
      },
    };
  }

  if (kind === 'TRIP_FINANCIAL_CHANGE') {
    const after = action.afterSnapshot as Record<string, unknown> | null;
    if (after?.operation === 'CANCEL_COMPLETED') {
      const canceled = await transitionTripStatus(
        trip.id,
        TripStatus.CANCELED,
        action.approverId!,
        action.approverRole!,
        false,
        false,
        {
          expectedVersion: action.originalVersion,
          transaction: tx,
          governanceActionId: action.id,
        },
      );
      if (canceled.driverId) {
        await removeTripWorkDays(canceled.driverId, canceled.id, tx);
      }
      const cancellationPosting = await getFinancialPostingForGovernanceAction(
        tx,
        canceled.id,
        action.id,
        'CANCELLATION',
      );
      if (!cancellationPosting) {
        throw new ApiError(409, 'Không tìm thấy phiên bản hạch toán hủy chuyến vừa tạo');
      }
      await persistNotificationInTx(tx, {
        type: NotificationType.TRIP_CANCELED,
        title: 'Chuyến đã hủy',
        message: `Chuyến ${canceled.tripCode} đã bị hủy`,
        relatedEntityType: 'trips',
        relatedEntityId: canceled.id,
        targetDriverId: canceled.driverId ?? undefined,
      });
      return {
        ledgerEntryId: null,
        applicationResult: {
          subjectType: 'TRIP',
          subjectId: trip.id,
          resultingVersion: canceled.version,
          status: canceled.status,
          financialPostingVersionId: cancellationPosting.id,
        },
      };
    }
    const figures = after?.figures as TripFigureUpdateInput | undefined;
    if (!figures || !Array.isArray(figures.legs) || !figures.fuelMode) {
      throw new ApiError(409, 'Yêu cầu thay đổi tài chính thiếu dữ liệu áp dụng hợp lệ');
    }
    const updated = await updateTripFigures(
      trip.id,
      {
        ...figures,
        expectedVersion: action.originalVersion,
        userId: action.approverId ?? undefined,
        userRole: action.approverRole as Role,
      },
      tx,
      action.id,
    );
    const financialPosting = await getActiveFinancialPosting(tx, updated.id);
    return {
      ledgerEntryId: null,
      applicationResult: {
        subjectType: 'TRIP',
        subjectId: trip.id,
        resultingVersion: updated.version,
        status: updated.status,
        financialPostingVersionId: financialPosting?.id ?? null,
      },
    };
  }

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
    if (trip.status !== 'COMPLETED') {
      throw new ApiError(409, 'Chuyến đi không còn ở trạng thái đã chốt');
    }
    await assertTripCanBeReopened(tx, trip.id);

    // O2C C2: reverse the canonical completion ledger entries so the reopen
    // is balanced. Mirrors the CANCELED-completed-trip reversal in
    // trip-status-machine.service.ts. Also retire the active financial posting
    // and clear completedAt so the trip is cleanly back to IN_TRANSIT.
    const ancillaryFees = await tx.select().from(s.tripExpenses)
      .where(eq(s.tripExpenses.tripId, trip.id));
    const activePosting = await getActiveFinancialPosting(tx, trip.id);
    if (activePosting) {
      await LedgerService.postTripCompletionReverse(tx, {
        id: trip.id,
        tripCode: trip.tripCode,
        customerId: trip.customerId,
        driverId: trip.driverId ?? null,
        revenue: trip.revenue,
        fuelSurchargeAmount: trip.fuelSurchargeAmount,
        driverSalary: trip.driverSalary,
        carrierType: trip.carrierType ?? 'OWN',
        externalEntityId: trip.externalEntityId ?? null,
        externalEntityType: trip.externalEntityType ?? null,
        externalFreightCost: trip.externalFreightCost ?? null,
        fuelSupplierId: trip.fuelSupplierId ?? null,
        totalFuelCost: trip.totalFuelCost,
        ancillaryFees: ancillaryFees.map(fee => ({
          id: fee.id,
          buyAmount: fee.buyAmount,
          sellAmount: fee.sellAmount,
          settlementMethod: fee.settlementMethod,
          supplierId: fee.supplierId ?? null,
          forwarderId: fee.forwarderId ?? null,
          approvalStatus: fee.approvalStatus,
        })),
      }, { strict: false, financialPostingId: activePosting.id });
      // Retire the active posting (mirrors createFinancialPosting's supersession).
      // A new posting is created when the trip is re-completed.
      await tx.update(s.tripFinancialPostings)
        .set({ status: 'REVERSED' })
        .where(and(
          eq(s.tripFinancialPostings.id, activePosting.id),
          eq(s.tripFinancialPostings.status, 'ACTIVE'),
        ));
    }
  }

  const [versionedTrip] = await tx.update(s.trips).set({
    // O2C: reopening a completed trip sends it back to IN_TRANSIT so it can be
    // re-completed (re-running the gates) once corrected.
    ...(kind === 'TRIP_REOPEN' ? {
      status: 'IN_TRANSIT' as const,
      completedAt: null,
    } : {}),
    version: sql`${s.trips.version} + 1`,
    updatedAt: new Date(),
  }).where(and(
    eq(s.trips.id, trip.id),
    eq(s.trips.version, action.originalVersion),
    ...(kind === 'TRIP_REOPEN' ? [eq(s.trips.status, 'COMPLETED')] : []),
  )).returning({ id: s.trips.id });
  if (!versionedTrip) {
    throw new ApiError(409, 'Dữ liệu gốc đã thay đổi; yêu cầu này không thể áp dụng');
  }

  return {
    ledgerEntryId,
    applicationResult: {
      subjectType: 'TRIP',
      subjectId: trip.id,
      resultingVersion: action.originalVersion + 1,
    },
  };
}

export async function listTripGovernanceActions(tripId: number) {
  return db.select().from(s.governanceActions)
    .where(and(
      eq(s.governanceActions.subjectType, 'TRIP'),
      eq(s.governanceActions.subjectId, tripId),
    ))
    .orderBy(desc(s.governanceActions.id));
}

/**
 * 2026-09-10 user directive: remove all phê duyệt (approval) flows. Governed
 * requests run their check and approve stages immediately with the requesting
 * actor — validations, apply adapters, ledger entries, and audit rows are all
 * unchanged; only the wait-for-a-second-person step is gone.
 */
export async function autoApplyGovernanceAction<T extends { id: number; version: number }>(input: {
  make: (tx: Tx) => Promise<T>;
  approve?: (args: {
    actionId: number;
    approverId: number;
    approverRole: string;
    expectedVersion: number;
    transaction?: Tx;
  }) => Promise<T>;
  actorId: number;
  actorRole: string;
  transaction?: Tx;
}): Promise<T> {
  const approve = input.approve ?? (async (args) => approveGovernanceAction(args) as Promise<T>);
  const run = async (tx: Tx): Promise<T> => {
    const requested = await input.make(tx);
    const checked = await checkGovernanceAction({
      actionId: requested.id,
      checkerId: input.actorId,
      checkerRole: input.actorRole,
      expectedVersion: requested.version,
      transaction: tx,
    });
    return approve({
      actionId: requested.id,
      approverId: input.actorId,
      approverRole: input.actorRole,
      expectedVersion: checked.version,
      transaction: tx,
    });
  };
  if (input.transaction) return run(input.transaction);
  return db.transaction(run) as Promise<T>;
}
