import { db } from '../db';
import { runInTx } from '../lib/tx';
import * as s from '../db/schema';
import { eq, and, isNull, inArray, desc, or, sql, like, type SQL } from 'drizzle-orm';
import { ApiError } from '../errors';
import { customerTripReceivableAmount, LedgerService } from './ledger.service';
import { canonicalFreightDescription, TxnType } from '@tingting/shared';
import { companyInfoFromSettings, getCompanyInfo } from './company-info.service';
import type { Tx } from './trip-shared';
export type DbLike = typeof db | Tx;
import { loadLogoBytes } from './lib/export-company';
import {
  resolveCustomerPaymentDueDate,
  type PaymentDatePolicy,
} from './business-calendar.service';
import {
  assertDebitNotePeriodWritable,
  replaceBillingDocumentSourcePeriodLocks,
  resolveBillingDocumentSourcePeriodLocks,
  resolveDebitNotePeriodAuthority,
} from './period-lock.service';
import { lockTripFinancialAuthority } from './trip-financial-authority-lock.service';
import {
  checkBillingDocumentOverlap,
  lockBillingDocumentOverlapAuthority,
} from './billing-overlap-guard.service';
import {
  lockApplicationOwnedUniquenessSet,
} from './application-owned-uniqueness.service';
import type {
  BillingDocument,
  BillingDocumentLine,
  BillingLineRenderData,
  BillingDocumentType,
  BillingDocumentEntityType,
  SaveBillingDocumentInput,
  DebitNoteTemplateSnapshot,
  BillingDocumentOfficialIdentitySnapshot,
} from '@tingting/shared';
import {
  effectiveAmount,
  postingChecksum,
  documentVatTotals,
  VAT_TREATMENT_VERSION,
  buildExpenseSourceVersionToken,
  buildTripBlockedReason,
  loadLatestPodStatusByTrip,
  type CustomerDebitTripCandidate,
} from './billing-document-shared.service';
import {
  defaultSnapshotForType,
  resolveDebitNoteTemplate,
  templateToSnapshot,
} from './billing-document-template.service';
import { buildCustomerDebitLines } from './billing-document-draft.service';

// Template CRUD, draft generation, and the shared money/checksum/VAT helpers
// were split into billing-document-template.service.ts,
// billing-document-draft.service.ts, and billing-document-shared.service.ts
// (shared is the leaf both core and draft import from). Their
// previously-public symbols are re-exported here so every existing importer of
// this module keeps working unchanged.
export {
  effectiveAmount,
  postingChecksum,
  calculateVatSnapshot,
  buildTripSourceVersionToken,
  buildExpenseSourceVersionToken,
} from './billing-document-shared.service';
export {
  cloneTemplateSnapshot,
  DEFAULT_DEBIT_NOTE_COLUMNS,
  DEFAULT_PAYMENT_STATEMENT_COLUMNS,
  normalizeTemplateColumns,
  getDebitNoteTemplate,
  defaultSnapshotForType,
  getDefaultDebitNoteTemplate,
  resolveDebitNoteTemplate,
  templateToSnapshot,
  resolveDebitNoteTemplateForDoc,
} from './billing-document-template.service';
export {
  containerNumbers,
  containerUnit,
  expenseDocumentCode,
  splitRouteName,
  buildTripRenderData,
  loadContainersByTrip,
  loadLegRenderDataByTrip,
  generateDraft,
} from './billing-document-draft.service';


// ─── Helpers ──────────────────────────────────────────────────────────────────

/** DB stores containers as comma-joined text (this schema avoids PG arrays). */
export function splitContainers(raw: string | null): string[] | null {
  if (!raw) return null;
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  return parts.length > 0 ? parts : null;
}
export function joinContainers(list: string[] | null | undefined): string | null {
  if (!list || list.length === 0) return null;
  return list.filter(Boolean).join(', ');
}

type TripClaimSeed = {
  tripId: number;
  financialPostingId: number;
  financialPostingVersion: number;
  postingChecksum: string;
};

export type OfficialBillingIdentitySnapshot = BillingDocumentOfficialIdentitySnapshot;

export type FrozenDebitNoteTemplateSnapshot = DebitNoteTemplateSnapshot & {
  officialIdentity?: OfficialBillingIdentitySnapshot | null;
};

export function trimIdentityValue(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function stripHonorifics(value: string): string {
  return value.replace(/^Ông\s+|^Bà\s+/i, '').trim();
}


export function extractOfficialIdentitySnapshot(
  snapshot: DebitNoteTemplateSnapshot | null | undefined,
): OfficialBillingIdentitySnapshot | null {
  const raw = (snapshot as FrozenDebitNoteTemplateSnapshot | null | undefined)?.officialIdentity;
  if (!raw) return null;
  return {
    issuer: { ...raw.issuer },
    counterparty: { ...raw.counterparty },
    signatures: { ...raw.signatures },
    captureMetadata: { ...raw.captureMetadata },
  };
}

export async function loadCompanyInfoFromExecutor(executor: DbLike = db, lockRows = false) {
  const query = executor.select({
    key: s.appSettings.key,
    value: s.appSettings.value,
    updatedAt: s.appSettings.updatedAt,
  })
    .from(s.appSettings)
    .where(like(s.appSettings.key, 'company.%'));
  const rows = await (lockRows ? query.for('share') : query);
  return companyInfoFromSettings(rows);
}

function tripSourceIds(lines: readonly BillingDocumentLine[]): number[] {
  return [...new Set(lines
    .filter(line => line.sourceType === 'TRIP' && line.sourceId != null)
    .map(line => line.sourceId as number))]
    .sort((left, right) => left - right);
}

async function previewRecoverableTripIds(
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

async function persistedClaimTripIds(
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

async function loadConflictingTripClaim(
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

async function replaceActiveTripClaims(
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

function recoverableExpenseLines(lines: readonly BillingDocumentLine[]): BillingDocumentLine[] {
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

async function assertTripSourcesClaimable(
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

function renderSourceVersion(line: Pick<BillingDocumentLine, 'renderData'>): string | null {
  const raw = line.renderData?.sourceVersion;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

function renderSourceChangedAt(line: Pick<BillingDocumentLine, 'renderData'>): string | null {
  const raw = line.renderData?.sourceChangedAt;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

function lineColumnSourceVersion(line: { sourceVersion?: string | null }): string | null {
  return typeof line.sourceVersion === 'string' && line.sourceVersion.trim()
    ? line.sourceVersion.trim()
    : null;
}

function lineColumnSourceChangedAt(
  line: { sourceChangedAt?: Date | string | null },
): string | null {
  if (!line.sourceChangedAt) return null;
  const value = line.sourceChangedAt instanceof Date
    ? line.sourceChangedAt
    : new Date(line.sourceChangedAt);
  return Number.isNaN(value.getTime()) ? null : value.toISOString();
}

async function loadLineProvenance(
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

async function listDocumentCorrections(
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


// ─── Persistence + receivables reconciliation ────────────────────────────────

export async function postDebitNoteDelta(
  tx: Tx,
  input: {
    documentId: number;
    customerId: number;
    delta: number;
    originalDueDate?: string | null;
    processingDueDate?: string | null;
    paymentTermDaysApplied?: number | null;
    paymentDatePolicyApplied?: PaymentDatePolicy | null;
  },
): Promise<void> {
  const delta = Math.round(input.delta);
  if (delta === 0) return;
  await LedgerService.postEntry(tx, {
    txnType: TxnType.ADJUSTMENT,
    txnId: input.documentId,
    receiptId: `GBN:${input.documentId}`,
    entityType: 'CUSTOMER',
    entityId: input.customerId,
    debit: delta > 0 ? delta : 0,
    credit: delta < 0 ? Math.abs(delta) : 0,
    note: 'Điều chỉnh công nợ theo giấy báo nợ',
    originalDueDate: input.originalDueDate,
    processingDueDate: input.processingDueDate,
    paymentTermDaysApplied: input.paymentTermDaysApplied,
    paymentDatePolicyApplied: input.paymentDatePolicyApplied,
  });
}

type DebitNoteSaveInput = SaveBillingDocumentInput & { type: 'DEBIT_NOTE' };
type DebitNoteSourceRef =
  | { sourceType: 'TRIP'; sourceId: number; financialPostingId: number; financialPostingVersion: number; postingChecksum: string }
  | { sourceType: 'EXPENSE'; sourceId: number; sourceVersion: string };
type BillingDocumentServiceInput = SaveBillingDocumentInput;

async function deriveDebitNoteLines(input: DebitNoteSaveInput): Promise<BillingDocumentLine[]> {
  const generated = await buildCustomerDebitLines(input.entityId, input.rangeFrom, input.rangeTo);
  const available = generated.lines as BillingDocumentLine[];
  const secureRefs = input.sourceRefs as DebitNoteSourceRef[] | undefined;
  const persistedLines = (input.lines ?? []).map((line) => ({
    ...line,
    renderData: line.renderData ? { ...line.renderData } : null,
    containerNumbers: line.containerNumbers ? [...line.containerNumbers] : null,
  }));
  const refs: DebitNoteSourceRef[] = secureRefs ?? persistedLines.map((line) => {
    if (line.sourceType === 'ADHOC' || line.sourceId == null) {
      throw new ApiError(400, 'Dòng thủ công không thuộc luồng lưu Giấy báo nợ thông thường.');
    }
    if (line.sourceType === 'TRIP') {
      if (
        line.financialPostingId == null
        || line.financialPostingVersion == null
        || !line.postingChecksum
      ) {
        throw new ApiError(409, 'Nguồn chuyến đi thiếu dấu vết hạch toán để lưu giấy báo nợ.');
      }
      return {
        sourceType: 'TRIP' as const,
        sourceId: line.sourceId,
        financialPostingId: line.financialPostingId,
        financialPostingVersion: line.financialPostingVersion,
        postingChecksum: line.postingChecksum,
      };
    }
    const sourceVersion = renderSourceVersion(line);
    if (!sourceVersion) {
      throw new ApiError(409, 'Nguồn chi phí thiếu phiên bản nguồn để lưu giấy báo nợ.');
    }
    return {
      sourceType: 'EXPENSE' as const,
      sourceId: line.sourceId,
      sourceVersion,
    };
  });
  const seen = new Set<string>();
  return refs.map((ref, index) => {
    const key = `${ref.sourceType}:${ref.sourceId}`;
    if (seen.has(key)) throw new ApiError(409, 'Một nguồn chỉ được chọn một lần trên Giấy báo nợ.');
    seen.add(key);

    const currentLine = available.find((candidate) => {
      if (candidate.sourceType !== ref.sourceType || candidate.sourceId !== ref.sourceId) return false;
      if (ref.sourceType === 'TRIP') {
        return candidate.financialPostingId === ref.financialPostingId
          && candidate.financialPostingVersion === ref.financialPostingVersion
          && candidate.postingChecksum === ref.postingChecksum;
      }
      return renderSourceVersion(candidate) === ref.sourceVersion;
    });
    const persistedLine = secureRefs
      ? null
      : persistedLines.find((candidate) => {
          if (candidate.sourceType !== ref.sourceType || candidate.sourceId !== ref.sourceId) return false;
          if (ref.sourceType === 'TRIP') {
            return candidate.financialPostingId === ref.financialPostingId
              && candidate.financialPostingVersion === ref.financialPostingVersion
              && candidate.postingChecksum === ref.postingChecksum;
          }
          return renderSourceVersion(candidate) === ref.sourceVersion;
        });
    const line = currentLine ?? persistedLine;
    if (!line) {
      throw new ApiError(409, 'Nguồn dữ liệu đã thay đổi hoặc không còn đủ điều kiện.');
    }
    return {
      ...line,
      renderData: line.renderData ? { ...line.renderData } : null,
      containerNumbers: line.containerNumbers ? [...line.containerNumbers] : null,
      amountOverride: null,
      excluded: false,
      sortOrder: index,
    };
  });
}

async function assertActiveFinancialPostingRefs(
  tx: Tx,
  lines: readonly BillingDocumentLine[],
): Promise<void> {
  const tripLines = lines.filter((line) => line.sourceType === 'TRIP');
  if (tripLines.length === 0) return;
  const postingIds = tripLines.map((line) => line.financialPostingId as number);
  const rows = await tx.select().from(s.tripFinancialPostings)
    .where(inArray(s.tripFinancialPostings.id, postingIds))
    .orderBy(s.tripFinancialPostings.id)
    .for('update');
  if (rows.length !== postingIds.length) {
    throw new ApiError(409, 'Có nguồn hạch toán không còn tồn tại. Vui lòng tạo lại bản nháp.');
  }
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const line of tripLines) {
    const posting = byId.get(line.financialPostingId as number);
    if (
      !posting
      || posting.status !== 'ACTIVE'
      || posting.tripId !== line.sourceId
      || posting.version !== line.financialPostingVersion
      || postingChecksum(posting) !== line.postingChecksum
    ) {
      throw new ApiError(409, 'Nguồn hạch toán của chuyến đã thay đổi. Vui lòng tạo lại bản nháp.');
    }
  }
}

export async function saveDocument(
  input: BillingDocumentServiceInput,
  userId: number | null,
  transaction?: Tx,
): Promise<BillingDocument> {
  const authoritativeLines = input.type === 'DEBIT_NOTE'
    ? await deriveDebitNoteLines(input as DebitNoteSaveInput)
    : (input.lines ?? (() => { throw new ApiError(400, 'Bảng kê thiếu dòng trình bày.'); })()) as BillingDocumentLine[];
  const totals = documentVatTotals(authoritativeLines);
  const total = totals.gross;
  const desiredAdjustment = input.type === 'DEBIT_NOTE'
    ? documentLedgerAdjustment(authoritativeLines)
    : 0;
  // Resolve the document template and freeze a render-only snapshot onto the doc
  // so re-exports stay stable after the template is edited/deleted.
  let resolvedTemplateId = input.debitNoteTemplateId ?? null;
  if (input.type === 'DEBIT_NOTE' && resolvedTemplateId == null && input.entityType === 'CUSTOMER') {
    const [cust] = await db.select({ tplId: s.customers.debitNoteTemplateId })
      .from(s.customers).where(eq(s.customers.id, input.entityId)).limit(1);
    resolvedTemplateId = cust?.tplId ?? null;
  }
  const template = await resolveDebitNoteTemplate({ templateIdOverride: resolvedTemplateId, docType: input.type });
  const snapshot = template ? templateToSnapshot(template) : defaultSnapshotForType(input.type);
  // One active document per customer/vendor + exact period. Saving the same
  // period replaces it in-place and posts only the accounting delta.
  const execute = async (tx: Tx) => {
    if (input.type === 'DEBIT_NOTE' && input.entityType === 'CUSTOMER') {
      await LedgerService.lockEntity(tx, 'CUSTOMER', input.entityId);
      await lockBillingDocumentOverlapAuthority(tx, input);
      const authority = await resolveDebitNotePeriodAuthority(tx, input.entityId, input.rangeFrom, input.rangeTo);
      await assertDebitNotePeriodWritable(tx, authority);
      const sourceLockIds = await resolveBillingDocumentSourcePeriodLocks(
        tx,
        input.entityId,
        input.rangeFrom,
        input.rangeTo,
        authoritativeLines,
      );
      const dueDateSnapshot = await resolveCustomerPaymentDueDate(tx, input.entityId, input.rangeTo);
      const [existing] = await tx.select().from(s.billingDocuments).where(and(
        eq(s.billingDocuments.type, input.type),
        eq(s.billingDocuments.entityType, input.entityType),
        eq(s.billingDocuments.entityId, input.entityId),
        eq(s.billingDocuments.rangeFrom, input.rangeFrom),
        eq(s.billingDocuments.rangeTo, input.rangeTo),
        isNull(s.billingDocuments.deletedAt),
      )).limit(1).for('update');

      const overlap = await checkBillingDocumentOverlap({
        type: input.type,
        entityType: input.entityType,
        entityId: input.entityId,
        rangeFrom: input.rangeFrom,
        rangeTo: input.rangeTo,
        excludeId: existing?.id,
      }, tx);
      if (overlap.hasOverlap) {
        throw new ApiError(
          409,
          'Kỳ giấy báo nợ bị chồng lấn với tài liệu đang hoạt động. Vui lòng điều chỉnh kỳ hoặc hủy tài liệu cũ.',
        );
      }

      if (existing) {
        const currentTripIds = await persistedClaimTripIds(tx, existing.id);
        const initialTripIds = [...new Set([
          ...currentTripIds,
          ...tripSourceIds(authoritativeLines),
          ...await previewRecoverableTripIds(tx, authoritativeLines),
        ])];
        await lockTripFinancialAuthority(tx, initialTripIds);
        assertDraftDocumentLinesEditable(existing.debitNoteStatus);
        const tripClaims = await assertTripSourcesClaimable(tx, {
          customerId: input.entityId,
          rangeFrom: input.rangeFrom,
          rangeTo: input.rangeTo,
          lines: authoritativeLines,
        });
        const recoverableTripClaims = await assertRecoverableSourcesClaimable(tx, {
          documentId: existing.id,
          customerId: input.entityId,
          rangeFrom: input.rangeFrom,
          rangeTo: input.rangeTo,
          lines: authoritativeLines,
          actorUserId: userId,
        });
        const desiredTripClaims = [...new Map(
          [...tripClaims, ...recoverableTripClaims].map((claim) => [claim.tripId, claim]),
        ).values()];
        const finalTripIds = desiredTripClaims.map((claim) => claim.tripId).sort((left, right) => left - right);
        if (finalTripIds.some((tripId) => !initialTripIds.includes(tripId))) {
          await lockTripFinancialAuthority(tx, [
            ...currentTripIds,
            ...finalTripIds,
          ]);
        }
        await assertActiveFinancialPostingRefs(tx, authoritativeLines);
        const [updated] = await tx.update(s.billingDocuments).set({
          entityName: input.entityName ?? null,
          note: input.note ?? null,
          totalInclVat: String(total),
          totalNet: String(totals.net),
          totalTax: String(totals.tax),
          totalGross: String(totals.gross),
          vatTreatmentVersion: VAT_TREATMENT_VERSION,
          ledgerAdjustmentAmount: String(desiredAdjustment),
          authorityState: 'CURRENT',
          authorityWarningReason: null,
          authorityWarningAt: null,
          updatedAt: new Date(),
          debitNoteTemplateId: template?.id ?? null,
          debitNoteTemplateSnapshot: snapshot,
          version: sql`${s.billingDocuments.version} + 1`,
        }).where(and(
          eq(s.billingDocuments.id, existing.id),
          isNull(s.billingDocuments.deletedAt),
          or(
            isNull(s.billingDocuments.debitNoteStatus),
            eq(s.billingDocuments.debitNoteStatus, 'DRAFT'),
          ),
        )).returning({ id: s.billingDocuments.id });
        if (!updated) {
          throw new ApiError(
            409,
            'Giấy báo nợ vừa được xác nhận hoặc khóa — không thể chỉnh sửa. Vui lòng tải lại.',
          );
        }
        await tx.delete(s.billingDocumentLines).where(eq(s.billingDocumentLines.documentId, existing.id));
        await persistLines(tx, existing.id, authoritativeLines);
        await replaceActiveTripClaims(tx, {
          documentId: existing.id,
          rangeFrom: input.rangeFrom,
          rangeTo: input.rangeTo,
          actorUserId: userId,
          desiredClaims: desiredTripClaims,
        });
        await replaceBillingDocumentSourcePeriodLocks(tx, existing.id, sourceLockIds);
        return existing.id;
      }

      const initialTripIds = [...new Set([
        ...tripSourceIds(authoritativeLines),
        ...await previewRecoverableTripIds(tx, authoritativeLines),
      ])];
      await lockTripFinancialAuthority(tx, initialTripIds);
      const [doc] = await tx.insert(s.billingDocuments).values({
        type: input.type, entityType: input.entityType, entityId: input.entityId,
        entityName: input.entityName ?? null, rangeFrom: input.rangeFrom, rangeTo: input.rangeTo,
        note: input.note ?? null, totalInclVat: String(total),
        totalNet: String(totals.net), totalTax: String(totals.tax), totalGross: String(totals.gross),
        vatTreatmentVersion: VAT_TREATMENT_VERSION, createdBy: userId,
        ledgerAdjustmentAmount: String(desiredAdjustment),
        authorityState: 'CURRENT',
        authorityWarningReason: null,
        authorityWarningAt: null,
        debitNoteTemplateId: template?.id ?? null,
        debitNoteTemplateSnapshot: snapshot,
        originalDueDate: dueDateSnapshot.originalDate,
        processingDueDate: dueDateSnapshot.processingDate,
        paymentTermDaysApplied: dueDateSnapshot.paymentTermDays,
        paymentDatePolicyApplied: dueDateSnapshot.policy,
      }).returning();
      if (!doc) throw new ApiError(500, 'Không lưu được tài liệu');
      const tripClaims = await assertTripSourcesClaimable(tx, {
        customerId: input.entityId,
        rangeFrom: input.rangeFrom,
        rangeTo: input.rangeTo,
        lines: authoritativeLines,
      });
      const recoverableTripClaims = await assertRecoverableSourcesClaimable(tx, {
        documentId: doc.id,
        customerId: input.entityId,
        rangeFrom: input.rangeFrom,
        rangeTo: input.rangeTo,
        lines: authoritativeLines,
        actorUserId: userId,
      });
      const desiredTripClaims = [...new Map(
        [...tripClaims, ...recoverableTripClaims].map((claim) => [claim.tripId, claim]),
      ).values()];
      const finalTripIds = desiredTripClaims.map((claim) => claim.tripId).sort((left, right) => left - right);
      if (finalTripIds.some((tripId) => !initialTripIds.includes(tripId))) {
        await lockTripFinancialAuthority(tx, finalTripIds);
      }
      await assertActiveFinancialPostingRefs(tx, authoritativeLines);
      await persistLines(tx, doc.id, authoritativeLines);
      await replaceActiveTripClaims(tx, {
        documentId: doc.id,
        rangeFrom: input.rangeFrom,
        rangeTo: input.rangeTo,
        actorUserId: userId,
        desiredClaims: desiredTripClaims,
      });
      await replaceBillingDocumentSourcePeriodLocks(tx, doc.id, sourceLockIds);
      return doc.id;
    }
    let existing: typeof s.billingDocuments.$inferSelect | undefined;

    if (existing) {
      await tx.update(s.billingDocuments).set({
        entityName: input.entityName ?? null,
        note: input.note ?? null,
        totalInclVat: String(total),
        totalNet: String(totals.net),
        totalTax: String(totals.tax),
        totalGross: String(totals.gross),
        vatTreatmentVersion: VAT_TREATMENT_VERSION,
        ledgerAdjustmentAmount: String(desiredAdjustment),
        authorityState: 'CURRENT',
        authorityWarningReason: null,
        authorityWarningAt: null,
        updatedAt: new Date(),
        debitNoteTemplateId: template?.id ?? null,
        debitNoteTemplateSnapshot: snapshot,
      }).where(eq(s.billingDocuments.id, existing.id));
      await tx.delete(s.billingDocumentLines).where(eq(s.billingDocumentLines.documentId, existing.id));
      await persistLines(tx, existing.id, authoritativeLines);
      await postDebitNoteDelta(tx, {
        documentId: existing.id,
        customerId: input.entityId,
        delta: desiredAdjustment - Number(existing.ledgerAdjustmentAmount),
        originalDueDate: existing.originalDueDate,
        processingDueDate: existing.processingDueDate,
        paymentTermDaysApplied: existing.paymentTermDaysApplied,
        paymentDatePolicyApplied: existing.paymentDatePolicyApplied as PaymentDatePolicy | null,
      });
      return existing.id;
    }

    const [doc] = await tx.insert(s.billingDocuments).values({
      type: input.type, entityType: input.entityType, entityId: input.entityId,
      entityName: input.entityName ?? null, rangeFrom: input.rangeFrom, rangeTo: input.rangeTo,
      note: input.note ?? null, totalInclVat: String(total),
      totalNet: String(totals.net), totalTax: String(totals.tax), totalGross: String(totals.gross),
      vatTreatmentVersion: VAT_TREATMENT_VERSION, createdBy: userId,
      ledgerAdjustmentAmount: String(desiredAdjustment),
      authorityState: 'CURRENT',
      authorityWarningReason: null,
      authorityWarningAt: null,
      debitNoteTemplateId: template?.id ?? null,
      debitNoteTemplateSnapshot: snapshot,
      originalDueDate: null,
      processingDueDate: null,
      paymentTermDaysApplied: null,
      paymentDatePolicyApplied: null,
    }).returning();
    if (!doc) throw new ApiError(500, 'Không lưu được tài liệu');
    await persistLines(tx, doc.id, authoritativeLines);
    return doc.id;
  };
  const docId = transaction
    ? await execute(transaction)
    : await db.transaction(execute);
  return getDocument(docId, transaction ?? db);
}

export async function updateDocument(
  id: number,
  input: BillingDocumentServiceInput,
  transaction?: Tx,
): Promise<BillingDocument> {
  // Reject immutable documents before resolving or validating replacement
  // sources. The transaction below repeats this check under a row lock so a
  // concurrent confirmation remains safe.
  const preflightDb = transaction ?? db;
  const [preflight] = await preflightDb.select({
    debitNoteStatus: s.billingDocuments.debitNoteStatus,
  }).from(s.billingDocuments)
    .where(and(eq(s.billingDocuments.id, id), isNull(s.billingDocuments.deletedAt)))
    .limit(1);
  if (!preflight) throw new ApiError(404, 'Không tìm thấy tài liệu');
  assertDraftDocumentLinesEditable(preflight.debitNoteStatus);

  const authoritativeLines = input.type === 'DEBIT_NOTE'
    ? await deriveDebitNoteLines(input as DebitNoteSaveInput)
    : (input.lines ?? (() => { throw new ApiError(400, 'Bảng kê thiếu dòng trình bày.'); })()) as BillingDocumentLine[];
  const totals = documentVatTotals(authoritativeLines);
  const total = totals.gross;
  const desiredAdjustment = input.type === 'DEBIT_NOTE'
    ? documentLedgerAdjustment(authoritativeLines)
    : 0;
  // Re-snapshot on every permitted edit so the doc never shows stale template
  // styling on new line data. Confirmed/paid/canceled documents are locked.
  // Preserve the existing template link unless the builder sent an
  // explicit pick (number or null); only re-resolve the customer/default chain
  // when there is no link to carry forward.
  const [existing] = await db.select({ tplId: s.billingDocuments.debitNoteTemplateId })
    .from(s.billingDocuments).where(eq(s.billingDocuments.id, id)).limit(1);
  let resolvedTemplateId = input.debitNoteTemplateId !== undefined
    ? (input.debitNoteTemplateId ?? null)
    : (existing?.tplId ?? null);
  if (input.type === 'DEBIT_NOTE' && resolvedTemplateId == null && input.entityType === 'CUSTOMER') {
    const [cust] = await db.select({ tplId: s.customers.debitNoteTemplateId })
      .from(s.customers).where(eq(s.customers.id, input.entityId)).limit(1);
    resolvedTemplateId = cust?.tplId ?? null;
  }
  const template = await resolveDebitNoteTemplate({ templateIdOverride: resolvedTemplateId, docType: input.type });
  const snapshot = template ? templateToSnapshot(template) : defaultSnapshotForType(input.type);
  // Replace lines on an allowed edit — delete + re-insert inside one
  // transaction so a mid-way failure cannot wipe the document's lines.
  const execute = async (tx: Tx) => {
    if (input.type === 'DEBIT_NOTE' && input.entityType === 'CUSTOMER') {
      await LedgerService.lockEntity(tx, 'CUSTOMER', input.entityId);
      await lockBillingDocumentOverlapAuthority(tx, input);
      const authority = await resolveDebitNotePeriodAuthority(tx, input.entityId, input.rangeFrom, input.rangeTo);
      await assertDebitNotePeriodWritable(tx, authority);
    }
    const [current] = await tx.select().from(s.billingDocuments)
      .where(and(eq(s.billingDocuments.id, id), isNull(s.billingDocuments.deletedAt)))
      .limit(1)
      .for('update');
    if (!current) throw new ApiError(404, 'Không tìm thấy tài liệu');
    if (current.type !== input.type || current.entityType !== input.entityType || current.entityId !== input.entityId) {
      throw new ApiError(400, 'Không thể đổi khách hàng hoặc loại của tài liệu đã lưu');
    }
    if (input.type === 'DEBIT_NOTE' && input.entityType === 'CUSTOMER') {
      const overlap = await checkBillingDocumentOverlap({
        type: input.type,
        entityType: input.entityType,
        entityId: input.entityId,
        rangeFrom: input.rangeFrom,
        rangeTo: input.rangeTo,
        excludeId: id,
      }, tx);
      if (overlap.hasOverlap) {
        throw new ApiError(
          409,
          'Kỳ giấy báo nợ bị chồng lấn với tài liệu đang hoạt động. Vui lòng điều chỉnh kỳ hoặc hủy tài liệu cũ.',
        );
      }
    }
    const currentTripIds = await persistedClaimTripIds(tx, id);
    const initialTripIds = [...new Set([
      ...currentTripIds,
      ...tripSourceIds(authoritativeLines),
      ...await previewRecoverableTripIds(tx, authoritativeLines),
    ])];
    await lockTripFinancialAuthority(tx, initialTripIds);
    assertDraftDocumentLinesEditable(current.debitNoteStatus);
    const sourceLockIds = input.type === 'DEBIT_NOTE' && input.entityType === 'CUSTOMER'
      ? await resolveBillingDocumentSourcePeriodLocks(
        tx,
        input.entityId,
        input.rangeFrom,
        input.rangeTo,
        authoritativeLines,
      )
      : [];
    if (input.type === 'DEBIT_NOTE' && input.entityType === 'CUSTOMER') {
      const tripClaims = await assertTripSourcesClaimable(tx, {
        customerId: input.entityId,
        rangeFrom: input.rangeFrom,
        rangeTo: input.rangeTo,
        lines: authoritativeLines,
      });
      const recoverableTripClaims = await assertRecoverableSourcesClaimable(tx, {
        documentId: id,
        customerId: input.entityId,
        rangeFrom: input.rangeFrom,
        rangeTo: input.rangeTo,
        lines: authoritativeLines,
        actorUserId: current.createdBy,
      });
      const desiredTripClaims = [...new Map(
        [...tripClaims, ...recoverableTripClaims].map((claim) => [claim.tripId, claim]),
      ).values()];
      const finalTripIds = desiredTripClaims.map((claim) => claim.tripId).sort((left, right) => left - right);
      if (finalTripIds.some((tripId) => !initialTripIds.includes(tripId))) {
        await lockTripFinancialAuthority(tx, [
          ...currentTripIds,
          ...finalTripIds,
        ]);
      }
      await replaceActiveTripClaims(tx, {
        documentId: id,
        rangeFrom: input.rangeFrom,
        rangeTo: input.rangeTo,
        actorUserId: current.createdBy,
        desiredClaims: desiredTripClaims,
      });
    }
    const [updated] = await tx.update(s.billingDocuments).set({
      entityName: input.entityName ?? null, rangeFrom: input.rangeFrom, rangeTo: input.rangeTo,
      note: input.note ?? null, totalInclVat: String(total), updatedAt: new Date(),
      totalNet: String(totals.net),
      totalTax: String(totals.tax),
      totalGross: String(totals.gross),
      vatTreatmentVersion: VAT_TREATMENT_VERSION,
      ledgerAdjustmentAmount: String(desiredAdjustment),
      authorityState: 'CURRENT',
      authorityWarningReason: null,
      authorityWarningAt: null,
      debitNoteTemplateId: template?.id ?? null,
      debitNoteTemplateSnapshot: snapshot,
      version: sql`${s.billingDocuments.version} + 1`,
    }).where(and(
      eq(s.billingDocuments.id, id),
      isNull(s.billingDocuments.deletedAt),
      or(
        isNull(s.billingDocuments.debitNoteStatus),
        eq(s.billingDocuments.debitNoteStatus, 'DRAFT'),
      ),
    )).returning({ id: s.billingDocuments.id });
    if (!updated) {
      throw new ApiError(
        409,
        'Giấy báo nợ vừa được xác nhận hoặc khóa — không thể chỉnh sửa. Vui lòng tải lại.',
      );
    }
    await assertActiveFinancialPostingRefs(tx, authoritativeLines);
    await tx.delete(s.billingDocumentLines).where(eq(s.billingDocumentLines.documentId, id));
    await persistLines(tx, id, authoritativeLines);
    await replaceBillingDocumentSourcePeriodLocks(tx, id, sourceLockIds);
  };
  await runInTx(transaction, execute);
  return getDocument(id, transaction ?? db);
}

async function persistLines(tx: Tx, documentId: number, lines: BillingDocumentLine[]): Promise<void> {
  if (lines.length === 0) return;
  await tx.insert(s.billingDocumentLines).values(
    lines.map((l) => ({
      documentId,
      sourceType: l.sourceType, sourceId: l.sourceId ?? null, lineType: l.lineType,
      sourceVersion: renderSourceVersion(l),
      sourceChangedAt: renderSourceChangedAt(l) ? new Date(renderSourceChangedAt(l) as string) : null,
      financialPostingId: l.sourceType === 'TRIP' ? (l.financialPostingId ?? null) : null,
      financialPostingVersion: l.sourceType === 'TRIP' ? (l.financialPostingVersion ?? null) : null,
      postingChecksum: l.sourceType === 'TRIP' ? (l.postingChecksum ?? null) : null,
      typeLabel: l.typeLabel, unit: l.unit,
      description: l.description, routeName: l.routeName ?? null,
      containerNumbers: joinContainers(l.containerNumbers),
      renderData: l.renderData ? { ...l.renderData } : null,
      baseAmount: String(Number(l.baseAmount)),
      amountOverride: l.amountOverride != null ? String(Number(l.amountOverride)) : null,
      excluded: l.excluded ?? false, sortOrder: l.sortOrder ?? 0,
      vatTreatment: l.vatTreatment ?? 'EXEMPT',
      vatRate: String(l.vatRate ?? 0),
      vatTreatmentVersion: l.vatTreatmentVersion ?? VAT_TREATMENT_VERSION,
      netAmount: String(l.netAmount ?? l.baseAmount ?? 0),
      taxAmount: String(l.taxAmount ?? 0),
      grossAmount: String(l.grossAmount ?? effectiveAmount(l)),
    })),
  );
}

export async function listDocuments(entityType: BillingDocumentEntityType, entityId: number, type?: BillingDocumentType): Promise<BillingDocument[]> {
  // Filter by `type` when provided so a customer who is also an external
  // carrier doesn't see their payment-statements mixed into the debit-note
  // list (both share entityType=CUSTOMER).
  const conds: SQL<unknown>[] = [
    eq(s.billingDocuments.entityType, entityType),
    eq(s.billingDocuments.entityId, entityId),
    isNull(s.billingDocuments.deletedAt),
  ];
  if (type) conds.push(eq(s.billingDocuments.type, type));
  const docs = await db.select().from(s.billingDocuments)
    .where(and(...conds))
    .orderBy(desc(s.billingDocuments.createdAt));
  return Promise.all(docs.map((d) => hydrateDocument(d)));
}

export async function getDocument(id: number, executor: typeof db | Tx = db): Promise<BillingDocument> {
  const [doc] = await executor.select().from(s.billingDocuments)
    .where(and(eq(s.billingDocuments.id, id), isNull(s.billingDocuments.deletedAt))).limit(1);
  if (!doc) throw new ApiError(404, 'Không tìm thấy tài liệu');
  return hydrateDocument(doc, executor);
}

async function hydrateDocument(
  doc: typeof s.billingDocuments.$inferSelect,
  executor: DbLike = db,
): Promise<BillingDocument> {
  const lines = await executor.select().from(s.billingDocumentLines)
    .where(eq(s.billingDocumentLines.documentId, doc.id))
    .orderBy(s.billingDocumentLines.sortOrder);
  const hydratedLines = await Promise.all(lines.map(async (l) => {
    const explicitSourceVersion = lineColumnSourceVersion(l);
    const explicitSourceChangedAt = lineColumnSourceChangedAt(l);
    const renderData = ((l.renderData as BillingLineRenderData | null) ?? null)
      ? {
          ...((l.renderData as BillingLineRenderData | null) ?? {}),
          ...(explicitSourceVersion ? { sourceVersion: explicitSourceVersion } : {}),
          ...(explicitSourceChangedAt ? { sourceChangedAt: explicitSourceChangedAt } : {}),
        }
      : (
          explicitSourceVersion || explicitSourceChangedAt
            ? {
                ...(explicitSourceVersion ? { sourceVersion: explicitSourceVersion } : {}),
                ...(explicitSourceChangedAt ? { sourceChangedAt: explicitSourceChangedAt } : {}),
              } as BillingLineRenderData
            : null
        );
    const line: BillingDocumentLine = {
      id: l.id, documentId: l.documentId, sourceType: l.sourceType as BillingDocumentLine['sourceType'],
      sourceId: l.sourceId ?? null, lineType: l.lineType as BillingDocumentLine['lineType'],
      typeLabel: l.typeLabel, unit: l.unit,
      description: l.description, routeName: l.routeName,
      containerNumbers: splitContainers(l.containerNumbers),
      renderData,
      financialPostingId: l.financialPostingId ?? null,
      financialPostingVersion: l.financialPostingVersion ?? null,
      postingChecksum: l.postingChecksum ?? null,
      baseAmount: Number(l.baseAmount), amountOverride: l.amountOverride != null ? Number(l.amountOverride) : null,
      excluded: l.excluded, sortOrder: l.sortOrder,
      vatTreatment: l.vatTreatment as BillingDocumentLine['vatTreatment'],
      vatRate: Number(l.vatRate) as BillingDocumentLine['vatRate'],
      vatTreatmentVersion: l.vatTreatmentVersion,
      netAmount: Number(l.netAmount),
      taxAmount: Number(l.taxAmount),
      grossAmount: Number(l.grossAmount),
    };
    const normalized = { ...line, description: canonicalFreightDescription(line) };
    return {
      ...normalized,
      provenance: await loadLineProvenance(normalized, executor),
    };
  }));
  const detectedAuthorityState = hydratedLines.some((line) => line.provenance?.status && line.provenance.status !== 'CURRENT')
    ? ((doc.debitNoteStatus ?? 'DRAFT') === 'DRAFT' ? 'STALE' : 'ADJUSTMENT_REQUIRED')
    : 'CURRENT';
  const authorityState = doc.authorityState === 'CURRENT'
    ? detectedAuthorityState
    : (doc.authorityState as BillingDocument['authorityState']);
  const corrections = await listDocumentCorrections(doc.id, executor);
  return {
    id: doc.id, version: doc.version, type: doc.type as BillingDocumentType, entityType: doc.entityType as BillingDocumentEntityType,
    entityId: doc.entityId, entityName: doc.entityName ?? undefined,
    rangeFrom: doc.rangeFrom, rangeTo: doc.rangeTo, note: doc.note,
    totalInclVat: Number(doc.totalInclVat), createdBy: doc.createdBy,
    totalNet: Number(doc.totalNet),
    totalTax: Number(doc.totalTax),
    totalGross: Number(doc.totalGross),
    vatTreatmentVersion: doc.vatTreatmentVersion,
    debitNoteStatus: doc.debitNoteStatus,
    customerConfirmedAt: doc.customerConfirmedAt?.toISOString() ?? null,
    customerConfirmedBy: doc.customerConfirmedBy,
    ledgerAdjustmentAmount: Number(doc.ledgerAdjustmentAmount),
    originalDueDate: doc.originalDueDate,
    processingDueDate: doc.processingDueDate,
    paymentTermDaysApplied: doc.paymentTermDaysApplied,
    paymentDatePolicyApplied: doc.paymentDatePolicyApplied as PaymentDatePolicy | null,
    debitNoteTemplateId: doc.debitNoteTemplateId ?? null,
    debitNoteTemplateSnapshot: (doc.debitNoteTemplateSnapshot as DebitNoteTemplateSnapshot | null) ?? null,
    officialIdentitySnapshot: (
      doc.officialIdentitySnapshot as BillingDocumentOfficialIdentitySnapshot | null
    ) ?? null,
    legalInvoiceRef: doc.legalInvoiceRef ?? null,
    authorityState,
    corrections,
    createdAt: doc.createdAt.toISOString(), updatedAt: doc.updatedAt.toISOString(),
    lines: hydratedLines,
  };
}

export async function deleteDocument(id: number, transaction?: Tx): Promise<void> {
  const execute = async (tx: Tx) => {
    const [initial] = await tx.select().from(s.billingDocuments)
      .where(and(eq(s.billingDocuments.id, id), isNull(s.billingDocuments.deletedAt))).limit(1);
    if (!initial) throw new ApiError(404, 'Không tìm thấy tài liệu');
    if (initial.type === 'DEBIT_NOTE') {
      if (initial.entityType === 'CUSTOMER') {
        await LedgerService.lockEntity(tx, 'CUSTOMER', initial.entityId);
        const authority = await resolveDebitNotePeriodAuthority(tx, initial.entityId, initial.rangeFrom, initial.rangeTo);
        await assertDebitNotePeriodWritable(tx, authority);
      }
      // Re-read after acquiring the entity lock so a concurrent save cannot
      // leave us reversing a stale adjustment amount.
      const [doc] = await tx.select().from(s.billingDocuments)
        .where(and(eq(s.billingDocuments.id, id), isNull(s.billingDocuments.deletedAt))).limit(1);
      if (!doc) throw new ApiError(404, 'Không tìm thấy tài liệu');
      if (doc.debitNoteStatus != null && doc.debitNoteStatus !== 'DRAFT') {
        throw new ApiError(
          409,
          'Giấy báo nợ đã phát hành hoặc kết thúc vòng đời — không thể xóa. Tạo giấy điều chỉnh hoặc hủy theo quy trình nếu cần.',
        );
      }
      const [deleted] = await tx.update(s.billingDocuments)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(
          eq(s.billingDocuments.id, id),
          isNull(s.billingDocuments.deletedAt),
          or(
            isNull(s.billingDocuments.debitNoteStatus),
            eq(s.billingDocuments.debitNoteStatus, 'DRAFT'),
          ),
        ))
        .returning({ id: s.billingDocuments.id });
      if (!deleted) {
        throw new ApiError(
          409,
          'Giấy báo nợ vừa được phát hành hoặc đổi trạng thái — không thể xóa. Vui lòng tải lại.',
        );
      }
      await tx.delete(s.billingDocumentRecoverableClaims)
        .where(eq(s.billingDocumentRecoverableClaims.documentId, id));
      return;
    }
    await tx.update(s.billingDocuments).set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(s.billingDocuments.id, id));
  };
  await runInTx(transaction, execute);
}
