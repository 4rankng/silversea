import { createHash } from 'node:crypto';
import { db } from '../db';
import * as s from '../db/schema';
import { eq, and, gte, lte, isNull, inArray, desc, or, sql, like, type SQL } from 'drizzle-orm';
import { ApiError } from '../errors';
import { getSupplierStatement } from './statement.service';
import { customerTripReceivableAmount, LedgerService } from './ledger.service';
import {
  canonicalFreightDescription,
  BILLABLE_TRIP_STATUSES,
  LoadingType,
  TxnType,
  defaultDebitNoteColumns,
  defaultPaymentStatementColumns,
} from '@tingting/shared';
import { companyInfoFromSettings, getCompanyInfo } from './company-info.service';
import type { Tx } from './trip-shared';
type DbLike = typeof db | Tx;
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
  BillingDocumentDraft,
  BillingDraftBlockedTrip,
  BillingDocumentLine,
  BillingLineRenderData,
  BillingDraftLine,
  BillingDocumentType,
  BillingDocumentEntityType,
  SaveBillingDocumentInput,
  GenerateBillingDocumentInput,
  DebitNoteTemplate,
  DebitNoteTemplateColumn,
  DebitNoteTemplateSnapshot,
  BillingDocumentOfficialIdentitySnapshot,
  BillingVatRate,
  BillingVatTreatment,
} from '@tingting/shared';

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

type BillingPartyInfo = {
  name: string;
  address: string;
  taxCode: string;
  representative: string;
  representativeTitle: string;
  phone: string;
};

type TripClaimSeed = {
  tripId: number;
  financialPostingId: number;
  financialPostingVersion: number;
  postingChecksum: string;
};

type OfficialBillingIdentitySnapshot = BillingDocumentOfficialIdentitySnapshot;
type DraftBuildResult = {
  lines: BillingDraftLine[];
  entityName: string;
  eligibilitySummary?: BillingDocumentDraft['eligibilitySummary'];
};

type FrozenDebitNoteTemplateSnapshot = DebitNoteTemplateSnapshot & {
  officialIdentity?: OfficialBillingIdentitySnapshot | null;
};

function trimIdentityValue(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stripHonorifics(value: string): string {
  return value.replace(/^Ông\s+|^Bà\s+/i, '').trim();
}

function cloneTemplateSnapshot(snapshot: DebitNoteTemplateSnapshot): FrozenDebitNoteTemplateSnapshot {
  const typed = snapshot as FrozenDebitNoteTemplateSnapshot;
  return {
    ...typed,
    columns: cloneColumns(snapshot.columns),
    officialIdentity: typed.officialIdentity
      ? {
          issuer: { ...typed.officialIdentity.issuer },
          counterparty: { ...typed.officialIdentity.counterparty },
          signatures: { ...typed.officialIdentity.signatures },
          captureMetadata: { ...typed.officialIdentity.captureMetadata },
        }
      : null,
  };
}

function extractOfficialIdentitySnapshot(
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

async function loadCompanyInfoFromExecutor(executor: DbLike = db, lockRows = false) {
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

/** Effective incl-VAT amount for a line: excluded → 0, else override ?? base. */
const VAT_TREATMENT_VERSION = 'VAT-V1' as const;
const ALLOWED_VAT_RATES = new Set<number>([0, 0.05, 0.08, 0.10]);

export function postingChecksum(posting: {
  id: number;
  tripId: number;
  version: number;
  tripVersion: number;
  reason: string;
  effectiveAt: Date | string;
}): string {
  return createHash('sha256').update(JSON.stringify({
    id: posting.id,
    tripId: posting.tripId,
    version: posting.version,
    tripVersion: posting.tripVersion,
    reason: posting.reason,
    effectiveAt: posting.effectiveAt instanceof Date
      ? posting.effectiveAt.toISOString()
      : new Date(posting.effectiveAt).toISOString(),
  })).digest('hex');
}

function normalizeVatRate(value: string | number | null | undefined): BillingVatRate {
  const rate = Number(value ?? 0);
  if (!ALLOWED_VAT_RATES.has(rate)) {
    throw new ApiError(409, `Thuế suất VAT ${rate} không thuộc chính sách đang hiệu lực.`);
  }
  return rate as BillingVatRate;
}

export function calculateVatSnapshot(
  grossAmount: number,
  rateInput: string | number | null | undefined,
  treatmentInput?: BillingVatTreatment,
) {
  const gross = Math.round(Number(grossAmount));
  if (!Number.isFinite(gross) || gross < 0) throw new ApiError(409, 'Giá trị gồm VAT không hợp lệ.');
  const rate = normalizeVatRate(rateInput);
  const treatment = treatmentInput ?? (rate === 0 ? 'ZERO_RATED' : 'STANDARD');
  if ((treatment === 'STANDARD') !== (rate > 0)) {
    throw new ApiError(409, 'Cách xử lý VAT không khớp thuế suất.');
  }
  const net = treatment === 'STANDARD'
    ? Math.floor(gross / (1 + rate) + 0.5)
    : gross;
  const tax = gross - net;
  return {
    vatTreatment: treatment,
    vatRate: rate,
    vatTreatmentVersion: VAT_TREATMENT_VERSION,
    netAmount: net,
    taxAmount: tax,
    grossAmount: gross,
  } as const;
}

export function effectiveAmount(line: { excluded?: boolean | null; baseAmount: number; amountOverride?: number | null; grossAmount?: number | null }): number {
  if (line.excluded) return 0;
  if (line.grossAmount != null) return Number(line.grossAmount);
  const override = line.amountOverride;
  return override != null ? Number(override) : Number(line.baseAmount);
}

export function docTotal(lines: BillingDocumentLine[]): number {
  return lines.reduce((sum, l) => sum + effectiveAmount(l), 0);
}

function documentVatTotals(lines: readonly BillingDocumentLine[]) {
  return lines.reduce((totals, line) => {
    if (line.excluded) return totals;
    totals.net += Number(line.netAmount ?? line.baseAmount ?? 0);
    totals.tax += Number(line.taxAmount ?? 0);
    totals.gross += Number(line.grossAmount ?? effectiveAmount(line));
    return totals;
  }, { net: 0, tax: 0, gross: 0 });
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

export function buildTripSourceVersionToken(version: number | null | undefined): string | null {
  return Number.isInteger(version) && Number(version) > 0 ? `trip:${version}` : null;
}

export function buildExpenseSourceVersionToken(input: {
  updatedAt: Date | string | null | undefined;
  approvalStatus: string | null | undefined;
  sellAmount: string | number | null | undefined;
}): string | null {
  if (!input.updatedAt || !input.approvalStatus) return null;
  const updatedAt = input.updatedAt instanceof Date
    ? input.updatedAt.toISOString()
    : new Date(input.updatedAt).toISOString();
  return `expense:${updatedAt}:${input.approvalStatus}:${Number(input.sellAmount ?? 0)}`;
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
    factoryName: sql<string | null>`coalesce(${s.shipments.factoryName}, ${s.operationalSites.name})`,
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

// ─── Billing document templates ───────────────────────────────────────────────

const cloneColumns = (cols: readonly DebitNoteTemplateColumn[]): DebitNoteTemplateColumn[] =>
  cols.map((col) => ({ ...col }));

const DEFAULT_DEBIT_NOTE_COLUMNS: DebitNoteTemplateColumn[] =
  cloneColumns(defaultDebitNoteColumns as DebitNoteTemplateColumn[]);
const DEFAULT_PAYMENT_STATEMENT_COLUMNS: DebitNoteTemplateColumn[] =
  cloneColumns(defaultPaymentStatementColumns as DebitNoteTemplateColumn[]);

const VIETSUN_TABLE_COLUMN_BY_ID = new Map(DEFAULT_PAYMENT_STATEMENT_COLUMNS.map((col) => [col.id, col]));
const VIETSUN_TABLE_WIDTH_BY_COLUMN_ID = new Map(DEFAULT_PAYMENT_STATEMENT_COLUMNS.map((col) => [col.id, col.width]));

const DEFAULT_DEBIT_NOTE_SNAPSHOT: DebitNoteTemplateSnapshot = {
  id: null,
  name: 'Mặc định giấy báo nợ',
  titleText: 'GIẤY BÁO NỢ',
  issuerName: null,
  issuerAddress: null,
  issuerTaxCode: null,
  issuerRepresentative: null,
  accentColor: '#00A651',
  showContainerColumn: true,
  showUnitColumn: true,
  groupingMode: 'NONE',
  columns: cloneColumns(DEFAULT_DEBIT_NOTE_COLUMNS),
  orientation: 'portrait',
  termsText: 'Vui lòng ghi số tham chiếu giấy báo nợ này trong chứng từ thanh toán',
  signatureLeftLabel: 'Khách hàng',
  signatureLeftName: null,
  signatureRightLabel: 'Người lập',
  signatureRightName: 'Phan Kim Phụng',
};

const DEFAULT_PAYMENT_STATEMENT_SNAPSHOT: DebitNoteTemplateSnapshot = {
  ...DEFAULT_DEBIT_NOTE_SNAPSHOT,
  name: 'Mặc định bảng kê',
  titleText: 'BẢNG KÊ CƯỚC VẬN CHUYỂN',
  accentColor: '#1F4E79',
  groupingMode: 'NONE',
  columns: [
    ...DEFAULT_PAYMENT_STATEMENT_COLUMNS,
  ],
};

function looksLikePaymentStatementColumns(cols: DebitNoteTemplateColumn[]): boolean {
  if (cols.some((col) => col.headerGroup != null)) return false;
  const variables = new Set(cols.map((col) => col.variable));
  const ids = new Set(cols.map((col) => col.id));
  const horizontalSignals = [
    variables.has('rowIndex'),
    variables.has('truckPlate') && (variables.has('origin') || variables.has('actionType')),
    variables.has('actionType'),
    variables.has('origin') && variables.has('deliveryAddress'),
    ids.has('stt') && ids.has('bien_so'),
    ids.has('gia_vc') && ids.has('so_cont'),
    variables.has('container20Count') || variables.has('container40Count'),
  ];
  return horizontalSignals.filter(Boolean).length >= 3;
}

function normalizeTemplateColumns(cols: unknown, docType: BillingDocumentType = 'DEBIT_NOTE'): DebitNoteTemplateColumn[] {
  const fallback = docType === 'PAYMENT_STATEMENT'
    ? DEFAULT_PAYMENT_STATEMENT_COLUMNS
    : DEFAULT_DEBIT_NOTE_COLUMNS;
  if (!Array.isArray(cols) || cols.length === 0) return cloneColumns(fallback);

  const parsed = cloneColumns(cols as DebitNoteTemplateColumn[]);
  if (docType === 'DEBIT_NOTE' && looksLikePaymentStatementColumns(parsed)) {
    return cloneColumns(DEFAULT_DEBIT_NOTE_COLUMNS);
  }
  return parsed;
}

function rowToTemplate(row: typeof s.debitNoteTemplates.$inferSelect): DebitNoteTemplate {
  return {
    id: row.id, name: row.name, isDefault: row.isDefault,
    documentType: row.documentType as DebitNoteTemplate['documentType'],
    titleText: row.titleText,
    issuerName: row.issuerName, issuerAddress: row.issuerAddress, issuerTaxCode: row.issuerTaxCode,
    issuerRepresentative: row.issuerRepresentative,
    accentColor: row.accentColor,
    showContainerColumn: row.showContainerColumn, showUnitColumn: row.showUnitColumn,
    groupingMode: row.groupingMode as DebitNoteTemplate['groupingMode'],
    columns: normalizeTemplateColumns(row.columns, row.documentType as BillingDocumentType),
    amountInWords: row.amountInWords, orientation: row.orientation as DebitNoteTemplate['orientation'],
    termsText: row.termsText,
    signatureLeftLabel: row.signatureLeftLabel, signatureLeftName: row.signatureLeftName,
    signatureRightLabel: row.signatureRightLabel, signatureRightName: row.signatureRightName,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

export async function getDebitNoteTemplate(id: number): Promise<DebitNoteTemplate | null> {
  const [row] = await db.select().from(s.debitNoteTemplates)
    .where(and(eq(s.debitNoteTemplates.id, id), isNull(s.debitNoteTemplates.deletedAt))).limit(1);
  return row ? rowToTemplate(row) : null;
}

function defaultSnapshotForType(type: string): DebitNoteTemplateSnapshot {
  return type === 'PAYMENT_STATEMENT'
    ? { ...DEFAULT_PAYMENT_STATEMENT_SNAPSHOT, columns: [...DEFAULT_PAYMENT_STATEMENT_SNAPSHOT.columns] }
    : { ...DEFAULT_DEBIT_NOTE_SNAPSHOT, columns: [...DEFAULT_DEBIT_NOTE_SNAPSHOT.columns] };
}

export async function getDefaultDebitNoteTemplate(docType: BillingDocumentType = 'DEBIT_NOTE'): Promise<DebitNoteTemplate | null> {
  const [row] = await db.select().from(s.debitNoteTemplates)
    .where(and(
      eq(s.debitNoteTemplates.isDefault, true),
      eq(s.debitNoteTemplates.documentType, docType),
      isNull(s.debitNoteTemplates.deletedAt),
    )).limit(1);
  return row ? rowToTemplate(row) : null;
}

/**
 * Resolve the template for a billing document export. Order:
 * explicit override → customer override → document-type default.
 * Soft-deleted templates are skipped (fall through to the next source).
 */
export async function resolveDebitNoteTemplate(opts: {
  templateIdOverride?: number | null;
  customerTemplateId?: number | null;
  docType?: string;
}): Promise<DebitNoteTemplate | null> {
  const docType = opts.docType === 'PAYMENT_STATEMENT' ? 'PAYMENT_STATEMENT' : 'DEBIT_NOTE';
  if (opts.templateIdOverride) {
    const t = await getDebitNoteTemplate(opts.templateIdOverride);
    if (t && t.documentType === docType) return t;
  }
  if (docType === 'DEBIT_NOTE' && opts.customerTemplateId) {
    const t = await getDebitNoteTemplate(opts.customerTemplateId);
    if (t && t.documentType === docType) return t;
  }
  return getDefaultDebitNoteTemplate(docType);
}

/** Frozen render-only copy written onto each saved billing document. */
export function templateToSnapshot(t: DebitNoteTemplate): DebitNoteTemplateSnapshot {
  return {
    id: t.id, name: t.name, titleText: t.titleText,
    issuerName: t.issuerName, issuerAddress: t.issuerAddress, issuerTaxCode: t.issuerTaxCode,
    issuerRepresentative: t.issuerRepresentative,
    accentColor: t.accentColor,
    showContainerColumn: t.showContainerColumn, showUnitColumn: t.showUnitColumn,
    groupingMode: t.groupingMode, columns: normalizeTemplateColumns(t.columns, t.documentType), orientation: t.orientation,
    termsText: t.termsText,
    signatureLeftLabel: t.signatureLeftLabel, signatureLeftName: t.signatureLeftName,
    signatureRightLabel: t.signatureRightLabel, signatureRightName: t.signatureRightName,
  };
}

/**
 * Resolve the snapshot to render a doc with. Issued documents always use their
 * frozen snapshot so an export can never rewrite official history. Drafts keep
 * the preview precedence: explicit `?templateId=` override → frozen snapshot →
 * customer assignment → document-type default → built-in standard snapshot.
 */
export async function resolveDebitNoteTemplateForDoc(
  doc: {
    type: string;
    entityType: string;
    entityId: number;
    debitNoteStatus?: string | null;
    debitNoteTemplateSnapshot?: DebitNoteTemplateSnapshot | null;
  },
  opts: { templateIdOverride?: number | null } = {},
): Promise<DebitNoteTemplateSnapshot | null> {
  const docType = doc.type === 'PAYMENT_STATEMENT' ? 'PAYMENT_STATEMENT' : 'DEBIT_NOTE';
  const isIssued = doc.debitNoteStatus != null && doc.debitNoteStatus !== 'DRAFT';
  if (isIssued && doc.debitNoteTemplateSnapshot) {
    return {
      ...cloneTemplateSnapshot(doc.debitNoteTemplateSnapshot),
      titleText: doc.type === 'PAYMENT_STATEMENT' && doc.debitNoteTemplateSnapshot.titleText === 'GIẤY BÁO NỢ'
        ? 'BẢNG KÊ CƯỚC VẬN CHUYỂN'
        : doc.debitNoteTemplateSnapshot.titleText,
    };
  }
  if (opts.templateIdOverride && opts.templateIdOverride > 0) {
    const t = await getDebitNoteTemplate(opts.templateIdOverride);
    if (t && t.documentType === docType) return templateToSnapshot(t);
  }
  if (doc.debitNoteTemplateSnapshot) return {
    ...cloneTemplateSnapshot(doc.debitNoteTemplateSnapshot),
    titleText: doc.type === 'PAYMENT_STATEMENT' && doc.debitNoteTemplateSnapshot.titleText === 'GIẤY BÁO NỢ'
      ? 'BẢNG KÊ CƯỚC VẬN CHUYỂN'
      : doc.debitNoteTemplateSnapshot.titleText,
  };
  let customerTemplateId: number | null = null;
  if (docType === 'DEBIT_NOTE' && doc.entityType === 'CUSTOMER') {
    const [cust] = await db.select({ tplId: s.customers.debitNoteTemplateId })
      .from(s.customers).where(eq(s.customers.id, doc.entityId)).limit(1);
    customerTemplateId = cust?.tplId ?? null;
  }
  const t = await resolveDebitNoteTemplate({ customerTemplateId, docType });
  return t ? templateToSnapshot(t) : defaultSnapshotForType(docType);
}

// ─── Generate (preview draft, pre-save) ───────────────────────────────────────

/**
 * Build AR debit-note lines for a customer + authoritative business-date range.
 * Each COMPLETED trip → a FREIGHT line (route + container separate) + its approved
 * ancillary sell fees (phí nộp hộ) → SERVICE_FEE lines.
 */
async function buildCustomerDebitLines(customerId: number, from: string, to: string): Promise<DraftBuildResult> {
  const [customer] = await db.select({ id: s.customers.id, name: s.customers.name })
    .from(s.customers).where(and(eq(s.customers.id, customerId), isNull(s.customers.deletedAt)));
  if (!customer) throw new ApiError(404, 'Không tìm thấy khách hàng');
  const entityName = customer.name;

  const completionInRange = and(
    sql`${s.trips.completedAt} IS NOT NULL`,
    gte(sql`(${s.trips.completedAt} at time zone 'Asia/Ho_Chi_Minh')::date`, from),
    lte(sql`(${s.trips.completedAt} at time zone 'Asia/Ho_Chi_Minh')::date`, to),
  )!;
  const expenseInRange = sql`EXISTS (
    SELECT 1
    FROM ${s.tripExpenses} period_expense
    WHERE period_expense.trip_id = ${s.trips.id}
      AND period_expense.approval_status = 'APPROVED'
      AND period_expense.sell_amount > 0
      AND period_expense.expense_date BETWEEN ${from} AND ${to}
  )`;
  const trips = await db.select({
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
    factoryName: sql<string | null>`coalesce(${s.shipments.factoryName}, ${s.operationalSites.name})`,
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
      eq(s.trips.customerId, customerId),
      isNull(s.trips.deletedAt),
      or(completionInRange, expenseInRange)!,
    ))
    .orderBy(s.trips.completedAt, s.trips.id) as CustomerDebitTripCandidate[];

  const tripIds = trips.map((trip) => trip.id);
  const latestPodByTrip = await loadLatestPodStatusByTrip(tripIds);
  const declarationByShipment = await loadPrimaryDeclarationByShipment(
    [...new Set(trips
      .map((trip) => trip.shipmentId)
      .filter((shipmentId): shipmentId is number => shipmentId != null))],
  );
  const containersByTrip = await loadContainersByTrip(tripIds);
  const legsByTrip = await loadLegRenderDataByTrip(tripIds);
  const feesByTrip = await loadApprovedFeesByTrip(tripIds);

  const lines: BillingDraftLine[] = [];
  const blockedTrips: BillingDraftBlockedTrip[] = [];
  let sortOrder = 0;
  for (const trip of trips) {
    const blockedReason = buildTripBlockedReason(trip, customerId, latestPodByTrip.get(trip.id));
    if (blockedReason) {
      blockedTrips.push({
        tripId: trip.id,
        tripCode: trip.tripCode ?? null,
        reason: blockedReason,
      });
      continue;
    }
    const containerInfo = containersByTrip.get(trip.id) ?? [];
    const containers = containerNumbers(containerInfo);
    const unit = containerUnit(containerInfo);
    const renderData = buildTripRenderData({
      tripId: trip.id,
      trip,
      containers: containerInfo,
      legs: legsByTrip.get(trip.id),
      note: trip.notes ?? null,
    });
    renderData.deliveryDate = trip.expectedDeliveryDate ?? trip.completionDate ?? null;
    renderData.factoryName = trip.factoryName ?? null;
    renderData.tradeDirectionLabel = tradeDirectionLabel(trip.tradeDirection);
    renderData.billNumber = trip.billNumber ?? null;
    renderData.declarationNumber = trip.shipmentId != null
      ? declarationByShipment.get(trip.shipmentId) ?? null
      : null;
    renderData.quantityLabel = quantityLabelFromCandidate(trip, containerInfo);
    renderData.vehicleType = vehicleTypeLabel(trip, containerInfo);
    renderData.cargoVolumeCbm = trip.cargoVolumeCbm == null ? null : Number(trip.cargoVolumeCbm);
    renderData.freightAmount = trip.completionDate && trip.completionDate >= from && trip.completionDate <= to
      ? Number(trip.revenue ?? 0)
      : null;
    renderData.sourceVersion = buildTripSourceVersionToken(trip.version);
    renderData.sourceChangedAt = trip.updatedAt.toISOString();
    const checksum = postingChecksum({
      id: trip.financialPostingId,
      tripId: trip.id,
      version: trip.financialPostingVersion,
      tripVersion: trip.financialPostingTripVersion,
      reason: trip.financialPostingReason,
      effectiveAt: trip.financialPostingEffectiveAt,
    });
    renderData.financialPostingId = trip.financialPostingId;
    renderData.financialPostingVersion = trip.financialPostingVersion;
    renderData.postingChecksum = checksum;
    renderData.sourceVersion = checksum;
    renderData.sourceChangedAt = trip.financialPostingEffectiveAt.toISOString();
    if (trip.completionDate && trip.completionDate >= from && trip.completionDate <= to) {
      // Revenue and surcharge are already incl-VAT; split the combined amount once.
      const receivableAmount = customerTripReceivableAmount(trip.revenue, trip.fuelSurchargeAmount);
      const vat = calculateVatSnapshot(receivableAmount, trip.vatRate);
      lines.push({
        sourceType: 'TRIP', sourceId: trip.id, lineType: 'FREIGHT',
        // Trip code is NOT inlined here — it has its own "Số chứng từ" column
        // (renderData.tripCode). Inlining it caused "Cước vận chuyển TRP--" when the
        // route name was missing, which customers mistook for the description.
        description: `Cước vận chuyển${trip.routeName ? ` — ${trip.routeName}` : ''}`,
        typeLabel: 'Doanh thu',
        unit,
        routeName: trip.routeName ?? null,
        containerNumbers: containers,
        renderData,
        financialPostingId: trip.financialPostingId,
        financialPostingVersion: trip.financialPostingVersion,
        postingChecksum: checksum,
        baseAmount: receivableAmount,
        amountOverride: null, excluded: false, ...vat, sortOrder: sortOrder++,
      });
    }

    // Approved ancillary fees charged to customer (sell side) → phí nộp hộ
    const fees = (feesByTrip.get(trip.id) ?? []).filter(
      (fee) => fee.expenseDate != null && fee.expenseDate >= from && fee.expenseDate <= to,
    );
    for (const fee of fees) {
      const amt = Number(fee.sellAmount ?? 0);
      if (amt <= 0) continue;
      const vat = calculateVatSnapshot(amt, fee.vatRate);
      lines.push({
        sourceType: 'EXPENSE', sourceId: fee.id, lineType: 'SERVICE_FEE',
        description: fee.billingLabel ?? fee.name ?? fee.expenseType,
        typeLabel: 'Phí chi hộ',
        unit,
        routeName: trip.routeName ?? null, containerNumbers: containers,
        renderData: {
          ...renderData,
          documentCode: expenseDocumentCode(fee),
          note: fee.billingLabel ?? fee.name ?? fee.expenseType,
          recoverableSupplierName: fee.supplierName ?? null,
          recoverableFeeType: fee.billingLabel ?? fee.name ?? fee.expenseType,
          recoverableDocumentCode: expenseDocumentCode(fee),
          recoverableAmount: amt,
          sourceVersion: buildExpenseSourceVersionToken(fee),
          sourceChangedAt: fee.updatedAt?.toISOString() ?? null,
        },
        baseAmount: amt, amountOverride: null, excluded: false, ...vat, sortOrder: sortOrder++,
      });
    }
  }

  return {
    lines,
    entityName,
    eligibilitySummary: {
      includedTripCount: trips.length - blockedTrips.length,
      blockedTrips,
    },
  };
}

/**
 * Build customer payment-statement lines in the horizontal business shape:
 * each trip / shipment is one row, while freight and approved ancillary fees are
 * exposed as separate render variables for customer-specific table columns.
 */
async function buildCustomerPaymentStatementLines(customerId: number, from: string, to: string): Promise<DraftBuildResult> {
  const [customer] = await db.select({ id: s.customers.id, name: s.customers.name })
    .from(s.customers).where(and(eq(s.customers.id, customerId), isNull(s.customers.deletedAt)));
  if (!customer) throw new ApiError(404, 'Không tìm thấy khách hàng');
  const entityName = customer.name;

  const trips = await db.select({
    id: s.trips.id, tripCode: s.trips.tripCode, departureDate: s.trips.departureDate,
    completionDate: sql<string | null>`to_char(${s.trips.completedAt} at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD')`,
    revenue: s.trips.revenue, fuelSurchargeAmount: s.trips.fuelSurchargeAmount, routeName: s.routes.name, notes: s.trips.notes,
    truckPlate: s.trucks.licensePlate, externalPlateNumber: s.trips.externalPlateNumber,
  }).from(s.trips)
    .leftJoin(s.routes, eq(s.trips.routeId, s.routes.id))
    .leftJoin(s.trucks, eq(s.trips.truckId, s.trucks.id))
    .where(and(
      eq(s.trips.customerId, customerId),
      inArray(s.trips.status, [...BILLABLE_TRIP_STATUSES]),
      isNull(s.trips.deletedAt),
      or(
        and(
          sql`${s.trips.completedAt} IS NOT NULL`,
          gte(sql`(${s.trips.completedAt} at time zone 'Asia/Ho_Chi_Minh')::date`, from),
          lte(sql`(${s.trips.completedAt} at time zone 'Asia/Ho_Chi_Minh')::date`, to),
        ),
        sql`EXISTS (
          SELECT 1
          FROM ${s.tripExpenses} period_expense
          WHERE period_expense.trip_id = ${s.trips.id}
            AND period_expense.approval_status = 'APPROVED'
            AND period_expense.sell_amount > 0
            AND period_expense.expense_date BETWEEN ${from} AND ${to}
        )`,
      )!,
    ))
    .orderBy(s.trips.completedAt, s.trips.id);

  const tripIds = trips.map((t) => t.id);
  const containersByTrip = await loadContainersByTrip(tripIds);
  const legsByTrip = await loadLegRenderDataByTrip(tripIds);
  const feesByTrip = await loadApprovedFeesByTrip(tripIds);

  const lines: BillingDraftLine[] = [];
  let sortOrder = 0;
  for (const trip of trips) {
    const containerInfo = containersByTrip.get(trip.id) ?? [];
    const containers = containerNumbers(containerInfo);
    const approvedFees = (feesByTrip.get(trip.id) ?? [])
      .filter((fee) => fee.expenseDate != null && fee.expenseDate >= from && fee.expenseDate <= to)
      .map((fee) => ({
        label: fee.billingLabel ?? fee.name ?? fee.expenseType,
        amount: Number(fee.sellAmount ?? 0),
      }))
      .filter((fee) => fee.amount > 0);
    const freightAmount = trip.completionDate && trip.completionDate >= from && trip.completionDate <= to
      ? Number(trip.revenue ?? 0)
      : 0;
    const serviceFeeAmount = approvedFees.reduce((sum, fee) => sum + fee.amount, 0);
    const totalAmount = freightAmount + serviceFeeAmount;
    const serviceFeeDescription = approvedFees.map((fee) => fee.label).join(', ') || null;
    const renderData = {
      ...buildTripRenderData({
        tripId: trip.id,
        trip,
        containers: containerInfo,
        legs: legsByTrip.get(trip.id),
        note: trip.notes ?? null,
      }),
      freightAmount,
      serviceFeeAmount: serviceFeeAmount || null,
      totalAmount,
      serviceFeeDescription,
    };

    lines.push({
      sourceType: 'TRIP', sourceId: trip.id, lineType: 'FREIGHT',
      description: `Cước vận chuyển${trip.routeName ? ` — ${trip.routeName}` : ''}${serviceFeeDescription ? `; ${serviceFeeDescription}` : ''}`,
      typeLabel: serviceFeeAmount > 0 ? 'Cước + chi hộ' : 'Doanh thu',
      unit: 'lô',
      routeName: trip.routeName ?? null,
      containerNumbers: containers,
      renderData,
      baseAmount: totalAmount,
      amountOverride: null,
      excluded: false,
      sortOrder: sortOrder++,
    });
  }

  return { lines, entityName };
}

/** Build AP carrier lines: trips we outsourced to this carrier (externalCarrierId). */
async function buildCarrierPaymentLines(carrierId: number, from: string, to: string): Promise<DraftBuildResult> {
  const [carrier] = await db.select({ id: s.customers.id, name: s.customers.name })
    .from(s.customers).where(and(eq(s.customers.id, carrierId), isNull(s.customers.deletedAt)));
  if (!carrier) throw new ApiError(404, 'Không tìm thấy đối tác vận chuyển');
  const entityName = carrier.name;

  const trips = await db.select({
    id: s.trips.id, tripCode: s.trips.tripCode, departureDate: s.trips.departureDate,
    externalFreightCost: s.trips.externalFreightCost, routeName: s.routes.name,
  }).from(s.trips).leftJoin(s.routes, eq(s.trips.routeId, s.routes.id))
    .where(and(
      eq(s.trips.externalEntityId, carrierId),
      inArray(s.trips.status, [...BILLABLE_TRIP_STATUSES]),
      isNull(s.trips.deletedAt),
      sql`${s.trips.completedAt} IS NOT NULL`,
      gte(sql`(${s.trips.completedAt} at time zone 'Asia/Ho_Chi_Minh')::date`, from),
      lte(sql`(${s.trips.completedAt} at time zone 'Asia/Ho_Chi_Minh')::date`, to),
    )).orderBy(s.trips.completedAt);

  const containersByTrip = await loadContainersByTrip(trips.map((t) => t.id));

  const lines: BillingDraftLine[] = [];
  let sortOrder = 0;
  for (const trip of trips) {
    const amt = Number(trip.externalFreightCost ?? 0);
    if (amt <= 0) continue;
    lines.push({
      sourceType: 'TRIP', sourceId: trip.id, lineType: 'FREIGHT',
      description: `Cước thuê ngoài${trip.routeName ? ` — ${trip.routeName}` : ''}`,
      typeLabel: 'Doanh thu',
      unit: 'lần',
      routeName: trip.routeName ?? null,
      containerNumbers: containerNumbers(containersByTrip.get(trip.id) ?? []),
      baseAmount: amt, amountOverride: null, excluded: false, sortOrder: sortOrder++,
    });
  }
  return { lines, entityName };
}

/** Build AP supplier lines from the existing supplier statement (payable accruals). */
async function buildSupplierPaymentLines(supplierId: number, from: string, to: string): Promise<DraftBuildResult> {
  const statement = await getSupplierStatement(supplierId, from, to);
  if (!statement) throw new ApiError(404, 'Không tìm thấy nhà cung cấp');
  const entityName = statement.supplier.name;

  // Only payable accruals (credit > 0); exclude settlement payments.
  const lines: BillingDraftLine[] = [];
  let sortOrder = 0;
  for (const row of statement.ledgerRows) {
    const credit = Number(row.credit ?? 0);
    if (credit <= 0) continue;
    lines.push({
      sourceType: 'EXPENSE', sourceId: row.txnId ?? null, lineType: 'SERVICE_FEE',
      description: row.note || 'Chi phí nhà cung cấp',
      typeLabel: 'Phí chi hộ',
      unit: 'lần',
      routeName: null, containerNumbers: null,
      baseAmount: credit, amountOverride: null, excluded: false, sortOrder: sortOrder++,
    });
  }
  return { lines, entityName };
}

type ContainerRenderInfo = { containerNumber: string | null; containerTypeCode: string | null; containerTypeName: string | null };
type LegRenderInfo = { origin: string | null; destination: string | null; loadingType: LoadingType | null };
type TripPodStatusSummary = {
  status: 'DRAFT' | 'SUBMITTED' | 'ACCEPTED' | 'REJECTED' | null;
  rejectionReason: string | null;
};
type CustomerDebitTripCandidate = {
  id: number;
  tripCode: string | null;
  customerId: number;
  shipmentId: number | null;
  fulfillmentId: number | null;
  status: string;
  departureDate: string;
  completionDate: string | null;
  revenue: string | null;
  fuelSurchargeAmount: string | null;
  routeName: string | null;
  notes: string | null;
  truckPlate: string | null;
  trailerPlateNumber: string | null;
  externalPlateNumber: string | null;
  version: number;
  vatRate: string;
  updatedAt: Date;
  financialPostingId: number;
  financialPostingVersion: number;
  financialPostingTripVersion: number;
  financialPostingReason: string;
  financialPostingEffectiveAt: Date;
  shipmentCustomerId: number | null;
  tradeDirection: 'IMPORT' | 'EXPORT' | null;
  billNumber: string | null;
  factoryName: string | null;
  expectedDeliveryDate: string | null;
  cargoVolumeCbm: string | null;
  packageCount: number | null;
  packageType: string | null;
};
type ApprovedFeeRenderInfo = {
  tripId: number;
  id: number;
  sellAmount: string | null;
  expenseType: string;
  billingLabel: string | null;
  name: string | null;
  supplierName: string | null;
  vatRate: string | null;
  invoiceNumber: string | null;
  declarationNumber: string | null;
  approvalStatus: string | null;
  expenseDate: string | null;
  updatedAt: Date | null;
};

function tradeDirectionLabel(value: 'IMPORT' | 'EXPORT' | null): string | null {
  if (value === 'IMPORT') return 'Nhập';
  if (value === 'EXPORT') return 'Xuất';
  return null;
}

function quantityLabelFromCandidate(
  candidate: CustomerDebitTripCandidate,
  containers: ContainerRenderInfo[],
): string | null {
  const containerList = containerNumbers(containers);
  if (containerList && containerList.length > 0) return containerList.join(', ');
  if (candidate.packageCount && candidate.packageCount > 0) {
    return `${candidate.packageCount}${candidate.packageType ? ` ${candidate.packageType}` : ' kiện'}`;
  }
  return null;
}

function vehicleTypeLabel(
  candidate: CustomerDebitTripCandidate,
  containers: ContainerRenderInfo[],
): string | null {
  const unit = containerUnit(containers);
  if (unit !== 'cont') return unit;
  if (candidate.packageCount && candidate.packageCount > 0) return 'LCL';
  return null;
}

function buildTripBlockedReason(
  candidate: Pick<CustomerDebitTripCandidate,
    'shipmentId' | 'fulfillmentId' | 'customerId' | 'shipmentCustomerId' | 'status'>,
  customerId: number,
  latestPod: TripPodStatusSummary | undefined,
): string | null {
  if (!candidate.shipmentId || !candidate.fulfillmentId) {
    return 'Chuyến chưa gắn fulfillment của lô hàng.';
  }
  if (candidate.customerId !== customerId || candidate.shipmentCustomerId !== customerId) {
    return 'Chuyến không thuộc đúng khách hàng của Giấy báo nợ.';
  }
  if (candidate.status !== 'COMPLETED') {
    return 'Chuyến chưa ở trạng thái hoàn thành.';
  }
  if (!latestPod || latestPod.status == null || latestPod.status === 'DRAFT') {
    return 'Chưa có e-POD đã duyệt.';
  }
  if (latestPod.status === 'SUBMITTED') {
    return 'e-POD đang chờ duyệt.';
  }
  if (latestPod.status === 'REJECTED') {
    return latestPod.rejectionReason?.trim()
      ? `e-POD bị từ chối: ${latestPod.rejectionReason.trim()}`
      : 'e-POD bị từ chối.';
  }
  return null;
}

export function containerNumbers(containers: ContainerRenderInfo[]): string[] | null {
  const list = containers.map((c) => c.containerNumber).filter((n): n is string => Boolean(n));
  return list.length > 0 ? list : null;
}

export function containerUnit(containers: ContainerRenderInfo[]): string {
  const c20 = countContainers(containers, '20');
  const c40 = countContainers(containers, '40');
  if (c20 > 0 && c40 === 0) return "20'";
  if (c40 > 0 && c20 === 0) return "40'";
  return 'cont';
}

export function expenseDocumentCode(fee: Pick<ApprovedFeeRenderInfo, 'invoiceNumber' | 'declarationNumber'>): string | null {
  return fee.invoiceNumber?.trim() || fee.declarationNumber?.trim() || null;
}

function countContainers(containers: ContainerRenderInfo[], size: '20' | '40'): number {
  return containers.filter((c) => {
    const label = `${c.containerTypeCode ?? ''} ${c.containerTypeName ?? ''}`.toUpperCase();
    return label.startsWith(size) || label.includes(`${size}'`) || label.includes(`${size}FT`);
  }).length;
}

export function buildTripRenderData(input: {
  tripId?: number;
  trip: {
    tripCode: string | null;
    departureDate: string;
    routeName: string | null;
    notes: string | null;
    truckPlate: string | null;
    externalPlateNumber: string | null;
    fuelSurchargeAmount?: string | null;
  };
  containers: ContainerRenderInfo[];
  legs?: LegRenderInfo;
  note?: string | null;
}): BillingLineRenderData {
  const containerCount = input.containers.length;
  const routeParts = splitRouteName(input.trip.routeName ?? '');
  return {
    tripId: input.tripId ?? null,
    tripCode: input.trip.tripCode ?? null,
    departureDate: input.trip.departureDate,
    truckPlate: input.trip.truckPlate ?? input.trip.externalPlateNumber ?? null,
    // BK VIETSUN-style "Đóng / Trả" mapping. HANG = loaded leg (ĐÓNG) = "delivering",
    // VO = empty return leg (TRẢ) = "returning without cargo". Null if the source
    // billing line has no legs (e.g. ADHOC service fees) — users hide the column
    // for those templates.
    actionType: input.legs?.loadingType === 'HANG' ? 'ĐÓNG'
              : input.legs?.loadingType === 'VO'   ? 'TRẢ'
              : null,
    origin: input.legs?.origin ?? routeParts?.origin ?? null,
    destination: routeParts?.destination ?? input.trip.routeName ?? input.legs?.destination ?? null,
    deliveryAddress: input.legs?.destination ?? null,
    container20Count: countContainers(input.containers, '20') || null,
    container40Count: countContainers(input.containers, '40') || null,
    containerCount: containerCount || null,
    fuelSurchargeAmount: Number(input.trip.fuelSurchargeAmount ?? 0),
    note: input.note ?? null,
  };
}

export async function loadContainersByTrip(
  tripIds: number[],
  executor: Pick<Tx, 'select'> | typeof db = db,
): Promise<Map<number, ContainerRenderInfo[]>> {
  const map = new Map<number, ContainerRenderInfo[]>();
  if (tripIds.length === 0) return map;
  const rows = await executor.select({
    tripId: s.tripContainers.tripId,
    containerNumber: s.tripContainers.containerNumber,
    containerTypeCode: s.containerTypes.code,
    containerTypeName: s.containerTypes.name,
  }).from(s.tripContainers)
    .leftJoin(s.containerTypes, eq(s.tripContainers.containerTypeId, s.containerTypes.id))
    .where(inArray(s.tripContainers.tripId, tripIds));
  for (const r of rows) {
    if (!map.has(r.tripId)) map.set(r.tripId, []);
    map.get(r.tripId)!.push({
      containerNumber: r.containerNumber,
      containerTypeCode: r.containerTypeCode ?? null,
      containerTypeName: r.containerTypeName ?? null,
    });
  }
  return map;
}

export async function loadLegRenderDataByTrip(
  tripIds: number[],
  executor: Pick<Tx, 'select'> | typeof db = db,
): Promise<Map<number, LegRenderInfo>> {
  const map = new Map<number, LegRenderInfo>();
  if (tripIds.length === 0) return map;
  const rows = await executor.select({
    tripId: s.tripLegs.tripId,
    sequence: s.tripLegs.sequence,
    origin: s.tripLegs.origin,
    destination: s.tripLegs.destination,
    loadingType: s.tripLegs.loadingType,
  }).from(s.tripLegs)
    .where(inArray(s.tripLegs.tripId, tripIds))
    .orderBy(s.tripLegs.tripId, s.tripLegs.sequence);
  for (const r of rows) {
    const existing = map.get(r.tripId);
    if (!existing) {
      map.set(r.tripId, { origin: r.origin, destination: r.destination, loadingType: r.loadingType as LoadingType });
    } else {
      existing.destination = r.destination;
      // Last-leg loadingType wins (matches the "destination" semantics — same leg).
      existing.loadingType = r.loadingType as LoadingType;
    }
  }
  return map;
}

async function loadLatestPodStatusByTrip(
  tripIds: number[],
  executor: Pick<Tx, 'select'> | typeof db = db,
): Promise<Map<number, TripPodStatusSummary>> {
  const map = new Map<number, TripPodStatusSummary>();
  if (tripIds.length === 0) return map;
  const rows = await executor.select({
    tripId: s.tripPodSubmissions.tripId,
    status: s.tripPodSubmissions.status,
    rejectionReason: s.tripPodSubmissions.rejectionReason,
    submissionVersion: s.tripPodSubmissions.submissionVersion,
    id: s.tripPodSubmissions.id,
  }).from(s.tripPodSubmissions)
    .where(inArray(s.tripPodSubmissions.tripId, tripIds))
    .orderBy(s.tripPodSubmissions.tripId, desc(s.tripPodSubmissions.submissionVersion), desc(s.tripPodSubmissions.id));
  for (const row of rows) {
    if (map.has(row.tripId)) continue;
    map.set(row.tripId, {
      status: row.status,
      rejectionReason: row.rejectionReason ?? null,
    });
  }
  return map;
}

async function loadPrimaryDeclarationByShipment(
  shipmentIds: number[],
  executor: Pick<Tx, 'select'> | typeof db = db,
): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  if (shipmentIds.length === 0) return map;
  const rows = await executor.select({
    shipmentId: s.shipmentDeclarations.shipmentId,
    declarationNumber: s.shipmentDeclarations.declarationNumber,
    issuedAt: s.shipmentDeclarations.issuedAt,
    updatedAt: s.shipmentDeclarations.updatedAt,
    id: s.shipmentDeclarations.id,
  }).from(s.shipmentDeclarations)
    .where(inArray(s.shipmentDeclarations.shipmentId, shipmentIds))
    .orderBy(
      s.shipmentDeclarations.shipmentId,
      desc(s.shipmentDeclarations.issuedAt),
      desc(s.shipmentDeclarations.updatedAt),
      desc(s.shipmentDeclarations.id),
    );
  for (const row of rows) {
    if (!row.declarationNumber || map.has(row.shipmentId)) continue;
    map.set(row.shipmentId, row.declarationNumber);
  }
  return map;
}

/** Bulk-load approved ancillary fees (sell side) grouped by trip — avoids N+1 per trip. */
async function loadApprovedFeesByTrip(tripIds: number[]): Promise<Map<number, ApprovedFeeRenderInfo[]>> {
  const map = new Map<number, ApprovedFeeRenderInfo[]>();
  if (tripIds.length === 0) return map;
  const rows = await db.select({
    tripId: s.tripExpenses.tripId, id: s.tripExpenses.id,
    sellAmount: s.tripExpenses.sellAmount, expenseType: s.tripExpenses.expenseType,
    invoiceNumber: s.tripExpenses.invoiceNumber, declarationNumber: s.tripExpenses.declarationNumber,
    approvalStatus: s.tripExpenses.approvalStatus, expenseDate: s.tripExpenses.expenseDate,
    updatedAt: s.tripExpenses.updatedAt,
    billingLabel: s.forwarderExpenseTypes.billingLabel, name: s.forwarderExpenseTypes.name,
    vatRate: s.forwarderExpenseTypes.vatRate,
    supplierName: s.suppliers.name,
  }).from(s.tripExpenses)
    .leftJoin(s.forwarderExpenseTypes, eq(s.tripExpenses.expenseType, s.forwarderExpenseTypes.code))
    .leftJoin(s.suppliers, eq(s.tripExpenses.supplierId, s.suppliers.id))
    .where(and(inArray(s.tripExpenses.tripId, tripIds), eq(s.tripExpenses.approvalStatus, 'APPROVED')));
  for (const f of rows) {
    if (!map.has(f.tripId)) map.set(f.tripId, []);
    map.get(f.tripId)!.push(f);
  }
  return map;
}

export async function generateDraft(input: GenerateBillingDocumentInput): Promise<BillingDocumentDraft> {
  const { type, entityType, entityId, rangeFrom: from, rangeTo: to } = input;

  let result: DraftBuildResult;

  if (type === 'DEBIT_NOTE' && entityType === 'CUSTOMER') {
    result = await buildCustomerDebitLines(entityId, from, to);
  } else if (type === 'PAYMENT_STATEMENT' && entityType === 'CUSTOMER') {
    const [customer] = await db.select({ isCarrier: s.customers.isCarrier })
      .from(s.customers)
      .where(and(eq(s.customers.id, entityId), isNull(s.customers.deletedAt)))
      .limit(1);
    result = customer?.isCarrier
      ? await buildCarrierPaymentLines(entityId, from, to)
      : await buildCustomerPaymentStatementLines(entityId, from, to);
  } else if (type === 'PAYMENT_STATEMENT' && entityType === 'VENDOR') {
    result = await buildSupplierPaymentLines(entityId, from, to);
  } else {
    // DEBIT_NOTE + VENDOR is not meaningful (debit notes are customer-facing AR only).
    throw new ApiError(400, 'Loại tài liệu không hợp lệ cho đối tượng này');
  }

  const totals = documentVatTotals(result.lines);
  return {
    type,
    entityType,
    entityId,
    entityName: result.entityName,
    rangeFrom: from,
    rangeTo: to,
    lines: result.lines,
    totalInclVat: totals.gross,
    totalNet: totals.net,
    totalTax: totals.tax,
    totalGross: totals.gross,
    vatTreatmentVersion: VAT_TREATMENT_VERSION,
    eligibilitySummary: result.eligibilitySummary ?? null,
  };
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
  if (transaction) {
    await execute(transaction);
  } else {
    await db.transaction(execute);
  }
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
  if (transaction) {
    await execute(transaction);
    return;
  }
  await db.transaction(execute);
}

// ─── Excel export ─────────────────────────────────────────────────────────────

const SERVICE_FEE_EXPORT_LABELS: Record<string, string> = {
  LIFTING: 'Phí nâng container',
  LOWERING: 'Phí hạ container',
  CUSTOMS: 'Phí hải quan',
  INFRASTRUCTURE: 'Phí hạ tầng',
  WEIGHING: 'Phí cân hàng',
  INSPECTION: 'Phí kiểm hóa',
  INSPECTION_SVC: 'Phí dịch vụ kiểm hóa',
  OTHER: 'Phí chi hộ khác',
};

function exportDescription(line: BillingDocumentLine): string {
  const raw = line.description?.trim() ?? '';
  if (line.lineType !== 'SERVICE_FEE') return raw;
  return SERVICE_FEE_EXPORT_LABELS[raw.toUpperCase()] ?? raw;
}

function formatVietnameseDate(raw: string): string {
  const [year, month, day] = raw.split('-');
  if (!year || !month || !day) return raw;
  return `${day}/${month}/${year}`;
}

function formatMonthYear(raw: string): string {
  const [year, month] = raw.split('-');
  if (!year || !month) return raw;
  return `${month}.${year}`;
}

const VIETNAMESE_DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
const VIETNAMESE_TRIPLE_UNITS = ['', 'nghìn', 'triệu', 'tỷ', 'nghìn tỷ', 'triệu tỷ', 'tỷ tỷ'];

function readVietnameseTriple(value: number, forceHundreds: boolean): string {
  const hundred = Math.floor(value / 100);
  const ten = Math.floor((value % 100) / 10);
  const unit = value % 10;
  const parts: string[] = [];

  if (hundred > 0 || forceHundreds) {
    parts.push(`${VIETNAMESE_DIGITS[hundred]} trăm`);
  }

  if (ten > 1) {
    parts.push(`${VIETNAMESE_DIGITS[ten]} mươi`);
    if (unit === 1) parts.push('mốt');
    else if (unit === 5) parts.push('lăm');
    else if (unit > 0) parts.push(VIETNAMESE_DIGITS[unit]);
  } else if (ten === 1) {
    parts.push('mười');
    if (unit === 5) parts.push('lăm');
    else if (unit > 0) parts.push(VIETNAMESE_DIGITS[unit]);
  } else if (unit > 0) {
    if (hundred > 0 || forceHundreds) parts.push('lẻ');
    parts.push(VIETNAMESE_DIGITS[unit]);
  }

  return parts.join(' ');
}

function sentenceCase(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function amountToVietnameseWords(amount: number): string {
  const rounded = Math.round(amount);
  if (!Number.isFinite(rounded)) return '';
  if (rounded === 0) return 'Không đồng';

  const sign = rounded < 0 ? 'Âm ' : '';
  let remaining = Math.abs(rounded);
  const triples: number[] = [];
  while (remaining > 0) {
    triples.push(remaining % 1000);
    remaining = Math.floor(remaining / 1000);
  }

  const words: string[] = [];
  for (let idx = triples.length - 1; idx >= 0; idx--) {
    const triple = triples[idx];
    if (triple === 0) continue;
    const hasHigherGroup = words.length > 0;
    const text = readVietnameseTriple(triple, hasHigherGroup && triple < 100);
    const unit = VIETNAMESE_TRIPLE_UNITS[idx] ?? '';
    words.push(unit ? `${text} ${unit}` : text);
  }

  return `${sign}${sentenceCase(words.join(' '))} đồng`;
}

function hasTemplateToken(value: string): boolean {
  return /\{\{?\s*[\w.]+\s*\}?\}/.test(value);
}

function renderTemplateText(template: string, variables: Record<string, string | number>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}|\{\s*([\w.]+)\s*\}/g, (match, doubleKey, singleKey) => {
    const key = doubleKey ?? singleKey;
    const value = variables[key];
    return value == null ? match : String(value);
  });
}

async function loadCounterpartyInfo(
  doc: BillingDocument,
  executor: DbLike = db,
  lockRows = false,
): Promise<BillingPartyInfo> {
  if (doc.entityType === 'CUSTOMER') {
    const query = executor.select({
      name: s.customers.name,
      taxCode: s.customers.taxCode,
      contactPerson: s.customers.contactPerson,
      contactInfo: s.customers.contactInfo,
      phone: s.customers.phone,
    }).from(s.customers).where(eq(s.customers.id, doc.entityId)).limit(1);
    const [customer] = await (lockRows ? query.for('share') : query);
    return {
      name: customer?.name ?? doc.entityName ?? '',
      address: customer?.contactInfo ?? '',
      taxCode: customer?.taxCode ?? '',
      representative: customer?.contactPerson ?? '',
      representativeTitle: 'Giám Đốc',
      phone: customer?.phone ?? '',
    };
  }

  const query = executor.select({
    name: s.suppliers.name,
    taxCode: s.suppliers.taxCode,
    contactPerson: s.suppliers.contactPerson,
    phone: s.suppliers.phone,
    note: s.suppliers.note,
  }).from(s.suppliers).where(eq(s.suppliers.id, doc.entityId)).limit(1);
  const [supplier] = await (lockRows ? query.for('share') : query);
  return {
    name: supplier?.name ?? doc.entityName ?? '',
    address: supplier?.note ?? '',
    taxCode: supplier?.taxCode ?? '',
    representative: supplier?.contactPerson ?? '',
    representativeTitle: 'Giám Đốc',
    phone: supplier?.phone ?? '',
  };
}

function applyOfficialIdentityToSnapshot(
  snapshot: DebitNoteTemplateSnapshot,
  officialIdentity: OfficialBillingIdentitySnapshot,
): FrozenDebitNoteTemplateSnapshot {
  return {
    ...cloneTemplateSnapshot(snapshot),
    officialIdentity: {
      issuer: { ...officialIdentity.issuer },
      counterparty: { ...officialIdentity.counterparty },
      signatures: { ...officialIdentity.signatures },
      captureMetadata: { ...officialIdentity.captureMetadata },
    },
  };
}

async function buildLiveRenderIdentity(
  doc: BillingDocument,
  snapshot: DebitNoteTemplateSnapshot,
  executor: DbLike = db,
  lockSourceRows = false,
): Promise<OfficialBillingIdentitySnapshot> {
  const [company, counterparty] = await Promise.all([
    loadCompanyInfoFromExecutor(executor, lockSourceRows),
    loadCounterpartyInfo(doc, executor, lockSourceRows),
  ]);
  const fallbackCompanyRepresentative = trimIdentityValue(company.representative);
  const snapshotRightName = trimIdentityValue(snapshot.signatureRightName);
  return {
    issuer: {
      name: trimIdentityValue(snapshot.issuerName) || trimIdentityValue(company.name),
      address: trimIdentityValue(snapshot.issuerAddress) || trimIdentityValue(company.address),
      taxCode: trimIdentityValue(snapshot.issuerTaxCode) || trimIdentityValue(company.taxCode),
      representative: trimIdentityValue(snapshot.issuerRepresentative) || fallbackCompanyRepresentative,
      representativeTitle: trimIdentityValue(company.representativeTitle),
      phone: trimIdentityValue(company.phone),
      bankAccount: trimIdentityValue(company.bankAccount),
      bankName: trimIdentityValue(company.bankName),
      email: trimIdentityValue(company.email),
      logoStorageKey: company.logoStorageKey ?? null,
    },
    counterparty: {
      entityType: doc.entityType,
      name: trimIdentityValue(counterparty.name) || trimIdentityValue(doc.entityName),
      address: trimIdentityValue(counterparty.address),
      taxCode: trimIdentityValue(counterparty.taxCode),
      representative: trimIdentityValue(counterparty.representative),
      representativeTitle: trimIdentityValue(counterparty.representativeTitle),
      phone: trimIdentityValue(counterparty.phone),
      contactInfo: trimIdentityValue(counterparty.address),
    },
    signatures: {
      leftLabel: trimIdentityValue(snapshot.signatureLeftLabel) || 'Khách hàng',
      leftName: trimIdentityValue(snapshot.signatureLeftName),
      rightLabel: trimIdentityValue(snapshot.signatureRightLabel) || 'Người lập',
      rightName: snapshotRightName || stripHonorifics(fallbackCompanyRepresentative),
    },
    captureMetadata: {
      mode: 'ISSUED_AT_TRANSITION',
      capturedAt: new Date().toISOString(),
    },
  };
}

export async function captureIssuedOfficialIdentitySnapshot(
  doc: BillingDocument,
  executor: DbLike = db,
): Promise<FrozenDebitNoteTemplateSnapshot> {
  const baseSnapshot = cloneTemplateSnapshot(
    doc.debitNoteTemplateSnapshot ?? defaultSnapshotForType(doc.type),
  );
  const officialIdentity = await buildLiveRenderIdentity(doc, baseSnapshot, executor, true);
  return applyOfficialIdentityToSnapshot(baseSnapshot, officialIdentity);
}

export async function resolveBillingDocumentIdentity(
  doc: BillingDocument,
  snapshot: DebitNoteTemplateSnapshot | null | undefined,
  executor: DbLike = db,
): Promise<OfficialBillingIdentitySnapshot | null> {
  if (doc.officialIdentitySnapshot) {
    return {
      issuer: { ...doc.officialIdentitySnapshot.issuer },
      counterparty: { ...doc.officialIdentitySnapshot.counterparty },
      signatures: { ...doc.officialIdentitySnapshot.signatures },
      captureMetadata: { ...doc.officialIdentitySnapshot.captureMetadata },
    };
  }
  const effectiveSnapshot = snapshot ?? doc.debitNoteTemplateSnapshot ?? defaultSnapshotForType(doc.type);
  const captured = extractOfficialIdentitySnapshot(effectiveSnapshot);
  if (captured) return captured;
  return buildLiveRenderIdentity(doc, effectiveSnapshot, executor);
}

function customerCode(name: string, fallback: number): string {
  const normalized = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd');
  const words = normalized
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((word) => word && !['CONG', 'TY', 'TNHH', 'MTV', 'CP', 'CO', 'LTD'].includes(word.toUpperCase()));
  const code = words.slice(0, 3).map((word) => word[0]?.toUpperCase()).join('');
  return code || String(fallback);
}

// Verbatim legacy renderer (pre-template). Kept move-only so the regression
// oracle holds: buildBillingXlsx(doc, null) delegates here and is byte-identical
// to pre-template output for BOTH DEBIT_NOTE and PAYMENT_STATEMENT docs.
export async function buildLegacyXlsx(doc: BillingDocument): Promise<Buffer> {
  const ExcelJSMod = await import('exceljs');
  const ExcelJS = (ExcelJSMod as Record<string, unknown>).default
    ? ((ExcelJSMod as Record<string, unknown>).default as typeof ExcelJSMod)
    : ExcelJSMod;
  const wb = new ExcelJS.Workbook();
  const company = await getCompanyInfo();
  wb.creator = company.name;
  wb.created = new Date();
  wb.modified = new Date();

  const ws = wb.addWorksheet(doc.type === 'DEBIT_NOTE' ? 'Giấy báo nợ' : 'Bảng kê');
  const isDebitNote = doc.type === 'DEBIT_NOTE';
  const title = isDebitNote ? 'GIẤY BÁO NỢ' : 'BẢNG KÊ THANH TOÁN';
  const entityLabel = isDebitNote ? 'Khách hàng' : 'Đối tác';
  const tableStart = isDebitNote ? (doc.note ? 7 : 6) : (doc.note ? 6 : 5);
  const dataStart = tableStart + 1;

  ws.properties.defaultRowHeight = 22;
  ws.pageSetup = {
    paperSize: 9,
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: true,
    margins: {
      left: 0.35, right: 0.35, top: 0.45, bottom: 0.45, header: 0.2, footer: 0.2,
    },
  };
  ws.mergeCells('A1:D1');
  ws.getCell('A1').value = title;
  ws.getCell('A1').font = { name: 'Arial', bold: true, size: 18, color: { argb: 'FF111827' } };
  ws.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 32;

  ws.mergeCells('A2:D2');
  ws.getCell('A2').value = `${entityLabel}: ${doc.entityName ?? ''}`;
  ws.getCell('A2').font = { name: 'Arial', bold: true, size: 12, color: { argb: 'FF111827' } };
  ws.getCell('A2').alignment = { horizontal: 'center', vertical: 'middle' };

  ws.mergeCells('A3:D3');
  ws.getCell('A3').value = `Kỳ: ${formatVietnameseDate(doc.rangeFrom)} - ${formatVietnameseDate(doc.rangeTo)}`;
  ws.getCell('A3').font = { name: 'Arial', size: 11, color: { argb: 'FF374151' } };
  ws.getCell('A3').alignment = { horizontal: 'center', vertical: 'middle' };

  if (isDebitNote) {
    ws.mergeCells('A4:D4');
    ws.getCell('A4').value = doc.originalDueDate
      ? `Hạn hợp đồng: ${formatVietnameseDate(doc.originalDueDate)} · Ngày xử lý: ${formatVietnameseDate(doc.processingDueDate ?? doc.originalDueDate)}`
      : 'Hạn thanh toán: Chưa có dữ liệu lịch sử';
    ws.getCell('A4').font = { name: 'Arial', size: 10, color: { argb: 'FF374151' } };
    ws.getCell('A4').alignment = { horizontal: 'center', vertical: 'middle' };
  }

  if (doc.note) {
    const noteRow = isDebitNote ? 5 : 4;
    ws.mergeCells(noteRow, 1, noteRow, 4);
    ws.getCell(noteRow, 1).value = `Ghi chú: ${doc.note}`;
    ws.getCell(noteRow, 1).font = { name: 'Arial', italic: true, size: 10, color: { argb: 'FF4B5563' } };
    ws.getCell(noteRow, 1).alignment = { horizontal: 'left', vertical: 'top', wrapText: true };
    ws.getRow(noteRow).height = 30;
  }

  for (let r = 1; r <= 5; r++) {
    ws.getRow(r).eachCell({ includeEmpty: true }, (cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
    });
  }

  const headerRow = ws.getRow(tableStart);
  headerRow.values = ['Diễn giải', 'Số cont', 'ĐVT', 'Số tiền (VNĐ)'];
  headerRow.height = 26;
  headerRow.font = { name: 'Arial', bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
  headerRow.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  headerRow.eachCell((cell) => {
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF1F2937' } },
      left: { style: 'thin', color: { argb: 'FF1F2937' } },
      bottom: { style: 'thin', color: { argb: 'FF1F2937' } },
      right: { style: 'thin', color: { argb: 'FF1F2937' } },
    };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
  });

  let rowIdx = dataStart;
  const amountRows: number[] = [];
  let lineIdx = 0;
  while (lineIdx < doc.lines.length) {
    const routeName = doc.lines[lineIdx]?.routeName ?? '';
    let groupEnd = lineIdx + 1;
    while (groupEnd < doc.lines.length && (doc.lines[groupEnd]?.routeName ?? '') === routeName) groupEnd += 1;
    const groupLines = doc.lines.slice(lineIdx, groupEnd).filter((line) => !line.excluded);
    lineIdx = groupEnd;
    if (groupLines.length === 0) continue;

    const subtotal = groupLines.reduce((sum, line) => sum + effectiveAmount(line), 0);
    const routeRow = ws.getRow(rowIdx++);
    routeRow.values = [
      `Tuyến: ${routeName || 'Chưa có tuyến'} (${groupLines.length} dòng)`,
      '',
      '',
      subtotal,
    ];
    ws.mergeCells(routeRow.number, 1, routeRow.number, 3);
    routeRow.height = 28;
    routeRow.font = { name: 'Arial', bold: true, size: 10, color: { argb: 'FF123B2A' } };
    routeRow.alignment = { vertical: 'middle', wrapText: false };
    routeRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      cell.border = {
        left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        right: { style: 'thin', color: { argb: 'FFD1D5DB' } },
      };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF5EF' } };
      if (colNumber === 4) {
        cell.numFmt = '#,##0';
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
      }
    });

    for (const line of groupLines) {
      const amt = effectiveAmount(line);
      const row = ws.getRow(rowIdx++);
      amountRows.push(row.number);
      row.values = [
        exportDescription(line),
        (line.containerNumbers ?? []).join(', '),
        line.unit,
        amt || 0,
      ];
      row.height = 24;
      row.font = { name: 'Arial', size: 10, color: { argb: 'FF111827' } };
      row.alignment = { vertical: 'middle', wrapText: false };
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        cell.border = {
          left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
          bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
          right: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        };
        if (colNumber === 4) {
          cell.numFmt = '#,##0';
          cell.alignment = { horizontal: 'right', vertical: 'middle' };
        }
      });
      if (line.lineType !== 'FREIGHT') {
        row.getCell(1).font = { name: 'Arial', italic: true, color: { argb: 'FF4B5563' } };
        row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAFAFA' } };
      }
      if (line.amountOverride != null && line.amountOverride !== line.baseAmount) {
        row.getCell(4).font = { name: 'Arial', bold: true, color: { argb: 'FF111827' } };
      }
    }
  }

  const formula = amountRows.length > 0 ? `SUM(${amountRows.map((row) => `D${row}`).join(',')})` : '0';
  const totalRow = ws.getRow(rowIdx + 1);
  totalRow.values = ['TỔNG CỘNG', '', '', {
    formula,
    result: doc.totalInclVat,
  }];
  ws.mergeCells(totalRow.number, 1, totalRow.number, 3);
  totalRow.height = 28;
  totalRow.font = { name: 'Arial', bold: true, size: 11, color: { argb: 'FF111827' } };
  totalRow.getCell(1).alignment = { horizontal: 'right', vertical: 'middle' };
  totalRow.getCell(4).numFmt = '#,##0';
  totalRow.getCell(4).alignment = { horizontal: 'right', vertical: 'middle' };
  totalRow.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF111827' } },
      bottom: { style: 'double', color: { argb: 'FF111827' } },
    };
  });

  ws.columns = [
    { width: 72 }, { width: 28 }, { width: 10 }, { width: 18 },
  ];
  ws.getColumn(1).alignment = { wrapText: false, vertical: 'middle' };
  ws.getColumn(2).alignment = { wrapText: false, vertical: 'middle' };
  ws.getColumn(3).alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getColumn(4).numFmt = '#,##0';

  const ab = await wb.xlsx.writeBuffer();
  return Buffer.from(ab);
}

// ─── Template-driven export ──────────────────────────────────────────────────

/** Convert a #RRGGBB (or RRGGBB) accent to an ExcelJS ARGB color string. */
function hexToArgb(hex: string): string {
  const h = (hex || '').replace('#', '').padStart(6, '0').slice(-6);
  return ('FF' + h).toUpperCase();
}

/** 1-based column index → Excel letter (1→A, 2→B, …, 27→AA). */
function colLetter(n: number): string {
  let s = '';
  let x = n;
  while (x > 0) {
    const m = (x - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

export function renderColumnValue(line: BillingDocumentLine, col: DebitNoteTemplateColumn, rowIndex: number): string | number | Date | null {
  const data = line.renderData ?? {};
  const routeParts = splitRouteName(line.routeName ?? '');
  const parseDateValue = (raw: string | null | undefined): string | Date | null => {
    if (!raw) return null;
    const [year, month, day] = String(raw).split('-').map(Number);
    const date = year && month && day
      ? new Date(Date.UTC(year, month - 1, day))
      : new Date(`${raw}T00:00:00`);
    return Number.isNaN(date.getTime()) ? String(raw) : date;
  };
  switch (col.variable) {
    case 'rowIndex': return rowIndex;
    case 'departureDate': return parseDateValue(data.departureDate);
    case 'deliveryDate': return parseDateValue(data.deliveryDate);
    case 'truckPlate': return data.truckPlate ?? null;
    case 'vehicleType': return data.vehicleType ?? null;
    case 'actionType': return data.actionType ?? null;
    case 'origin': return data.origin ?? routeParts?.origin ?? null;
    case 'destination': return data.destination ?? routeParts?.destination ?? line.routeName ?? null;
    case 'deliveryAddress': return data.deliveryAddress ?? null;
    case 'factoryName': return data.factoryName ?? null;
    case 'tradeDirectionLabel': return data.tradeDirectionLabel ?? null;
    case 'billNumber': return data.billNumber ?? null;
    case 'declarationNumber': return data.declarationNumber ?? null;
    case 'quantityLabel': return data.quantityLabel ?? null;
    case 'container20Count': return data.container20Count ?? null;
    case 'container40Count': return data.container40Count ?? null;
    case 'containerCount': return data.containerCount ?? (line.containerNumbers?.length || null);
    case 'containerNumbers': return (line.containerNumbers ?? []).join(', ') || null;
    case 'cargoVolumeCbm': return data.cargoVolumeCbm ?? null;
    case 'routeName': return line.routeName ?? null;
    case 'description': return exportDescription(line);
    case 'lineTypeLabel': return line.typeLabel;
    case 'unit': return line.unit;
    case 'amount': {
      const amount = effectiveAmount(line) || 0;
      if (col.id === 'don_gia') {
        const qty = Number(data.containerCount ?? line.containerNumbers?.length ?? 1);
        return qty > 1 ? Math.round(amount / qty) : amount;
      }
      return amount;
    }
    case 'deliveryFeeAmount': return data.deliveryFeeAmount ?? null;
    case 'freightAmount': return data.freightAmount ?? null;
    case 'portFeeAmount': return data.portFeeAmount ?? null;
    case 'otherServiceFeeAmount': return data.otherServiceFeeAmount ?? null;
    case 'fuelSurchargeAmount': return data.fuelSurchargeAmount ?? null;
    case 'serviceFeeAmount': return data.serviceFeeAmount ?? null;
    case 'totalAmount': return data.totalAmount ?? (effectiveAmount(line) || 0);
    case 'serviceFeeDescription': return data.serviceFeeDescription ?? null;
    case 'recoverableSupplierName': return data.recoverableSupplierName ?? null;
    case 'recoverableFeeType': return data.recoverableFeeType ?? null;
    case 'recoverableDocumentCode': return data.recoverableDocumentCode ?? null;
    case 'recoverableAmount': return data.recoverableAmount ?? null;
    case 'note': return data.note ?? null;
    case 'documentCode': return data.documentCode ?? null;
    case 'tripCode':
      return col.id === 'chung_tu'
        ? data.documentCode ?? null
        : data.tripCode ?? (line.sourceType === 'TRIP' ? String(line.sourceId ?? '') : null);
    default: return null;
  }
}

function splitRouteName(routeName: string): { origin: string; destination: string } | null {
  const normalized = routeName.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  const separator = normalized.match(/\s[-–—]\s/);
  if (!separator || separator.index === undefined) return null;
  const origin = normalized.slice(0, separator.index).trim();
  const destination = normalized.slice(separator.index + separator[0].length).trim();
  return origin && destination ? { origin, destination } : null;
}

async function enrichLinesForDebitNoteRender(lines: BillingDocumentLine[]): Promise<BillingDocumentLine[]> {
  const normalizedLines = lines.map((line) => ({
    ...line,
    description: canonicalFreightDescription(line),
  }));
  const directTripIds = normalizedLines
    .filter((line) => line.sourceType === 'TRIP' && line.sourceId && !line.renderData)
    .map((line) => Number(line.sourceId))
    .filter((id) => Number.isFinite(id) && id > 0);
  const expenseIds = Array.from(new Set(normalizedLines
    .filter((line) => line.sourceType === 'EXPENSE' && line.sourceId)
    .map((line) => Number(line.sourceId))
    .filter((id) => Number.isFinite(id) && id > 0)));

  const expenseTripRows = expenseIds.length > 0
    ? await db.select({
      id: s.tripExpenses.id,
      tripId: s.tripExpenses.tripId,
      invoiceNumber: s.tripExpenses.invoiceNumber,
      declarationNumber: s.tripExpenses.declarationNumber,
    })
      .from(s.tripExpenses)
      .where(inArray(s.tripExpenses.id, expenseIds))
    : [];
  const expenseById = new Map(expenseTripRows.map((row) => [row.id, row]));
  const tripIds = Array.from(new Set([
    ...directTripIds,
    ...expenseTripRows.map((row) => row.tripId),
  ]));
  if (tripIds.length === 0 && expenseById.size === 0) return normalizedLines;

  const trips = await db.select({
    id: s.trips.id,
    tripCode: s.trips.tripCode,
    departureDate: s.trips.departureDate,
    fuelSurchargeAmount: s.trips.fuelSurchargeAmount,
    routeName: s.routes.name,
    notes: s.trips.notes,
    truckPlate: s.trucks.licensePlate,
    externalPlateNumber: s.trips.externalPlateNumber,
  }).from(s.trips)
    .leftJoin(s.routes, eq(s.trips.routeId, s.routes.id))
    .leftJoin(s.trucks, eq(s.trips.truckId, s.trucks.id))
    .where(inArray(s.trips.id, tripIds));
  const tripsById = new Map(trips.map((trip) => [trip.id, trip]));
  const containersByTrip = await loadContainersByTrip(tripIds);
  const legsByTrip = await loadLegRenderDataByTrip(tripIds);

  return normalizedLines.map((line) => {
    const expenseInfo = line.sourceType === 'EXPENSE' && line.sourceId
      ? expenseById.get(Number(line.sourceId))
      : undefined;
    const documentCode = expenseInfo ? expenseDocumentCode(expenseInfo) : null;
    if (line.renderData) {
      return {
        ...line,
        renderData: {
          ...line.renderData,
          documentCode: line.renderData.documentCode ?? documentCode,
        },
      };
    }
    if (!line.sourceId) return line;
    const tripId = line.sourceType === 'TRIP'
      ? Number(line.sourceId)
      : line.sourceType === 'EXPENSE'
        ? expenseInfo?.tripId
        : null;
    if (!tripId) return line;
    const trip = tripsById.get(tripId);
    if (!trip) return line;
    const containers = containersByTrip.get(trip.id) ?? [];
    const enrichedLine = {
      ...line,
      routeName: line.routeName ?? trip.routeName ?? null,
      containerNumbers: line.containerNumbers ?? containerNumbers(containers),
      renderData: buildTripRenderData({
        tripId: trip.id,
        trip,
        containers,
        legs: legsByTrip.get(trip.id),
        note: trip.notes ?? null,
      }),
    };
    return {
      ...enrichedLine,
      renderData: {
        ...enrichedLine.renderData,
        documentCode,
      },
    };
  });
}

function applyInferredColumnFormat(cell: { numFmt?: string; alignment?: unknown }, value: unknown): void {
  if (value instanceof Date) {
    cell.numFmt = 'm/d/yyyy';
  } else if (typeof value === 'number') {
    cell.numFmt = '#,##0';
  }
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
}

function renderedValueLength(value: unknown): number {
  if (value == null) return 0;
  if (value instanceof Date) return 10;
  if (typeof value === 'number') return value.toLocaleString('en-US').length;
  if (typeof value === 'object' && 'formula' in value) {
    const result = (value as { result?: unknown }).result;
    return renderedValueLength(result);
  }
  return String(value)
    .split('\n')
    .reduce((max, part) => Math.max(max, part.trim().length), 0);
}

function autoColumnWidth(header: string, values: unknown[]): number {
  const lengths = [header, ...values].map(renderedValueLength).filter((len) => len > 0);
  if (lengths.length === 0) return 8;
  const avg = lengths.reduce((sum, len) => sum + len, 0) / lengths.length;
  const headerMin = renderedValueLength(header) + 2;
  return Math.max(4, Math.min(42, Math.ceil(Math.max(avg * 1.35 + 2, headerMin))));
}

function renderDebitNoteColumnLabel(col: DebitNoteTemplateColumn): string {
  const reference = VIETSUN_TABLE_COLUMN_BY_ID.get(col.id);
  if (!reference) return col.label;
  const compact = (value: string) => value.replace(/\s+/g, '');
  return compact(col.label) === compact(reference.label) ? reference.label : col.label;
}

function aggregateDebitNoteExportLines(lines: BillingDocumentLine[]): BillingDocumentLine[] {
  const groups = new Map<string, BillingDocumentLine>();
  const passthrough: BillingDocumentLine[] = [];

  for (const line of lines) {
    if (line.excluded) continue;
    const data = line.renderData ?? {};
    const keyParts = [
      data.departureDate ?? '',
      data.truckPlate ?? '',
      data.actionType ?? '',
      data.origin ?? '',
      data.destination ?? line.routeName ?? '',
      data.deliveryAddress ?? '',
      (line.containerNumbers ?? []).join('|'),
      data.container20Count ?? '',
      data.container40Count ?? '',
    ];
    const canGroup = line.sourceType === 'TRIP' || line.sourceType === 'EXPENSE';
    if (!canGroup) {
      passthrough.push(line);
      continue;
    }

    const key = keyParts.join('\u001f');
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { ...line, lineType: 'FREIGHT', baseAmount: effectiveAmount(line), amountOverride: null });
      continue;
    }
    groups.set(key, {
      ...existing,
      baseAmount: effectiveAmount(existing) + effectiveAmount(line),
      amountOverride: null,
    });
  }

  return [...groups.values(), ...passthrough].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

type DebitNoteLineGroup = {
  key: string;
  label: string;
  first: BillingDocumentLine;
  lines: BillingDocumentLine[];
};

function debitNoteGroupKey(line: BillingDocumentLine): string {
  const data = line.renderData ?? {};
  return [
    data.tripCode ?? '',
    data.departureDate ?? '',
    line.routeName ?? '',
    (line.containerNumbers ?? []).join('|'),
  ].join('\u001f');
}

function debitNoteGroupLabel(line: BillingDocumentLine): string {
  const qty = Number(line.renderData?.containerCount ?? line.containerNumbers?.length ?? 1) || 1;
  const containerText = (line.containerNumbers ?? []).join(';');
  const unit = line.unit || 'cont';
  return `${String(qty).padStart(2, '0')}x${unit}${containerText ? ` ${containerText}` : ''}`;
}

function groupDebitNoteLines(lines: BillingDocumentLine[]): DebitNoteLineGroup[] {
  const groups: DebitNoteLineGroup[] = [];
  const byKey = new Map<string, DebitNoteLineGroup>();
  for (const line of lines) {
    const key = debitNoteGroupKey(line);
    let group = byKey.get(key);
    if (!group) {
      group = { key, label: debitNoteGroupLabel(line), first: line, lines: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.lines.push(line);
  }
  return groups;
}

const LONG_MINH_CONTINUATION_VARIABLES = new Set<DebitNoteTemplateColumn['variable']>([
  'rowIndex',
  'factoryName',
  'tradeDirectionLabel',
  'billNumber',
  'declarationNumber',
  'quantityLabel',
  'vehicleType',
  'truckPlate',
  'cargoVolumeCbm',
  'deliveryDate',
  'routeName',
  'deliveryFeeAmount',
  'freightAmount',
  'portFeeAmount',
  'otherServiceFeeAmount',
  'fuelSurchargeAmount',
]);

type LongMinhDebitGroup = {
  representativeLine: BillingDocumentLine;
  tripLine: BillingDocumentLine | null;
  serviceLines: BillingDocumentLine[];
  recoverableLines: BillingDocumentLine[];
};

type LongMinhPrintableRow = {
  displayIndex: number | null;
  representativeLine: BillingDocumentLine;
  recoverableLine: BillingDocumentLine | null;
  serviceAmounts: {
    deliveryFeeAmount: number;
    freightAmount: number;
    portFeeAmount: number;
    otherServiceFeeAmount: number;
    fuelSurchargeAmount: number;
  };
  continuation: boolean;
};

function isLongMinhDebitTemplate(cols: readonly DebitNoteTemplateColumn[]): boolean {
  const variables = new Set(cols.map((col) => col.variable));
  return cols.some((col) => col.headerGroup != null)
    && variables.has('deliveryDate')
    && variables.has('quantityLabel')
    && variables.has('recoverableAmount');
}

function longMinhGroupKey(line: BillingDocumentLine): string {
  const data = line.renderData ?? {};
  const stableTripIdentity = data.tripCode?.trim()
    ? `trip-code:${data.tripCode.trim()}`
    : line.sourceType === 'TRIP' && line.sourceId != null
      ? `trip:${line.sourceId}`
      : `route:${line.routeName ?? ''}`;
  if (!stableTripIdentity.startsWith('route:')) return stableTripIdentity;
  return [
    stableTripIdentity,
    data.departureDate ?? '',
    (line.containerNumbers ?? []).join('|'),
  ].join('\u001f');
}

function sumLongMinhServiceAmounts(lines: readonly BillingDocumentLine[]) {
  const amounts = {
    deliveryFeeAmount: 0,
    freightAmount: 0,
    portFeeAmount: 0,
    otherServiceFeeAmount: 0,
    fuelSurchargeAmount: 0,
  };
  for (const line of lines) {
    const data = line.renderData ?? {};
    amounts.deliveryFeeAmount += Number(data.deliveryFeeAmount ?? 0);
    amounts.freightAmount += Number(data.freightAmount ?? (line.lineType === 'FREIGHT' ? effectiveAmount(line) : 0));
    amounts.portFeeAmount += Number(data.portFeeAmount ?? 0);
    amounts.otherServiceFeeAmount += Number(data.otherServiceFeeAmount ?? 0);
    amounts.fuelSurchargeAmount += Number(data.fuelSurchargeAmount ?? 0);
    if (
      line.lineType !== 'FREIGHT'
      && line.sourceType !== 'EXPENSE'
      && Number(data.deliveryFeeAmount ?? 0) === 0
      && Number(data.portFeeAmount ?? 0) === 0
      && Number(data.otherServiceFeeAmount ?? 0) === 0
      && Number(data.fuelSurchargeAmount ?? 0) === 0
      && Number(data.freightAmount ?? 0) === 0
    ) {
      amounts.otherServiceFeeAmount += effectiveAmount(line);
    }
  }
  return amounts;
}

function buildLongMinhPrintableRows(lines: readonly BillingDocumentLine[]): LongMinhPrintableRow[] {
  const groups: LongMinhDebitGroup[] = [];
  const byKey = new Map<string, LongMinhDebitGroup>();
  for (const line of lines) {
    const key = longMinhGroupKey(line);
    let group = byKey.get(key);
    if (!group) {
      group = {
        representativeLine: line,
        tripLine: null,
        serviceLines: [],
        recoverableLines: [],
      };
      byKey.set(key, group);
      groups.push(group);
    }
    if (!group.tripLine && line.sourceType === 'TRIP') {
      group.tripLine = line;
      group.representativeLine = line;
    }
    if (line.sourceType === 'EXPENSE' || Number(line.renderData?.recoverableAmount ?? 0) > 0) {
      group.recoverableLines.push(line);
    } else {
      group.serviceLines.push(line);
    }
  }

  return groups.flatMap<LongMinhPrintableRow>((group, index) => {
    const representativeLine = group.tripLine ?? group.representativeLine;
    const serviceAmounts = sumLongMinhServiceAmounts(group.serviceLines.length > 0 ? group.serviceLines : [representativeLine]);
    if (group.recoverableLines.length === 0) {
      return [{
        displayIndex: index + 1,
        representativeLine,
        recoverableLine: null,
        serviceAmounts,
        continuation: false,
      }];
    }
    return group.recoverableLines.map((recoverableLine, recoverableIndex) => ({
      displayIndex: recoverableIndex === 0 ? index + 1 : null,
      representativeLine,
      recoverableLine,
      serviceAmounts,
      continuation: recoverableIndex > 0,
    }));
  });
}

async function renderLongMinhDebitXlsx(
  doc: BillingDocument,
  snap: DebitNoteTemplateSnapshot,
): Promise<Buffer> {
  const ExcelJSMod = await import('exceljs');
  const ExcelJS = (ExcelJSMod as Record<string, unknown>).default
    ? ((ExcelJSMod as Record<string, unknown>).default as typeof ExcelJSMod)
    : ExcelJSMod;
  const wb = new ExcelJS.Workbook();
  const officialIdentity = await resolveBillingDocumentIdentity(doc, snap);
  const issuer = officialIdentity?.issuer ?? null;
  const partner = officialIdentity?.counterparty ?? null;
  wb.creator = issuer?.name || '';
  wb.created = new Date();
  wb.modified = new Date();

  const ws = wb.addWorksheet('Long Minh Debit');
  const columns = normalizeTemplateColumns(snap.columns, 'DEBIT_NOTE').filter((col) => col.width > 0);
  const printableRows = buildLongMinhPrintableRows((await enrichLinesForDebitNoteRender(doc.lines)).filter((line) => !line.excluded));
  const headerTopRow = 15;
  const headerBottomRow = 16;
  const firstDataRow = 17;
  const lastColumn = columns.length;
  const moneyFmt = '#,##0';

  ws.properties.defaultRowHeight = 18;
  ws.pageSetup = {
    paperSize: 9,
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.35, right: 0.35, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
  };
  columns.forEach((column, index) => {
    ws.getColumn(index + 1).width = Math.max(4, Math.min(36, column.width));
  });

  ws.mergeCells(7, 1, 7, lastColumn);
  ws.getCell(7, 1).value = snap.titleText || 'BẢNG KÊ XÁC NHẬN VẬN CHUYỂN HOÀN THÀNH / MẪU DEBIT LONG MINH';
  ws.getCell(7, 1).font = { name: 'Tahoma', size: 12, bold: true };
  ws.getCell(7, 1).alignment = { horizontal: 'center', vertical: 'middle' };

  ws.getCell(9, 1).value = 'Đơn vị phát hành';
  ws.getCell(9, 2).value = issuer?.name || '';
  ws.getCell(10, 1).value = 'Địa chỉ';
  ws.getCell(10, 2).value = issuer?.address || '';
  ws.getCell(11, 1).value = 'Khách hàng';
  ws.getCell(11, 2).value = partner?.name || doc.entityName || '';
  ws.getCell(12, 1).value = 'Kỳ đối soát';
  ws.getCell(12, 2).value = `${formatVietnameseDate(doc.rangeFrom)} - ${formatVietnameseDate(doc.rangeTo)}`;
  ws.getCell(13, 1).value = 'Điều khoản';
  ws.getCell(13, 2).value = snap.termsText || 'Theo mẫu Long Minh đã cấu hình';
  for (let row = 9; row <= 13; row++) {
    ws.getCell(row, 1).font = { name: 'Tahoma', size: 10, bold: true };
    ws.getCell(row, 2).font = { name: 'Tahoma', size: 10 };
    ws.getCell(row, 2).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
  }

  for (let index = 0; index < columns.length; index++) {
    const column = columns[index]!;
    const cellTop = ws.getCell(headerTopRow, index + 1);
    const cellBottom = ws.getCell(headerBottomRow, index + 1);
    if (column.headerGroup) {
      cellBottom.value = column.label;
    } else {
      cellTop.value = column.label;
      ws.mergeCells(headerTopRow, index + 1, headerBottomRow, index + 1);
    }
  }
  let index = 0;
  while (index < columns.length) {
    const headerGroup = columns[index]!.headerGroup;
    if (!headerGroup) {
      index += 1;
      continue;
    }
    let end = index;
    while (end + 1 < columns.length && columns[end + 1]!.headerGroup === headerGroup) end += 1;
    ws.mergeCells(headerTopRow, index + 1, headerTopRow, end + 1);
    ws.getCell(headerTopRow, index + 1).value = headerGroup;
    index = end + 1;
  }
  for (let row = headerTopRow; row <= headerBottomRow; row++) {
    for (let col = 1; col <= lastColumn; col++) {
      const cell = ws.getCell(row, col);
      cell.font = { name: 'Tahoma', size: 10, bold: true };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF000000' } },
        left: { style: 'thin', color: { argb: 'FF000000' } },
        right: { style: 'thin', color: { argb: 'FF000000' } },
        bottom: { style: 'thin', color: { argb: 'FF000000' } },
      };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E2F3' } };
    }
  }

  printableRows.forEach((row, rowIndex) => {
    const excelRow = firstDataRow + rowIndex;
    columns.forEach((column, columnIndex) => {
      const cell = ws.getCell(excelRow, columnIndex + 1);
      let value: string | number | Date | null;
      if (row.continuation && LONG_MINH_CONTINUATION_VARIABLES.has(column.variable)) {
        value = null;
      } else if (column.variable === 'rowIndex') {
        value = row.displayIndex;
      } else if (column.variable === 'deliveryFeeAmount') {
        value = row.continuation ? null : row.serviceAmounts.deliveryFeeAmount || null;
      } else if (column.variable === 'freightAmount') {
        value = row.continuation ? null : row.serviceAmounts.freightAmount || null;
      } else if (column.variable === 'portFeeAmount') {
        value = row.continuation ? null : row.serviceAmounts.portFeeAmount || null;
      } else if (column.variable === 'otherServiceFeeAmount') {
        value = row.continuation ? null : row.serviceAmounts.otherServiceFeeAmount || null;
      } else if (column.variable === 'fuelSurchargeAmount') {
        value = row.continuation ? null : row.serviceAmounts.fuelSurchargeAmount || null;
      } else if (column.variable === 'recoverableSupplierName') {
        value = renderColumnValue(row.recoverableLine ?? row.representativeLine, column, row.displayIndex ?? rowIndex + 1);
      } else if (column.variable === 'recoverableFeeType') {
        value = renderColumnValue(row.recoverableLine ?? row.representativeLine, column, row.displayIndex ?? rowIndex + 1);
      } else if (column.variable === 'recoverableDocumentCode') {
        value = renderColumnValue(row.recoverableLine ?? row.representativeLine, column, row.displayIndex ?? rowIndex + 1);
      } else if (column.variable === 'recoverableAmount') {
        value = row.recoverableLine ? effectiveAmount(row.recoverableLine) : null;
      } else {
        value = renderColumnValue(row.representativeLine, column, row.displayIndex ?? rowIndex + 1);
      }
      cell.value = value;
      cell.font = { name: 'Tahoma', size: 10 };
      cell.alignment = {
        horizontal: column.align === 'right' ? 'right' : column.align === 'left' ? 'left' : 'center',
        vertical: 'middle',
        wrapText: true,
      };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF000000' } },
        left: { style: 'thin', color: { argb: 'FF000000' } },
        right: { style: 'thin', color: { argb: 'FF000000' } },
        bottom: { style: 'thin', color: { argb: 'FF000000' } },
      };
      if (column.format === 'currency' || column.format === 'number') {
        cell.numFmt = moneyFmt;
      } else if (value instanceof Date) {
        cell.numFmt = 'dd/mm/yyyy';
      }
    });
  });

  const serviceSubtotal = doc.lines
    .filter((line) => !line.excluded && line.sourceType !== 'EXPENSE')
    .reduce((sum, line) => sum + effectiveAmount(line), 0);
  const recoverableSubtotal = doc.lines
    .filter((line) => !line.excluded && line.sourceType === 'EXPENSE')
    .reduce((sum, line) => sum + effectiveAmount(line), 0);
  const grandTotal = Number(doc.totalGross ?? doc.totalInclVat ?? 0);
  const vatAmount = Number(doc.totalTax ?? 0);
  const documentAdjustment = Math.max(0, Number(doc.totalNet ?? 0) - serviceSubtotal - recoverableSubtotal);
  const summaryStartRow = firstDataRow + printableRows.length + 1;
  const labelColumn = Math.max(1, lastColumn - 4);
  const valueColumn = lastColumn;
  const summaryRows: Array<[string, number]> = [
    ['Tổng phí dịch vụ', serviceSubtotal],
    ['Tổng phí chi hộ', recoverableSubtotal],
    ['VAT đã bao gồm trong các dòng', vatAmount],
    ['Điều chỉnh khác theo chứng từ', documentAdjustment],
    ['Tổng thanh toán', grandTotal],
  ];
  summaryRows.forEach(([label, amount], offset) => {
    const row = summaryStartRow + offset;
    ws.mergeCells(row, labelColumn, row, valueColumn - 1);
    ws.getCell(row, labelColumn).value = label;
    ws.getCell(row, labelColumn).font = { name: 'Tahoma', size: 10, bold: true };
    ws.getCell(row, labelColumn).alignment = { horizontal: 'right', vertical: 'middle' };
    ws.getCell(row, valueColumn).value = amount;
    ws.getCell(row, valueColumn).font = { name: 'Tahoma', size: 10, bold: true };
    ws.getCell(row, valueColumn).alignment = { horizontal: 'right', vertical: 'middle' };
    ws.getCell(row, valueColumn).numFmt = moneyFmt;
  });

  const wordsRow = summaryStartRow + summaryRows.length + 1;
  ws.mergeCells(wordsRow, 1, wordsRow, lastColumn);
  ws.getCell(wordsRow, 1).value = `Bằng chữ: ${amountToVietnameseWords(grandTotal)}`;
  ws.getCell(wordsRow, 1).font = { name: 'Tahoma', size: 10, italic: true };

  const ab = await wb.xlsx.writeBuffer();
  return Buffer.from(ab);
}

/**
 * Public entry point. `null`/`undefined` template or a mismatched document type
 * delegates to the verbatim legacy renderer. A live template is snapshotted,
 * then rendered by renderTemplatedXlsx.
 */
export async function buildBillingXlsx(
  doc: BillingDocument,
  template?: DebitNoteTemplate | null,
): Promise<Buffer> {
  if (!template) return buildLegacyXlsx(doc);
  if (template.documentType !== doc.type) return buildLegacyXlsx(doc);
  return renderTemplatedXlsx(doc, templateToSnapshot(template));
}

async function renderDebitNoteXlsx(
  doc: BillingDocument,
  snap: DebitNoteTemplateSnapshot,
): Promise<Buffer> {
  if (isLongMinhDebitTemplate(snap.columns)) {
    return renderLongMinhDebitXlsx(doc, snap);
  }
  const ExcelJSMod = await import('exceljs');
  const ExcelJS = (ExcelJSMod as Record<string, unknown>).default
    ? ((ExcelJSMod as Record<string, unknown>).default as typeof ExcelJSMod)
    : ExcelJSMod;
  const wb = new ExcelJS.Workbook();
  const officialIdentity = await resolveBillingDocumentIdentity(doc, snap);
  const issuer = officialIdentity?.issuer ?? null;
  const partner = officialIdentity?.counterparty ?? null;
  const signatures = officialIdentity?.signatures ?? null;
  wb.creator = issuer?.name || '';
  wb.created = new Date();
  wb.modified = new Date();

  const ws = wb.addWorksheet('GBN');
  const lines = await enrichLinesForDebitNoteRender(doc.lines);
  const dataLines = lines.filter((line) => !line.excluded);
  const lineGroups = groupDebitNoteLines(dataLines);
  const totalAmount = dataLines.reduce((sum, line) => sum + effectiveAmount(line), 0);
  const moneyFmt = '#,##0';
  const baseFont = { name: 'Tahoma', size: 10, color: { argb: 'FF000000' } };
  const boldFont = { ...baseFont, bold: true };
  const templateGrayFont = { ...baseFont, color: { argb: 'FF969696' } };
  const labelFont = { ...templateGrayFont, bold: true };
  const grayFont = { ...baseFont, color: { argb: 'FF808080' } };
  const thinGray = { style: 'thin' as const, color: { argb: 'FFD8DCE3' } };
  const thinBlack = { style: 'thin' as const, color: { argb: 'FF000000' } };
  const tableBorder = { top: thinBlack, left: thinBlack, right: thinBlack, bottom: thinBlack };
  const accent = hexToArgb(snap.accentColor || '#00A651');
  const dataStartRow = 16;
  const minTotalRow = 61;
  const renderedDataRowCount = lineGroups.reduce((sum, group) => sum + 1 + group.lines.length, 0);
  const totalRow = Math.max(minTotalRow, dataStartRow + renderedDataRowCount);
  const wordsRow = totalRow + 1;
  const exchangeRow = totalRow + 3;
  const bankTop = totalRow + 4;
  const sheetRows = Math.max(70, bankTop + 5);

  const parseDateOnly = (raw: string | null | undefined): Date | string | null => {
    if (!raw) return null;
    const [year, month, day] = String(raw).split('-').map(Number);
    if (!year || !month || !day) return raw;
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return Number.isNaN(parsed.getTime()) ? raw : parsed;
  };
  const splitAddress = (raw: string | null | undefined): [string, string] => {
    const value = (raw || '').replace(/^Số\s+/i, '').replace(/,\s*Việt Nam$/i, '').trim();
    if (!value) return ['', ''];
    const parts = value.split(',').map((part) => part.trim()).filter(Boolean);
    if (parts.length <= 1) return [value, ''];
    const midpoint = Math.ceil(parts.length / 2);
    return [parts.slice(0, midpoint).join(', '), parts.slice(midpoint).join(', ')];
  };
  const splitCompanyAddress = (raw: string | null | undefined): [string, string] => {
    const value = (raw || '').replace(/^Số\s+/i, '').replace(/,\s*Việt Nam$/i, '').trim();
    if (!value) return ['', ''];
    const parts = value.split(',').map((part) => part.trim()).filter(Boolean);
    const city = (parts.pop() ?? '').replace(/^Thành phố/i, 'Thành Phố');
    const ward = parts.pop() ?? '';
    const street = parts.join(', ');
    const district = value.toLowerCase().includes('quận ngô quyền') ? '' : 'quận Ngô Quyền';
    return [
      [street, ward].filter(Boolean).join(', ') || value,
      [district, city].filter(Boolean).join(', '),
    ];
  };

  ws.properties.defaultRowHeight = 15;
  ws.pageSetup = {
    paperSize: 9,
    orientation: 'portrait',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: false,
    margins: { left: 0, right: 0, top: 0.5, bottom: 0.25, header: 0.3, footer: 0.3 },
  };

  const columnWidths = [2, 10.5, 14.33, 36.5, 7.5, 8.66, 10.16, 12.5];
  columnWidths.forEach((width, index) => {
    ws.getColumn(index + 1).width = width;
  });
  for (let r = 1; r <= sheetRows; r++) {
    if (r === 15) ws.getRow(r).height = 28;
    for (let c = 1; c <= 8; c++) {
      ws.getCell(r, c).font = baseFont;
    }
  }
  ws.getRow(1).height = 15;
  ws.getRow(6).height = 10.5;
  ws.getRow(7).height = 18;
  ws.getRow(8).height = 9;
  ws.getRow(10).height = 15;

  ws.mergeCells('B1:C5');
  ws.mergeCells('D1:H1');
  ws.mergeCells('D2:H2');
  ws.mergeCells('E3:H3');
  ws.mergeCells('E4:H4');
  ws.mergeCells('E5:H5');
  const logoCell = ws.getCell('B1');
  const logoBytes = await loadLogoBytes(issuer?.logoStorageKey ?? null);
  if (logoBytes) {
    const imageId = wb.addImage({ base64: logoBytes.toString('base64'), extension: 'png' });
    ws.addImage(imageId, { tl: { col: 1.01, row: 0 }, ext: { width: 383, height: 126 } });
  } else {
    logoCell.value = issuer?.name || '';
    logoCell.font = { name: 'Arial', size: 24, bold: true, color: { argb: accent } };
    logoCell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
  }

  const [companyAddress1, companyAddress2] = splitCompanyAddress(issuer?.address);
  ws.getCell('D1').value = issuer?.name || '';
  ws.getCell('D1').font = { ...boldFont, size: 12 };
  ws.getCell('D2').value = companyAddress1 || issuer?.address || '';
  ws.getCell('E3').value = companyAddress2;
  ws.getCell('E4').value = issuer?.phone ? `ĐT: ${issuer.phone}` : '';
  ws.getCell('E5').value = issuer?.email ? `E-mail: ${issuer.email}` : '';
  for (const addressCell of ['D1', 'D2', 'E3', 'E4', 'E5']) {
    ws.getCell(addressCell).font = addressCell === 'D1'
      ? { ...boldFont, size: 12 }
      : addressCell === 'E4' || addressCell === 'E5'
        ? { ...templateGrayFont, bold: true }
        : boldFont;
    ws.getCell(addressCell).alignment = { horizontal: 'right', vertical: 'middle', wrapText: true };
  }

  ws.mergeCells('B7:D7');
  ws.getCell(7, 2).value = 'GIẤY BÁO NỢ';
  ws.getCell(7, 2).font = { name: 'Tahoma', size: 14, bold: true, color: { argb: 'FF7A7F87' } };
  ws.getCell(7, 2).alignment = { horizontal: 'left', vertical: 'middle' };

  const noticeNo = doc.note?.trim() || `${customerCode(partner?.name || '', doc.entityId)}${doc.rangeTo.replaceAll('-', '').slice(2)}`;
  ws.mergeCells('C9:D9');
  ws.mergeCells('C10:D10');
  ws.mergeCells('C11:D11');
  ws.mergeCells('C12:D12');
  ws.mergeCells('C13:D13');
  ws.mergeCells('F9:H9');
  ws.mergeCells('E10:H10');
  ws.mergeCells('E11:H11');
  ws.mergeCells('E12:H12');
  ws.mergeCells('E13:H13');
  const leftMeta = [
    ['Số :', noticeNo],
    ['Ngày tháng:', parseDateOnly(doc.rangeTo)],
    ['Mã khách:', customerCode(partner?.name || '', doc.entityId)],
    ['Hạn hợp đồng:', doc.originalDueDate ? parseDateOnly(doc.originalDueDate) : 'Chưa có dữ liệu lịch sử'],
    ['Ngày xử lý:', doc.processingDueDate ? parseDateOnly(doc.processingDueDate) : 'Chưa có dữ liệu lịch sử'],
  ];
  leftMeta.forEach(([label, value], index) => {
    const row = 9 + index;
    ws.getCell(row, 2).value = label;
    ws.getCell(row, 2).font = labelFont;
    ws.getCell(row, 3).value = value;
    ws.getCell(row, 3).font = row === 9 ? boldFont : baseFont;
    ws.getCell(row, 3).alignment = { horizontal: 'left', vertical: 'middle' };
    if (value instanceof Date) ws.getCell(row, 3).numFmt = 'd/m/yy';
  });

  const [partnerAddress1, partnerAddress2] = splitAddress(partner?.address);
  ws.getCell('E9').value = 'Gửi tới:';
  ws.getCell('E9').font = labelFont;
  ws.getCell('F9').value = [partner?.representative || 'Phòng kế toán', partner?.phone ? `(${partner.phone})` : ''].filter(Boolean).join(' ');
  ws.getCell(10, 5).value = partner?.name || '';
  ws.getCell(10, 5).font = boldFont;
  ws.getCell(11, 5).value = partnerAddress1;
  ws.getCell(12, 5).value = partnerAddress2;
  ws.getCell(13, 5).value = partner?.taxCode ? `MST : ${partner.taxCode}` : 'MST :';

  const tableHeaderRow = 15;
  const fixedHeaders = ['Ngày tháng', 'Số \nchứng từ', 'Diễn giải', 'ĐVT', 'Số lượng', 'Đơn giá', 'Thành tiền'];
  fixedHeaders.forEach((header, index) => {
    const cell = ws.getCell(tableHeaderRow, index + 2);
    cell.value = header;
    cell.font = boldFont;
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = tableBorder;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
  });

  for (let r = dataStartRow; r < totalRow; r++) {
    for (let c = 2; c <= 8; c++) {
      const cell = ws.getCell(r, c);
      cell.border = tableBorder;
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    }
  }

  let row = dataStartRow;
  const dataRows: number[] = [];
  for (const group of lineGroups) {
    const groupRow = row++;
    const departureDate = renderColumnValue(group.first, DEFAULT_DEBIT_NOTE_COLUMNS[0], dataRows.length + 1);
    ws.getCell(groupRow, 2).value = departureDate;
    ws.getCell(groupRow, 2).font = baseFont;
    ws.getCell(groupRow, 2).alignment = { horizontal: 'center', vertical: 'middle' };
    if (departureDate instanceof Date) ws.getCell(groupRow, 2).numFmt = 'd/m/yy';
    ws.getCell(groupRow, 4).value = group.label;
    ws.getCell(groupRow, 4).font = boldFont;
    ws.getCell(groupRow, 4).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };

    for (const line of group.lines) {
      const r = row++;
      dataRows.push(r);
      const amount = effectiveAmount(line);
      const quantity = Number(line.renderData?.containerCount ?? line.containerNumbers?.length ?? 1) || 1;
      const unitPrice = quantity > 1 ? Math.round(amount / quantity) : amount;
      ws.getCell(r, 3).value = line.renderData?.documentCode ?? null;
      ws.getCell(r, 4).value = exportDescription(line);
      ws.getCell(r, 5).value = line.unit || 'cont';
      ws.getCell(r, 6).value = quantity;
      ws.getCell(r, 7).value = unitPrice;
      ws.getCell(r, 8).value = { formula: `G${r}*F${r}`, result: amount };
      ws.getCell(r, 3).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      ws.getCell(r, 4).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
      ws.getCell(r, 5).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      ws.getCell(r, 6).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      ws.getCell(r, 7).alignment = { horizontal: 'right', vertical: 'middle', wrapText: true };
      ws.getCell(r, 8).alignment = { horizontal: 'right', vertical: 'middle', wrapText: true };
      ws.getCell(r, 7).numFmt = moneyFmt;
      ws.getCell(r, 8).numFmt = moneyFmt;
    }
  }

  ws.mergeCells(totalRow, 2, totalRow, 5);
  ws.mergeCells(totalRow, 6, totalRow, 7);
  ws.getCell(totalRow, 2).value = `Lưu ý: ${snap.termsText || 'Vui lòng ghi số tham chiếu giấy báo nợ này trong chứng từ thanh toán'}`;
  ws.getCell(totalRow, 2).font = grayFont;
  ws.getCell(totalRow, 6).value = 'Tổng cộng';
  ws.getCell(totalRow, 6).font = boldFont;
  ws.getCell(totalRow, 6).alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getCell(totalRow, 8).value = { formula: `SUM(H${dataStartRow}:H${totalRow - 1})`, result: totalAmount };
  ws.getCell(totalRow, 8).numFmt = moneyFmt;
  ws.getCell(totalRow, 8).font = boldFont;
  ws.getCell(totalRow, 8).alignment = { horizontal: 'right', vertical: 'middle' };
  for (let c = 2; c <= 8; c++) {
    ws.getCell(totalRow, c).border = tableBorder;
  }

  ws.getCell(wordsRow, 2).value = 'Bằng chữ:';
  ws.getCell(wordsRow, 2).font = { ...boldFont, color: { argb: 'FF808080' } };
  ws.mergeCells(wordsRow, 3, wordsRow, 8);
  ws.getCell(wordsRow, 3).value = amountToVietnameseWords(totalAmount);
  ws.getCell(wordsRow, 3).font = { ...boldFont, italic: true };

  ws.getCell(exchangeRow, 2).value = 'Tỷ giá USD/VN : ';
  ws.getCell(exchangeRow, 2).font = grayFont;

  ws.mergeCells(bankTop, 2, bankTop, 5);
  ws.mergeCells(bankTop, 7, bankTop, 8);
  const bankHeader = ws.getCell(bankTop, 2);
  bankHeader.value = 'THÔNG TIN CHUYỂN KHOẢN';
  bankHeader.font = boldFont;
  bankHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
  bankHeader.border = tableBorder;
  ws.getCell(bankTop, 7).value = snap.signatureRightLabel || 'Người lập';
  ws.getCell(bankTop, 7).font = boldFont;
  ws.getCell(bankTop, 7).alignment = { horizontal: 'center', vertical: 'middle' };

  const bankRows = [
    ['Tên tài khoản:', issuer?.name || ''],
    ['Số tài khoản:', issuer?.bankAccount || ''],
    ['Ngân hàng:', issuer?.bankName || ''],
  ];
  bankRows.forEach(([label, value], index) => {
    const r = bankTop + index + 1;
    ws.mergeCells(r, 4, r, 8);
    ws.getCell(r, 2).value = label;
    ws.getCell(r, 2).font = { ...boldFont, color: { argb: 'FF808080' } };
    ws.getCell(r, 4).value = value;
    ws.getCell(r, 4).font = boldFont;
  });

  const signatureNameRow = bankTop + 4;
  if (signatureNameRow <= sheetRows) {
    ws.mergeCells(signatureNameRow, 7, signatureNameRow, 8);
    ws.getCell(signatureNameRow, 7).value = signatures?.rightName || '';
    ws.getCell(signatureNameRow, 7).font = boldFont;
    ws.getCell(signatureNameRow, 7).alignment = { horizontal: 'center', vertical: 'middle' };
  }

  for (let r = bankTop; r <= bankTop + 3; r++) {
    for (let c = 2; c <= 5; c++) {
      ws.getCell(r, c).border = { top: thinGray, left: thinBlack, right: thinBlack, bottom: thinGray };
    }
  }

  const ab = await wb.xlsx.writeBuffer();
  return Buffer.from(ab);
}

/**
 * Render a debit note from a frozen snapshot (the doc's
 * debit_note_template_snapshot). Debit notes use the fixed VTA-style vertical
 * worksheet; payment statements below keep the dynamic horizontal columns.
 * Reads the logo bytes from storage (graceful skip if the file is missing).
 */
export async function renderTemplatedXlsx(
  doc: BillingDocument,
  snap: DebitNoteTemplateSnapshot,
): Promise<Buffer> {
  if (doc.type === 'DEBIT_NOTE') return renderDebitNoteXlsx(doc, snap);

  const ExcelJSMod = await import('exceljs');
  const ExcelJS = (ExcelJSMod as Record<string, unknown>).default
    ? ((ExcelJSMod as Record<string, unknown>).default as typeof ExcelJSMod)
    : ExcelJSMod;
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  wb.modified = new Date();

  const ws = wb.addWorksheet(`Tháng ${Number(doc.rangeTo.slice(5, 7)) || Number(doc.rangeFrom.slice(5, 7)) || 1}`);

  const cols = normalizeTemplateColumns(snap.columns, 'PAYMENT_STATEMENT').filter((col) => col.width > 0);
  const nCols = cols.length;
  const widthSamples: unknown[][] = cols.map(() => []);
  const amountIdx = cols.findIndex((col) => col.variable === 'amount') + 1;
  const totalColumns = cols
    .map((col, idx) => ({ col, idx: idx + 1 }))
    .filter(({ col }) => col.total);
  const lines = await enrichLinesForDebitNoteRender(doc.lines);
  const dataLines = aggregateDebitNoteExportLines(lines);
  const officialIdentity = await resolveBillingDocumentIdentity(doc, snap);
  const issuer = officialIdentity?.issuer ?? null;
  const partner = officialIdentity?.counterparty ?? null;
  wb.creator = issuer?.name || '';
  const bangKeLogoBytes = await loadLogoBytes(issuer?.logoStorageKey ?? null);
  if (bangKeLogoBytes) {
    const imageId = wb.addImage({ base64: bangKeLogoBytes.toString('base64'), extension: 'png' });
    ws.addImage(imageId, { tl: { col: 0, row: 0 }, ext: { width: 150, height: 40 } });
  }
  const amountSubtotal = dataLines.reduce((sum, line) => sum + effectiveAmount(line), 0);
  const vatAmount = Math.round(amountSubtotal * 0.08);
  const grandTotal = amountSubtotal + vatAmount;
  const customerName = partner?.name || doc.entityName || '';
  const issuerName = issuer?.name || '';
  const templateVariables: Record<string, string | number> = {
    rangeFrom: formatVietnameseDate(doc.rangeFrom),
    rangeTo: formatVietnameseDate(doc.rangeTo),
    rangeMonth: formatMonthYear(doc.rangeTo),
    invoiceNo: doc.note?.trim() || '........',
    invoiceDate: formatVietnameseDate(doc.rangeTo),
    customerName,
    customerAddress: partner?.address || '',
    customerTaxCode: partner?.taxCode || '',
    customerRepresentative: partner?.representative || '',
    customerPosition: partner?.representativeTitle || '',
    issuerName,
    issuerAddress: issuer?.address || '',
    issuerTaxCode: issuer?.taxCode || '',
    issuerRepresentative: issuer?.representative || '',
    issuerPosition: issuer?.representativeTitle || '',
    subtotal: amountSubtotal.toLocaleString('en-US'),
    vatAmount: vatAmount.toLocaleString('en-US'),
    grandTotal: grandTotal.toLocaleString('en-US'),
    amountInWords: amountToVietnameseWords(grandTotal),
  };

  const thinBlack = { style: 'thin' as const, color: { argb: 'FF000000' } };
  const hairBlack = { style: 'hair' as const, color: { argb: 'FF000000' } };
  const baseFont = { name: 'Times New Roman', size: 11, color: { argb: 'FF000000' } };
  const boldFont = { ...baseFont, bold: true };
  const moneyFmt = '_(* #,##0_);_(* \\(#,##0\\);_(* \\-??_);_(@_)';
  const nColsForIntro = Math.max(nCols, 12);

  ws.properties.defaultRowHeight = 22;
  ws.pageSetup = {
    paperSize: 9,
    orientation: snap.orientation === 'portrait' ? 'portrait' : 'landscape',
    fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true,
    margins: { left: 0.5, right: 0.2, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
  };

  const introRowHeights = new Map<number, number>([
    [1, 13.5],
    [2, 26.25],
    [3, 19.5],
    [16, 20.1],
  ]);
  for (let r = 1; r <= 16; r++) ws.getRow(r).height = introRowHeights.get(r) ?? 18;
  ws.getRow(17).height = 15;
  if (nCols > 1) ws.mergeCells(17, 1, 17, nCols);

  const rawTitle = snap.titleText || 'BẢNG KÊ CƯỚC VẬN CHUYỂN';
  const titleTemplate = hasTemplateToken(rawTitle) || /\bTHÁNG\b/i.test(rawTitle)
    ? rawTitle
    : `${rawTitle} THÁNG {rangeMonth}`;
  ws.mergeCells(2, 1, 2, nColsForIntro);
  ws.getCell(2, 1).value = renderTemplateText(titleTemplate, templateVariables);
  ws.getCell(2, 1).font = { name: 'Times New Roman', size: 16, bold: true };
  ws.getCell(2, 1).alignment = { horizontal: 'center', vertical: 'middle' };

  ws.mergeCells(3, 1, 3, nColsForIntro);
  ws.getCell(3, 1).value = renderTemplateText('(Kèm hoá đơn GTGT số: {invoiceNo}   ngày {invoiceDate})', templateVariables);
  ws.getCell(3, 1).font = { name: 'Times New Roman', size: 12, bold: true };
  ws.getCell(3, 1).alignment = { horizontal: 'center', vertical: 'middle' };

  const termsLines = renderTemplateText(
    snap.termsText ?? `- Số TK ${issuer?.bankAccount || ''}\n- Tại ngân hàng ${issuer?.bankName || ''}`,
    templateVariables,
  ).split('\n');
  const introRows: Array<{ row: number; value: string; bold?: boolean }> = [
    { row: 4, value: 'BÊN A (BÊN THUÊ DỊCH VỤ): {customerName}', bold: true },
    { row: 5, value: 'Địa chỉ: {customerAddress}' },
    { row: 6, value: 'Mã số thuế: {customerTaxCode}' },
    { row: 7, value: 'Đại diện bởi : {customerRepresentative}' },
    { row: 8, value: 'Chức vụ: {customerPosition}' },
    { row: 9, value: 'BÊN B (BÊN CUNG CẤP DỊCH VỤ): {issuerName}', bold: true },
    { row: 10, value: 'Địa chỉ: {issuerAddress}' },
    { row: 11, value: 'Mã số thuế: {issuerTaxCode}' },
    { row: 12, value: 'Đại diện bởi : {issuerRepresentative}' },
    { row: 13, value: 'Chức vụ: {issuerPosition}' },
    { row: 14, value: termsLines[0] ?? '- Số TK ' },
    { row: 15, value: termsLines[1] ?? '- Tại ngân hàng ' },
    { row: 16, value: 'Cùng thống nhất tiến hành đối chiếu sản lượng và doanh thu dịch vụ Bên B đã hoàn thành cung cấp/thực hiện cho Bên A như sau:' },
  ];
  for (const item of introRows) {
    const cell = ws.getCell(item.row, 1);
    cell.value = renderTemplateText(item.value, templateVariables);
    cell.font = item.bold ? boldFont : baseFont;
    cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: false };
  }

  const headerTop = 18;
  const headerBottom = 19;
  const quantityIndexes = cols
    .map((col, idx) => ({ col, idx: idx + 1 }))
    .filter(({ col }) => col.variable === 'container20Count' || col.variable === 'container40Count');
  const quantityStart = quantityIndexes.length > 0 ? Math.min(...quantityIndexes.map((x) => x.idx)) : 0;
  const quantityEnd = quantityIndexes.length > 0 ? Math.max(...quantityIndexes.map((x) => x.idx)) : 0;

  for (let c = 1; c <= nCols; c++) {
    const col = cols[c - 1];
    const label = renderDebitNoteColumnLabel(col);
    const isQuantityChild = col.variable === 'container20Count' || col.variable === 'container40Count';
    const topCell = ws.getCell(headerTop, c);
    const bottomCell = ws.getCell(headerBottom, c);
    if (isQuantityChild) {
      bottomCell.value = label;
    } else {
      topCell.value = label;
      ws.mergeCells(headerTop, c, headerBottom, c);
    }
  }
  if (quantityStart > 0 && quantityEnd >= quantityStart) {
    ws.mergeCells(headerTop, quantityStart, headerTop, quantityEnd);
    ws.getCell(headerTop, quantityStart).value = 'Số lượng';
  }

  for (let r = headerTop; r <= headerBottom; r++) {
    ws.getRow(r).height = 14.25;
    for (let c = 1; c <= nCols; c++) {
      const cell = ws.getCell(r, c);
      cell.font = boldFont;
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = { top: thinBlack, left: thinBlack, right: thinBlack, bottom: thinBlack };
    }
  }

  const firstDataRow = 20;
  let row = firstDataRow;
  const dataRows: number[] = [];
  for (const line of dataLines) {
    const r = row++;
    dataRows.push(r);
    for (let c = 0; c < cols.length; c++) {
      const col = cols[c];
      const cell = ws.getCell(r, c + 1);
      const value = renderColumnValue(line, col, dataRows.length);
      widthSamples[c].push(value);
      cell.value = value;
      applyInferredColumnFormat(cell, value);
      cell.font = baseFont;
      cell.border = { top: thinBlack, left: thinBlack, right: thinBlack, bottom: hairBlack };
      if (col.variable === 'amount') cell.numFmt = moneyFmt;
      if (col.variable === 'rowIndex' && r > firstDataRow) {
        cell.value = { formula: `A${r - 1}+1`, result: dataRows.length };
        cell.numFmt = '#,##0';
      }
    }
    ws.getRow(r).height = 27;
  }

  const subtotalRow = row++;
  const vatRow = row++;
  const grandRow = row++;
  const wordsRow = row++;

  if (nCols >= 6) {
    ws.mergeCells(subtotalRow, 1, subtotalRow, Math.min(6, nCols));
    ws.mergeCells(vatRow, 1, vatRow, Math.min(6, nCols));
    ws.mergeCells(grandRow, 1, grandRow, Math.min(6, nCols));
  }
  ws.getCell(subtotalRow, 1).value = 'CỘNG';
  ws.getCell(vatRow, 1).value = 'THUẾ GTGT 8%';
  ws.getCell(grandRow, 1).value = 'TỔNG THANH TOÁN';
  for (const { col, idx } of totalColumns) {
    const totalCell = ws.getCell(subtotalRow, idx);
    const result = dataLines.reduce((sum, line, dataIdx) => {
      const v = renderColumnValue(line, col, dataIdx + 1);
      return sum + (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    }, 0);
    totalCell.value = dataRows.length > 0
      ? { formula: `SUM(${colLetter(idx)}${dataRows[0]}:${colLetter(idx)}${dataRows[dataRows.length - 1]})`, result }
      : result;
    widthSamples[idx - 1]?.push(result);
    applyInferredColumnFormat(totalCell, result);
    if (col.variable === 'amount') totalCell.numFmt = moneyFmt;
  }
  if (amountIdx > 0) {
    ws.getCell(vatRow, amountIdx).value = { formula: `${colLetter(amountIdx)}${subtotalRow}*0.08` };
    ws.getCell(grandRow, amountIdx).value = { formula: `${colLetter(amountIdx)}${subtotalRow}+${colLetter(amountIdx)}${vatRow}` };
    ws.getCell(vatRow, amountIdx).numFmt = moneyFmt;
    ws.getCell(grandRow, amountIdx).numFmt = moneyFmt;
    widthSamples[amountIdx - 1]?.push(vatAmount, grandTotal);
  }

  ws.getCell(wordsRow, 1).value = renderTemplateText('Bằng chữ: {amountInWords}', templateVariables);
  if (nCols > 1) ws.mergeCells(wordsRow, 1, wordsRow, nCols);

  for (let r = subtotalRow; r <= wordsRow; r++) {
    ws.getRow(r).height = r === wordsRow ? 24.95 : 27;
    for (let c = 1; c <= nCols; c++) {
      const cell = ws.getCell(r, c);
      cell.font = { ...boldFont, bold: r !== wordsRow ? true : false };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = { top: thinBlack, left: thinBlack, right: thinBlack, bottom: r === wordsRow ? undefined : hairBlack };
    }
  }

  const signatureLabelRow = row++;
  const signatureHintRow = row++;
  const signatureNameRow = row + 3;
  row = signatureNameRow + 1;
  const leftEnd = nCols >= 11 ? 5 : Math.max(1, Math.floor(nCols / 2));
  const rightStart = nCols >= 11 ? 9 : Math.min(nCols, leftEnd + 1);
  const rightEnd = nCols >= 11 ? 11 : nCols;
  for (const r of [signatureLabelRow, signatureHintRow, signatureNameRow]) {
    if (leftEnd > 1) ws.mergeCells(r, 1, r, leftEnd);
    if (rightStart < rightEnd) ws.mergeCells(r, rightStart, r, rightEnd);
  }
  ws.getCell(signatureLabelRow, 1).value = officialIdentity?.signatures.leftLabel || snap.signatureLeftLabel?.trim() || '';
  ws.getCell(signatureLabelRow, rightStart).value = officialIdentity?.signatures.rightLabel || snap.signatureRightLabel?.trim() || '';
  ws.getCell(signatureHintRow, 1).value = '(Ký, họ tên)';
  ws.getCell(signatureHintRow, rightStart).value = '(Ký, họ tên, đóng dấu)';
  ws.getCell(signatureNameRow, 1).value = officialIdentity?.signatures.leftName || snap.signatureLeftName?.trim() || '';
  ws.getCell(signatureNameRow, rightStart).value = officialIdentity?.signatures.rightName || snap.signatureRightName?.trim() || '';
  for (const cell of [ws.getCell(signatureLabelRow, 1), ws.getCell(signatureLabelRow, rightStart)]) {
    cell.font = boldFont;
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = { top: thinBlack };
  }
  for (const cell of [ws.getCell(signatureHintRow, 1), ws.getCell(signatureHintRow, rightStart)]) {
    cell.font = { ...baseFont, italic: true };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  }
  for (const cell of [ws.getCell(signatureNameRow, 1), ws.getCell(signatureNameRow, rightStart)]) {
    cell.font = boldFont;
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  }
  ws.getRow(signatureLabelRow).height = 24.95;
  ws.getRow(signatureHintRow).height = 18;
  ws.getRow(signatureNameRow).height = 24.95;

  for (let c = 0; c < cols.length; c++) {
    ws.getColumn(c + 1).width =
      VIETSUN_TABLE_WIDTH_BY_COLUMN_ID.get(cols[c].id) ??
      autoColumnWidth(renderDebitNoteColumnLabel(cols[c]), widthSamples[c] ?? []);
  }
  const ab = await wb.xlsx.writeBuffer();
  return Buffer.from(ab);
}
