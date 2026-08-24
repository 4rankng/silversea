// Billing-document source invariants: trip-claim seeding/replacement,
// recoverable-expense claimability, trip-source claimability, line provenance
// resolution, corrections listing, and the totals/adjustment math. Extracted
// from billing-document.service.ts verbatim (pure code movement); the CRUD
// core imports these one-way.
import { db } from '../db';
import * as s from '../db/schema';
import { eq, and, isNull, inArray, desc, sql } from 'drizzle-orm';
import { ApiError } from '../errors';
import { customerTripReceivableAmount } from './ledger.service';
import type { BillingDocument } from '@tingting/shared';
import type { BillingDocumentLine } from '@tingting/shared';
import {
  effectiveAmount,
  postingChecksum,
  buildExpenseSourceVersionToken,
  buildTripBlockedReason,
  loadLatestPodStatusByTrip,
  type CustomerDebitTripCandidate,
} from './billing-document-shared.service';
import { lockApplicationOwnedUniquenessSet } from './application-owned-uniqueness.service';
import type { Tx } from './trip-shared';
import type { DbLike } from './billing-document-identity.service';

export type TripClaimSeed = {
  tripId: number;
  financialPostingId: number;
  financialPostingVersion: number;
  postingChecksum: string;
};
export function tripSourceIds(lines: readonly BillingDocumentLine[]): number[] {
  return [...new Set(lines
    .filter(line => line.sourceType === 'TRIP' && line.sourceId != null)
    .map(line => line.sourceId as number))]
    .sort((left, right) => left - right);
}

export async function previewRecoverableTripIds(
  tx: Tx,
  lines: readonly BillingDocumentLine[],
): Promise<number[]> {
  const expenseIds = recoverableExpenseLines(lines)
    .map((line) => line.sourceId as number)
    .sort((left, right) => left - right);
  if (expenseIds.length === 0) return [];
  const rows = await tx.select({
    tripId: s.tripExpenses.tripId,
  })
    .from(s.tripExpenses)
    .where(inArray(s.tripExpenses.id, expenseIds));
  return [...new Set(rows
    .map((row) => row.tripId)
    .filter((tripId): tripId is number => tripId != null))]
    .sort((left, right) => left - right);
}

export async function persistedClaimTripIds(
  tx: Tx,
  documentId: number,
): Promise<number[]> {
  const claimRows = await tx.select({
    tripId: s.billingDocumentTripClaims.tripId,
  })
    .from(s.billingDocumentTripClaims)
    .where(and(
      eq(s.billingDocumentTripClaims.documentId, documentId),
      isNull(s.billingDocumentTripClaims.releasedAt),
    ));
  const activeTripIds = [...new Set(claimRows.map((row) => row.tripId))].sort((left, right) => left - right);
  if (activeTripIds.length > 0) return activeTripIds;

  const tripLineRows = await tx.select({
    tripId: s.billingDocumentLines.sourceId,
  })
    .from(s.billingDocumentLines)
    .where(and(
      eq(s.billingDocumentLines.documentId, documentId),
      eq(s.billingDocumentLines.sourceType, 'TRIP'),
    ));
  const tripIds = tripLineRows
    .map((row) => row.tripId)
    .filter((tripId): tripId is number => tripId != null);
  const expenseRows = await tx.select({
    tripId: s.tripExpenses.tripId,
  })
    .from(s.billingDocumentLines)
    .innerJoin(s.tripExpenses, eq(s.billingDocumentLines.sourceId, s.tripExpenses.id))
    .where(and(
      eq(s.billingDocumentLines.documentId, documentId),
      eq(s.billingDocumentLines.sourceType, 'EXPENSE'),
      eq(s.billingDocumentLines.excluded, false),
    ));
  return [...new Set([
    ...tripIds,
    ...expenseRows
      .map((row) => row.tripId)
      .filter((tripId): tripId is number => tripId != null),
  ])].sort((left, right) => left - right);
}

export async function loadConflictingTripClaim(
  tx: Tx,
  input: {
    tripIds: readonly number[];
    rangeFrom: string;
    rangeTo: string;
    documentId: number;
  },
) {
  if (input.tripIds.length === 0) return null;
  const [conflict] = await tx.select({
    tripId: s.billingDocumentTripClaims.tripId,
    documentId: s.billingDocumentTripClaims.documentId,
    tripCode: s.trips.tripCode,
  })
    .from(s.billingDocumentTripClaims)
    .innerJoin(s.trips, eq(s.billingDocumentTripClaims.tripId, s.trips.id))
    .where(and(
      inArray(s.billingDocumentTripClaims.tripId, [...input.tripIds]),
      isNull(s.billingDocumentTripClaims.releasedAt),
      sql`${s.billingDocumentTripClaims.documentId} <> ${input.documentId}`,
      sql`${s.billingDocumentTripClaims.rangeFrom} <= ${input.rangeTo}`,
      sql`${s.billingDocumentTripClaims.rangeTo} >= ${input.rangeFrom}`,
    ))
    .orderBy(s.billingDocumentTripClaims.tripId, s.billingDocumentTripClaims.documentId)
    .limit(1);
  return conflict ?? null;
}

export async function replaceActiveTripClaims(
  tx: Tx,
  input: {
    documentId: number;
    rangeFrom: string;
    rangeTo: string;
    actorUserId: number | null;
    desiredClaims: readonly TripClaimSeed[];
  },
): Promise<void> {
  const desiredByTripId = new Map<number, TripClaimSeed>();
  for (const claim of input.desiredClaims) {
    desiredByTripId.set(claim.tripId, claim);
  }
  await lockApplicationOwnedUniquenessSet(
    tx,
    [...desiredByTripId.keys()].map((tripId) => ({
      scope: 'billing-document-trip-claim',
      parts: [tripId],
    })),
  );

  const currentClaims = await tx.select({
    id: s.billingDocumentTripClaims.id,
    tripId: s.billingDocumentTripClaims.tripId,
    financialPostingId: s.billingDocumentTripClaims.financialPostingId,
    financialPostingVersion: s.billingDocumentTripClaims.financialPostingVersion,
    postingChecksum: s.billingDocumentTripClaims.postingChecksum,
  })
    .from(s.billingDocumentTripClaims)
    .where(and(
      eq(s.billingDocumentTripClaims.documentId, input.documentId),
      isNull(s.billingDocumentTripClaims.releasedAt),
    ))
    .orderBy(s.billingDocumentTripClaims.tripId)
    .for('update');

  const conflict = await loadConflictingTripClaim(tx, {
    tripIds: [...desiredByTripId.keys()],
    rangeFrom: input.rangeFrom,
    rangeTo: input.rangeTo,
    documentId: input.documentId,
  });
  if (conflict) {
    throw new ApiError(
      409,
      `Chuyến ${conflict.tripCode ?? 'chưa có mã'} đã thuộc một giấy báo nợ trong kỳ bị chồng lấn.`,
    );
  }

  const currentByTripId = new Map(currentClaims.map((claim) => [claim.tripId, claim]));
  const releaseIds = currentClaims
    .filter((claim) => !desiredByTripId.has(claim.tripId))
    .map((claim) => claim.id);
  if (releaseIds.length > 0) {
    await tx.update(s.billingDocumentTripClaims)
      .set({
        releasedAt: new Date(),
        releasedBy: input.actorUserId,
        releaseReason: 'SOURCE_REMOVED',
      })
      .where(inArray(s.billingDocumentTripClaims.id, releaseIds));
  }

  for (const [tripId, desired] of desiredByTripId) {
    const current = currentByTripId.get(tripId);
    if (!current) continue;
    if (
      current.financialPostingId !== desired.financialPostingId
      || current.financialPostingVersion !== desired.financialPostingVersion
      || current.postingChecksum !== desired.postingChecksum
    ) {
      await tx.update(s.billingDocumentTripClaims)
        .set({
          rangeFrom: input.rangeFrom,
          rangeTo: input.rangeTo,
          financialPostingId: desired.financialPostingId,
          financialPostingVersion: desired.financialPostingVersion,
          postingChecksum: desired.postingChecksum,
        })
        .where(eq(s.billingDocumentTripClaims.id, current.id));
    } else {
      await tx.update(s.billingDocumentTripClaims)
        .set({
          rangeFrom: input.rangeFrom,
          rangeTo: input.rangeTo,
        })
        .where(eq(s.billingDocumentTripClaims.id, current.id));
    }
  }

  const insertRows = [...desiredByTripId.values()]
    .filter((claim) => !currentByTripId.has(claim.tripId))
    .map((claim) => ({
      documentId: input.documentId,
      tripId: claim.tripId,
      rangeFrom: input.rangeFrom,
      rangeTo: input.rangeTo,
      financialPostingId: claim.financialPostingId,
      financialPostingVersion: claim.financialPostingVersion,
      postingChecksum: claim.postingChecksum,
      createdBy: input.actorUserId,
    }));
  if (insertRows.length === 0) return;

  await tx.insert(s.billingDocumentTripClaims).values(insertRows);
}

export function assertDraftDocumentLinesEditable(status: string | null): void {
  if ((status ?? 'DRAFT') !== 'DRAFT') {
    throw new ApiError(
      409,
      'Giấy báo nợ đã phát hành hoặc khóa — không thể thay đổi nguồn hoặc nội dung dòng.',
    );
  }
}

export function docTotal(lines: BillingDocumentLine[]): number {
  return lines.reduce((sum, l) => sum + effectiveAmount(l), 0);
}

/**
 * Amount this debit note adds to (or removes from) AR beyond the amounts that
 * trip-lock authority already posted. Freight and approved recoverable fees
 * contribute only their governed delta; ad-hoc rows contribute in full.
 */
export function documentLedgerAdjustment(lines: BillingDocumentLine[]): number {
  return Math.round(lines.reduce((sum, line) => {
    const effective = effectiveAmount(line);
    // Trip revenue and approved sell-side recoverable fees are both posted by
    // trip-lock authority. A Debit Note must never post either source twice.
    return sum + (
      line.sourceType === 'ADHOC'
        ? effective
        : effective - Number(line.baseAmount)
    );
  }, 0));
}

export function recoverableExpenseLines(lines: readonly BillingDocumentLine[]): BillingDocumentLine[] {
  return lines.filter((line) => (
    line.sourceType === 'EXPENSE'
    && line.sourceId != null
    && !line.excluded
    && effectiveAmount(line) > 0
  ));
}

export async function assertRecoverableSourcesClaimable(
  tx: Tx,
  input: {
    documentId: number;
    customerId: number;
    rangeFrom: string;
    rangeTo: string;
    lines: readonly BillingDocumentLine[];
    actorUserId: number | null;
  },
): Promise<TripClaimSeed[]> {
  const sourceLines = recoverableExpenseLines(input.lines);
  const expenseIds = sourceLines
    .map((line) => line.sourceId as number)
    .sort((left, right) => left - right);
  if (expenseIds.length === 0) {
    await tx.delete(s.billingDocumentRecoverableClaims)
      .where(eq(s.billingDocumentRecoverableClaims.documentId, input.documentId));
    return [];
  }
  if (new Set(expenseIds).size !== expenseIds.length) {
    throw new ApiError(409, 'Một chi phí thu hộ chỉ được xuất hiện một lần trên Giấy báo nợ.');
  }
  await lockApplicationOwnedUniquenessSet(
    tx,
    expenseIds.map((expenseId) => ({
      scope: 'billing-document-recoverable-claim',
      parts: [expenseId],
    })),
  );

  const expenses = await tx.select({
    id: s.tripExpenses.id,
    version: s.tripExpenses.version,
    approvalStatus: s.tripExpenses.approvalStatus,
    sellAmount: s.tripExpenses.sellAmount,
    recoverablePrincipalAmount: s.tripExpenses.recoverablePrincipalAmount,
    serviceFeeAmount: s.tripExpenses.serviceFeeAmount,
    expenseType: s.tripExpenses.expenseType,
    expenseDate: s.tripExpenses.expenseDate,
    invoiceNumber: s.tripExpenses.invoiceNumber,
    invoiceDate: s.tripExpenses.invoiceDate,
    declarationNumber: s.tripExpenses.declarationNumber,
    noInvoiceEvidenceTypes: s.tripExpenses.noInvoiceEvidenceTypes,
    updatedAt: s.tripExpenses.updatedAt,
    tripId: s.tripExpenses.tripId,
    tripCode: s.trips.tripCode,
    tripStatus: s.trips.status,
    tripVersion: s.trips.version,
    financialPostingId: s.tripFinancialPostings.id,
    financialPostingVersion: s.tripFinancialPostings.version,
    financialPostingTripVersion: s.tripFinancialPostings.tripVersion,
    financialPostingReason: s.tripFinancialPostings.reason,
    financialPostingEffectiveAt: s.tripFinancialPostings.effectiveAt,
    tripCustomerId: s.trips.customerId,
    shipmentId: s.trips.shipmentId,
    fulfillmentId: s.trips.fulfillmentId,
    completionDate: sql<string | null>`to_char(${s.trips.completedAt} at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD')`,
    shipmentCustomerId: s.shipments.customerId,
  })
    .from(s.tripExpenses)
    .innerJoin(s.trips, eq(s.tripExpenses.tripId, s.trips.id))
    .innerJoin(s.tripFinancialPostings, and(
      eq(s.tripFinancialPostings.tripId, s.trips.id),
      eq(s.tripFinancialPostings.status, 'ACTIVE'),
    ))
    .innerJoin(s.shipments, eq(s.trips.shipmentId, s.shipments.id))
    .where(and(
      inArray(s.tripExpenses.id, expenseIds),
      isNull(s.trips.deletedAt),
      isNull(s.shipments.deletedAt),
    ))
    .orderBy(s.tripExpenses.id)
    .for('update');
  if (expenses.length !== expenseIds.length) {
    throw new ApiError(409, 'Có chi phí không còn gắn với lô hàng hợp lệ. Vui lòng tạo lại bản nháp.');
  }
  const latestPodByTrip = await loadLatestPodStatusByTrip(
    [...new Set(expenses
      .map((expense) => expense.tripId)
      .filter((tripId): tripId is number => tripId != null))],
    tx,
  );

  const existingClaims = await tx.select({
    expenseId: s.billingDocumentRecoverableClaims.expenseId,
    documentId: s.billingDocumentRecoverableClaims.documentId,
  })
    .from(s.billingDocumentRecoverableClaims)
    .where(and(
      inArray(s.billingDocumentRecoverableClaims.expenseId, expenseIds),
      isNull(s.billingDocumentRecoverableClaims.releasedAt),
    ));
  const competing = existingClaims.find((claim) => claim.documentId !== input.documentId);
  if (competing) {
    throw new ApiError(
      409,
      'Chi phí đã chọn đã thuộc một giấy báo nợ khác.',
    );
  }

  const lineByExpense = new Map(sourceLines.map((line) => [line.sourceId as number, line]));
  const tripClaimsByTripId = new Map<number, TripClaimSeed>();
  const claimRows = expenses.map((expense) => {
    const line = lineByExpense.get(expense.id)!;
    const sellAmount = Number(expense.sellAmount ?? 0);
    const principal = expense.recoverablePrincipalAmount == null
      ? null
      : Number(expense.recoverablePrincipalAmount);
    const fee = expense.serviceFeeAmount == null ? null : Number(expense.serviceFeeAmount);
    const sourceVersion = buildExpenseSourceVersionToken(expense);
    if (
      expense.approvalStatus !== 'APPROVED'
      || sellAmount <= 0
      || principal == null
      || fee == null
      || principal < 0
      || fee < 0
      || principal + fee !== sellAmount
    ) {
      throw new ApiError(
        409,
        'Chi phí đã chọn chưa đủ điều kiện thu lại khách hàng hoặc chưa phân loại tiền chi hộ/phí dịch vụ.',
      );
    }
    if (expense.tripId == null) {
      throw new ApiError(409, 'Chi phí đã chọn không còn gắn chuyến hợp lệ. Vui lòng tạo lại bản nháp.');
    }
    if (
      expense.tripCustomerId !== input.customerId
      || expense.shipmentCustomerId !== input.customerId
      || expense.shipmentId == null
    ) {
      throw new ApiError(409, 'Chi phí đã chọn không thuộc đúng khách hàng của giấy báo nợ.');
    }
    const blockedReason = buildTripBlockedReason({
      customerId: expense.tripCustomerId,
      shipmentId: expense.shipmentId,
      fulfillmentId: expense.fulfillmentId,
      shipmentCustomerId: expense.shipmentCustomerId,
      status: expense.tripStatus ?? '',
    }, input.customerId, latestPodByTrip.get(expense.tripId));
    if (blockedReason) {
      throw new ApiError(
        409,
        `Chi phí thuộc chuyến ${expense.tripCode ?? 'chưa có mã'} không đủ điều kiện xuất giấy báo nợ: ${blockedReason}`,
      );
    }
    if (!expense.expenseDate || expense.expenseDate < input.rangeFrom || expense.expenseDate > input.rangeTo) {
      throw new ApiError(409, 'Ngày của chi phí đã chọn nằm ngoài kỳ giấy báo nợ.');
    }
    if (!sourceVersion || renderSourceVersion(line) !== sourceVersion) {
      throw new ApiError(409, 'Chi phí đã chọn đã thay đổi. Vui lòng tạo lại bản nháp.');
    }
    if (
      Number(line.baseAmount) !== sellAmount
      || (line.amountOverride != null && Number(line.amountOverride) !== sellAmount)
    ) {
      throw new ApiError(409, 'Số tiền chi phí đã chọn không khớp nguồn đã phê duyệt.');
    }
    tripClaimsByTripId.set(expense.tripId, {
      tripId: expense.tripId,
      financialPostingId: expense.financialPostingId,
      financialPostingVersion: expense.financialPostingVersion,
      postingChecksum: postingChecksum({
        id: expense.financialPostingId,
        tripId: expense.tripId,
        version: expense.financialPostingVersion,
        tripVersion: expense.financialPostingTripVersion,
        reason: expense.financialPostingReason,
        effectiveAt: expense.financialPostingEffectiveAt,
      }),
    });
    return {
      documentId: input.documentId,
      expenseId: expense.id,
      expenseVersion: expense.version,
      sourceVersion,
      evidenceSnapshot: {
        tripId: expense.tripId,
        shipmentId: expense.shipmentId,
        customerId: expense.tripCustomerId,
        expenseType: expense.expenseType,
        expenseDate: expense.expenseDate,
        invoiceNumber: expense.invoiceNumber,
        invoiceDate: expense.invoiceDate,
        declarationNumber: expense.declarationNumber,
        noInvoiceEvidenceTypes: expense.noInvoiceEvidenceTypes,
        recoverablePrincipalAmount: principal,
        serviceFeeAmount: fee,
        sellAmount,
      },
      createdBy: input.actorUserId,
    };
  });

  await tx.delete(s.billingDocumentRecoverableClaims)
    .where(eq(s.billingDocumentRecoverableClaims.documentId, input.documentId));
  await tx.insert(s.billingDocumentRecoverableClaims).values(claimRows);
  return [...tripClaimsByTripId.values()].sort((left, right) => left.tripId - right.tripId);
}

export async function assertTripSourcesClaimable(
  tx: Tx,
  input: {
    customerId: number;
    rangeFrom: string;
    rangeTo: string;
    lines: readonly BillingDocumentLine[];
  },
): Promise<TripClaimSeed[]> {
  const sourceLines = input.lines.filter((line) => line.sourceType === 'TRIP' && line.sourceId != null);
  const tripIds = sourceLines
    .map((line) => line.sourceId as number)
    .sort((left, right) => left - right);
  if (tripIds.length === 0) return [];
  if (new Set(tripIds).size !== tripIds.length) {
    throw new ApiError(409, 'Một chuyến chỉ được xuất hiện một lần trên Giấy báo nợ.');
  }

  const trips = await tx.select({
    id: s.trips.id,
    tripCode: s.trips.tripCode,
    customerId: s.trips.customerId,
    shipmentId: s.trips.shipmentId,
    fulfillmentId: s.trips.fulfillmentId,
    status: s.trips.status,
    departureDate: s.trips.departureDate,
    completionDate: sql<string | null>`to_char(${s.trips.completedAt} at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD')`,
    revenue: s.trips.revenue,
    fuelSurchargeAmount: s.trips.fuelSurchargeAmount,
    routeName: s.routes.name,
    notes: s.trips.notes,
    truckPlate: s.trucks.licensePlate,
    trailerPlateNumber: s.trailers.licensePlate,
    externalPlateNumber: s.trips.externalPlateNumber,
    version: s.trips.version,
    vatRate: s.trips.vatRate,
    updatedAt: s.trips.updatedAt,
    financialPostingId: s.tripFinancialPostings.id,
    financialPostingVersion: s.tripFinancialPostings.version,
    financialPostingTripVersion: s.tripFinancialPostings.tripVersion,
    financialPostingReason: s.tripFinancialPostings.reason,
    financialPostingEffectiveAt: s.tripFinancialPostings.effectiveAt,
    shipmentCustomerId: s.shipments.customerId,
    tradeDirection: s.shipments.tradeDirection,
    billNumber: s.shipments.blNumber,
    factoryName: sql<string | null>`coalesce(${s.operationalSites.name}, ${s.shipments.factoryName})`,
    expectedDeliveryDate: s.shipments.expectedDeliveryDate,
    cargoVolumeCbm: s.shipments.cargoVolumeCbm,
    packageCount: s.shipments.packageCount,
    packageType: s.shipments.packageType,
  }).from(s.trips)
    .innerJoin(s.tripFinancialPostings, and(
      eq(s.tripFinancialPostings.tripId, s.trips.id),
      eq(s.tripFinancialPostings.status, 'ACTIVE'),
    ))
    .leftJoin(s.routes, eq(s.trips.routeId, s.routes.id))
    .leftJoin(s.trucks, eq(s.trips.truckId, s.trucks.id))
    .leftJoin(s.trailers, eq(s.trips.trailerId, s.trailers.id))
    .leftJoin(s.shipments, eq(s.trips.shipmentId, s.shipments.id))
    .leftJoin(s.operationalSites, eq(s.shipments.operationalSiteId, s.operationalSites.id))
    .where(and(
      inArray(s.trips.id, tripIds),
      isNull(s.trips.deletedAt),
    ))
    .orderBy(s.trips.id) as CustomerDebitTripCandidate[];
  if (trips.length !== tripIds.length) {
    throw new ApiError(409, 'Có chuyến không còn tồn tại hoặc không còn gắn lô hàng hợp lệ. Vui lòng tạo lại bản nháp.');
  }

  const latestPodByTrip = await loadLatestPodStatusByTrip(tripIds, tx);
  const tripById = new Map(trips.map((trip) => [trip.id, trip]));
  const claims: TripClaimSeed[] = [];
  for (const line of sourceLines) {
    const tripId = line.sourceId as number;
    const trip = tripById.get(tripId);
    if (!trip) {
      throw new ApiError(409, 'Chuyến đã chọn không còn tồn tại. Vui lòng tạo lại bản nháp.');
    }
    const blockedReason = buildTripBlockedReason(trip, input.customerId, latestPodByTrip.get(tripId));
    if (blockedReason) {
      throw new ApiError(
        409,
        `Chuyến ${trip.tripCode ?? 'chưa có mã'} không đủ điều kiện xuất giấy báo nợ: ${blockedReason}`,
      );
    }
    if (!trip.completionDate || trip.completionDate < input.rangeFrom || trip.completionDate > input.rangeTo) {
      throw new ApiError(
        409,
        `Chuyến ${trip.tripCode ?? 'chưa có mã'} không có ngày hoàn thành nằm trong kỳ giấy báo nợ.`,
      );
    }
    const checksum = postingChecksum({
      id: trip.financialPostingId,
      tripId: trip.id,
      version: trip.financialPostingVersion,
      tripVersion: trip.financialPostingTripVersion,
      reason: trip.financialPostingReason,
      effectiveAt: trip.financialPostingEffectiveAt,
    });
    if (
      line.financialPostingId !== trip.financialPostingId
      || line.financialPostingVersion !== trip.financialPostingVersion
      || line.postingChecksum !== checksum
    ) {
      throw new ApiError(409, `Nguồn hạch toán chuyến ${trip.tripCode ?? 'chưa có mã'} đã thay đổi. Vui lòng tạo lại bản nháp.`);
    }
    if (Number(line.baseAmount) !== customerTripReceivableAmount(trip.revenue, trip.fuelSurchargeAmount)) {
      throw new ApiError(409, `Doanh thu chuyến ${trip.tripCode ?? 'chưa có mã'} không còn khớp nguồn hiện tại.`);
    }
    claims.push({
      tripId: trip.id,
      financialPostingId: trip.financialPostingId,
      financialPostingVersion: trip.financialPostingVersion,
      postingChecksum: checksum,
    });
  }
  return claims;
}

export function renderSourceVersion(line: Pick<BillingDocumentLine, 'renderData'>): string | null {
  const raw = line.renderData?.sourceVersion;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

export function renderSourceChangedAt(line: Pick<BillingDocumentLine, 'renderData'>): string | null {
  const raw = line.renderData?.sourceChangedAt;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

export function lineColumnSourceVersion(line: { sourceVersion?: string | null }): string | null {
  return typeof line.sourceVersion === 'string' && line.sourceVersion.trim()
    ? line.sourceVersion.trim()
    : null;
}

export function lineColumnSourceChangedAt(
  line: { sourceChangedAt?: Date | string | null },
): string | null {
  if (!line.sourceChangedAt) return null;
  const value = line.sourceChangedAt instanceof Date
    ? line.sourceChangedAt
    : new Date(line.sourceChangedAt);
  return Number.isNaN(value.getTime()) ? null : value.toISOString();
}

export async function loadLineProvenance(
  line: BillingDocumentLine,
  executor: DbLike = db,
): Promise<BillingDocumentLine['provenance']> {
  if (line.sourceType === 'ADHOC' || line.sourceId == null) return null;

  const storedVersion = renderSourceVersion(line);
  const storedChangedAt = renderSourceChangedAt(line);

  if (line.sourceType === 'TRIP') {
    const [posting] = await executor.select().from(s.tripFinancialPostings)
      .where(and(
        eq(s.tripFinancialPostings.tripId, line.sourceId),
        eq(s.tripFinancialPostings.status, 'ACTIVE'),
      ))
      .limit(1);

    if (!posting) {
      return {
        sourceVersion: line.postingChecksum ?? storedVersion,
        currentSourceVersion: null,
        sourceChangedAt: storedChangedAt,
        status: 'REMOVED',
        reason: 'Nguồn hạch toán chuyến không còn hiệu lực',
      };
    }

    const currentVersion = postingChecksum(posting);
    const isCurrent = line.financialPostingId === posting.id
      && line.financialPostingVersion === posting.version
      && line.postingChecksum === currentVersion;
    return {
      sourceVersion: line.postingChecksum ?? storedVersion,
      currentSourceVersion: currentVersion,
      sourceChangedAt: posting.effectiveAt.toISOString(),
      status: isCurrent ? 'CURRENT' : 'STALE',
      reason: isCurrent ? null : 'Nguồn hạch toán chuyến đã thay đổi sau khi lưu giấy báo nợ',
    };
  }

  const [expense] = await executor.select({
    id: s.tripExpenses.id,
    approvalStatus: s.tripExpenses.approvalStatus,
    sellAmount: s.tripExpenses.sellAmount,
    updatedAt: s.tripExpenses.updatedAt,
  })
    .from(s.tripExpenses)
    .where(eq(s.tripExpenses.id, line.sourceId))
    .limit(1);

  if (!expense) {
    return {
      sourceVersion: storedVersion,
      currentSourceVersion: null,
      sourceChangedAt: storedChangedAt,
      status: 'REMOVED',
      reason: 'Nguồn chi phí không còn tồn tại',
    };
  }

  const currentVersion = expense.approvalStatus === 'APPROVED'
    ? buildExpenseSourceVersionToken(expense)
    : null;
  const removedReason = expense.approvalStatus === 'APPROVED'
    ? null
    : 'Chi phí không còn ở trạng thái APPROVED';
  return {
    sourceVersion: storedVersion,
    currentSourceVersion: currentVersion,
    sourceChangedAt: expense.updatedAt.toISOString(),
    status: currentVersion == null
      ? 'REMOVED'
      : storedVersion === currentVersion
        ? 'CURRENT'
        : 'STALE',
    reason: currentVersion == null
      ? removedReason
      : storedVersion === currentVersion
        ? null
        : 'Nguồn chi phí đã thay đổi sau khi lưu giấy báo nợ',
  };
}

export async function listDocumentCorrections(
  documentId: number,
  executor: DbLike = db,
): Promise<NonNullable<BillingDocument['corrections']>> {
  const actions = await executor.select({
    id: s.governanceActions.id,
    status: s.governanceActions.status,
    reason: s.governanceActions.reason,
    createdAt: s.governanceActions.createdAt,
    approvedAt: s.governanceActions.approvedAt,
    appliedAt: s.governanceActions.appliedAt,
    ledgerEntryId: s.governanceActions.ledgerEntryId,
    deltaSnapshot: s.governanceActions.deltaSnapshot,
    applicationResult: s.governanceActions.applicationResult,
  })
    .from(s.governanceActions)
    .where(and(
      eq(s.governanceActions.subjectType, 'BILLING_DOCUMENT'),
      eq(s.governanceActions.subjectId, documentId),
      eq(s.governanceActions.actionKind, 'DEBIT_NOTE_ADJUSTMENT'),
    ))
    .orderBy(desc(s.governanceActions.createdAt));

  return actions.map((action) => ({
    actionId: action.id,
    status: action.status,
    reason: action.reason,
    amount: Number((action.deltaSnapshot as Record<string, unknown> | null)?.adjustmentAmount ?? 0),
    createdAt: action.createdAt.toISOString(),
    approvedAt: action.approvedAt?.toISOString() ?? null,
    appliedAt: action.appliedAt?.toISOString() ?? null,
    ledgerEntryId: action.ledgerEntryId ?? null,
    applicationResult: (action.applicationResult as Record<string, unknown> | null) ?? null,
  }));
}
